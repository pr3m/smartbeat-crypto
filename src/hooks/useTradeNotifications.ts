'use client';

import { useEffect, useRef } from 'react';
import { sendBrowserNotification } from '@/components/Toast';
import type { TradingRecommendation, TimeframeData } from '@/lib/kraken/types';
import type { SimulatedPosition, Position, OpenOrder } from '@/components/TradingDataProvider';
import { getDefaultStrategy } from '@/lib/trading/strategies';
import type { DCASignal, ExitSignal } from '@/lib/trading/v2-types';

interface UseTradeNotificationsProps {
  recommendation: TradingRecommendation | null;
  tfData: Record<number, TimeframeData>;
  price: number;
  simulatedPositions: SimulatedPosition[];
  openPositions: Position[];
  openOrders: OpenOrder[];
  testMode: boolean;
  notificationsEnabled: boolean;
  dcaSignal?: DCASignal | null;
  exitSignal?: ExitSignal | null;
}

// Cooldown durations in ms
const COOLDOWN_GRADE_MS = 5 * 60 * 1000;
const COOLDOWN_SETUP_MS = 10 * 60 * 1000;
const COOLDOWN_VOLUME_MS = 10 * 60 * 1000;
const COOLDOWN_RSI_MS = 15 * 60 * 1000;

// P&L milestone levels (percent from entry)
const PNL_MILESTONES = [3, 5, -3, -5];

// Derive DCA level from strategy config
const strategy = getDefaultStrategy();
const DCA_MIN_DRAWDOWN = strategy.dca.minDrawdownForDCA; // 3%

function getPositionKey(position: SimulatedPosition | Position, testMode: boolean): string {
  const baseId = position.id;
  if (testMode) {
    const openedAt = 'openedAt' in position ? Date.parse(position.openedAt) : NaN;
    return Number.isFinite(openedAt) ? `${baseId}-${openedAt}` : baseId;
  }

  const livePosition = position as Position;
  const sortedEntries = [...(livePosition.rawEntries || [])].sort((a, b) => a.timestamp - b.timestamp);
  const firstEntry = sortedEntries[0];
  const openTime = 'openTime' in livePosition ? livePosition.openTime : undefined;

  const lifecycleId =
    firstEntry?.ordertxid ||
    firstEntry?.id ||
    (typeof openTime === 'number' && Number.isFinite(openTime) ? String(openTime) : 'live');

  return `${baseId}-${lifecycleId}`;
}

function getBaseChecklistPassCount(recommendation: TradingRecommendation, direction: 'long' | 'short'): number {
  const checklist = recommendation[direction].checklist;
  const baseItems = [
    checklist.trend4h,
    checklist.setup1h,
    checklist.entry15m,
    checklist.volume,
    checklist.btcAlign,
    checklist.macdMomentum,
  ];

  let passed = baseItems.filter(item => item?.pass).length;
  if (checklist.trend1d?.pass) passed += 1;
  return passed;
}

function notify(
  title: string,
  body: string,
  tag: string,
  priority: 'high' | 'medium' = 'medium',
  replacePrefix?: string,
  persist = true,
) {
  sendBrowserNotification(title, body, { tag, renotify: true });

  const type = tag.replace(/-.*/, ''); // "signal-change" -> "signal"

  if (persist) {
    // Persist to database (fire-and-forget)
    fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body,
        type,
        tag,
        priority,
        ...(replacePrefix && { replacePrefix }),
      }),
    }).catch(() => {}); // Silent fail — browser notification still works
  } else {
    // Session-only: dispatch custom event so NotificationBell can pick it up
    window.dispatchEvent(
      new CustomEvent('session-notification', {
        detail: { title, body, type, tag, priority },
      }),
    );
  }
}

export function useTradeNotifications({
  recommendation,
  tfData,
  price,
  simulatedPositions,
  openPositions,
  openOrders,
  testMode,
  notificationsEnabled,
  dcaSignal,
  exitSignal,
}: UseTradeNotificationsProps) {
  // Previous state refs
  const prevActionRef = useRef<string | null>(null);
  const prevConfidenceRef = useRef<number>(0);

  // Cooldown tracking
  const lastGradeAlertRef = useRef<number>(0);
  const lastSetupAlertRef = useRef<number>(0);
  const lastVolumeAlertRef = useRef<number>(0);
  const lastRsiAlertRef = useRef<number>(0);
  const lastExitSignalRef = useRef<string | null>(null);
  const lastExitPressureBucketRef = useRef<number>(0);

  // --- 4a. Entry signal confirmation timer ---
  // Track consecutive polls with same signal to require persistence before notifying
  const pendingSignalRef = useRef<{ action: string; firstSeenAt: number } | null>(null);
  const lastSignalNotifyRef = useRef<number>(0);
  const SIGNAL_CONFIRM_MS = 2 * 60 * 1000; // 2 minutes (2 consecutive polls)
  const SIGNAL_COOLDOWN_MS = 5 * 60 * 1000; // 5-minute cooldown between signal notifications

  // --- 4b. Setup invalidation (market-condition based) ---
  const lastInvalidationNotifyRef = useRef<number>(0);
  const INVALIDATION_COOLDOWN_MS = 10 * 60 * 1000; // 10-minute cooldown between invalidation notifications
  const prevRecommendationRef = useRef<TradingRecommendation | null>(null);

  // Order fill tracking
  const prevOpenOrdersRef = useRef<Map<string, OpenOrder>>(new Map());
  const orderFillInitializedRef = useRef(false);
  const cancelledOrderIdsRef = useRef<Set<string>>(new Set());

  // P&L / DCA tracking: Map<positionId, Set<milestone>>
  const notifiedPnlLevelsRef = useRef<Map<string, Set<number>>>(new Map());
  const notifiedDcaLevelsRef = useRef<Map<string, Set<number>>>(new Map());

  useEffect(() => {
    if (!notificationsEnabled || !recommendation) return;

    const now = Date.now();
    const prevRecommendation = prevRecommendationRef.current;
    const prevAction = prevActionRef.current;
    const prevConfidence = prevConfidenceRef.current;
    const action = recommendation.action;
    const confidence = recommendation.confidence;

    // --- 1. New Signal (with confirmation timer) ---
    // Don't notify immediately — track pending signal and only notify after it persists for 2 polls
    if (action === 'LONG' || action === 'SHORT') {
      if (action !== prevAction) {
        // New signal direction — start confirmation timer
        pendingSignalRef.current = { action, firstSeenAt: now };
      } else if (pendingSignalRef.current && pendingSignalRef.current.action === action) {
        // Same signal persists — check if confirmation period elapsed
        const elapsed = now - pendingSignalRef.current.firstSeenAt;
        if (elapsed >= SIGNAL_CONFIRM_MS && now - lastSignalNotifyRef.current > SIGNAL_COOLDOWN_MS) {
          notify(
            `Signal: ${action}`,
            recommendation.reason,
            'signal-change',
            'high',
          );
          lastSignalNotifyRef.current = now;
          pendingSignalRef.current = null; // Confirmed and notified
        }
      }
    } else {
      // Action is WAIT or SPIKE — clear pending signal
      pendingSignalRef.current = null;
    }

    // --- 2. Setup Invalidated (market-condition deterioration) ---
    if (
      prevAction &&
      (prevAction === 'LONG' || prevAction === 'SHORT') &&
      action !== prevAction
    ) {
      if (action === 'WAIT' && prevRecommendation) {
        const priorDirection: 'long' | 'short' = prevAction === 'LONG' ? 'long' : 'short';
        const oppositeLead = priorDirection === 'long'
          ? recommendation.short.strength - recommendation.long.strength
          : recommendation.long.strength - recommendation.short.strength;

        const confidenceDrop = prevRecommendation.confidence - recommendation.confidence;
        const basePassDrop = getBaseChecklistPassCount(prevRecommendation, priorDirection)
          - getBaseChecklistPassCount(recommendation, priorDirection);
        const directionLeadThreshold = strategy.signals.directionLeadThreshold ?? 12;

        const deteriorationSignals = [
          confidenceDrop >= 12,
          basePassDrop >= 2,
          oppositeLead >= directionLeadThreshold,
        ].filter(Boolean).length;

        if (
          deteriorationSignals >= 2 &&
          now - lastInvalidationNotifyRef.current > INVALIDATION_COOLDOWN_MS
        ) {
          notify(
            'Setup Invalidated',
            `${prevAction} setup degraded (conf -${Math.max(0, Math.round(confidenceDrop))}, base checks -${Math.max(0, basePassDrop)}) — now WAIT`,
            'signal-invalidated',
            'high',
            undefined,
            false, // session-only
          );
          lastInvalidationNotifyRef.current = now;
        }
      }
    }

    // --- 3. Grade Change (confidence jump) ---
    if (now - lastGradeAlertRef.current > COOLDOWN_GRADE_MS) {
      const direction = action === 'LONG' || action === 'SHORT' ? action : null;
      if (confidence >= 80 && prevConfidence < 80) {
        notify(
          direction ? `Grade A ${direction} Signal` : 'Grade A Signal',
          `${direction ? `${direction} ` : ''}Confidence jumped to ${confidence}% — high probability setup`,
          'grade-change',
          'high',
        );
        lastGradeAlertRef.current = now;
      } else if (confidence < 50 && prevConfidence >= 50) {
        notify(
          direction ? `${direction} Signal Weakening` : 'Signal Weakening',
          `${direction ? `${direction} ` : ''}Confidence dropped to ${confidence}% — setup degrading`,
          'grade-change',
          'high',
          undefined,
          false, // session-only
        );
        lastGradeAlertRef.current = now;
      }
    }

    // --- 4. Setup Forming ---
    if (
      now - lastSetupAlertRef.current > COOLDOWN_SETUP_MS &&
      prevAction === 'WAIT' &&
      action === 'WAIT' && // Still WAIT, but forming
      confidence >= 55 &&
      confidence <= 70 &&
      prevConfidence < 55
    ) {
      notify(
        'Setup Forming',
        `Confidence rising to ${confidence}% — watch for confirmation`,
        'setup-forming',
        'medium',
        undefined,
        false, // session-only
      );
      lastSetupAlertRef.current = now;
    }

    // Update refs
    prevActionRef.current = action;
    prevConfidenceRef.current = confidence;
    prevRecommendationRef.current = recommendation;
  }, [recommendation, notificationsEnabled]);

  // --- 5. Volume Spike & RSI Extreme (from 15m indicators) ---
  useEffect(() => {
    if (!notificationsEnabled) return;
    const indicators15m = tfData[15]?.indicators;
    if (!indicators15m) return;

    const now = Date.now();

    // Volume spike: 15m volume ratio > 2.0x
    if (
      now - lastVolumeAlertRef.current > COOLDOWN_VOLUME_MS &&
      indicators15m.volRatio > strategy.spike.volumeRatioThreshold
    ) {
      notify(
        'Volume Spike',
        `15m volume is ${indicators15m.volRatio.toFixed(1)}x average — institutional activity`,
        'volume-spike',
      );
      lastVolumeAlertRef.current = now;
    }

    // RSI extreme: 15m RSI < 25 or > 75
    if (now - lastRsiAlertRef.current > COOLDOWN_RSI_MS) {
      if (indicators15m.rsi < strategy.spike.oversoldRSI) {
        notify(
          'RSI Oversold',
          `15m RSI at ${indicators15m.rsi.toFixed(1)} — extreme oversold`,
          'rsi-extreme',
        );
        lastRsiAlertRef.current = now;
      } else if (indicators15m.rsi > strategy.spike.overboughtRSI) {
        notify(
          'RSI Overbought',
          `15m RSI at ${indicators15m.rsi.toFixed(1)} — extreme overbought`,
          'rsi-extreme',
        );
        lastRsiAlertRef.current = now;
      }
    }
  }, [tfData, notificationsEnabled]);

  // --- 6. Position P&L Milestones & DCA Levels ---
  useEffect(() => {
    if (!notificationsEnabled || price <= 0) return;

    const positions = testMode ? simulatedPositions : openPositions;
    if (positions.length === 0) return;

    for (const pos of positions) {
      const posId = 'id' in pos ? pos.id : '';
      const positionKey = getPositionKey(pos, testMode);
      let entryPrice: number;
      let pnlPercent: number;
      let side: string;

      if (testMode) {
        const sp = pos as SimulatedPosition;
        if (!sp.isOpen) continue;
        entryPrice = sp.avgEntryPrice;
        side = sp.side;
        pnlPercent = sp.unrealizedPnlPercent ?? ((price - entryPrice) / entryPrice) * 100 * (side === 'long' ? 1 : -1);
      } else {
        const op = pos as Position;
        entryPrice = op.cost / op.volume;
        side = op.type === 'buy' ? 'long' : 'short';
        const currentValue = op.volume * price;
        const pnl = side === 'long' ? currentValue - op.cost : op.cost - currentValue;
        pnlPercent = op.cost > 0 ? (pnl / op.cost) * 100 : 0;
      }

      if (entryPrice <= 0) continue;

      // P&L milestones
      if (!notifiedPnlLevelsRef.current.has(positionKey)) {
        notifiedPnlLevelsRef.current.set(positionKey, new Set());
      }
      const notifiedPnl = notifiedPnlLevelsRef.current.get(positionKey)!;

      for (const milestone of PNL_MILESTONES) {
        if (notifiedPnl.has(milestone)) continue;

        const crossed = milestone > 0
          ? pnlPercent >= milestone
          : pnlPercent <= milestone;

        if (crossed) {
          notifiedPnl.add(milestone);
          const emoji = milestone > 0 ? '+' : '';
          notify(
            `P&L ${emoji}${milestone}%`,
            `${side.toUpperCase()} position at ${emoji}${pnlPercent.toFixed(1)}% from €${entryPrice.toFixed(4)} entry`,
            `pnl-${posId}-${milestone}`,
            'high',
            `pnl-${posId}`,
          );
        }
      }

      // DCA level (strategy-driven drawdown threshold)
      {
        if (!notifiedDcaLevelsRef.current.has(positionKey)) {
          notifiedDcaLevelsRef.current.set(positionKey, new Set());
        }
        const notifiedDca = notifiedDcaLevelsRef.current.get(positionKey)!;
        const dcaLevel = -DCA_MIN_DRAWDOWN; // e.g., -3

        if (!notifiedDca.has(dcaLevel)) {
          const priceLevel = side === 'long'
            ? entryPrice * (1 + dcaLevel / 100)   // price drops for long
            : entryPrice * (1 - dcaLevel / 100);   // price rises for short
          const crossed = side === 'long' ? price <= priceLevel : price >= priceLevel;

          if (crossed) {
            notifiedDca.add(dcaLevel);
            notify(
              `DCA Level Hit: ${dcaLevel}%`,
              `Price €${price.toFixed(4)} is ${DCA_MIN_DRAWDOWN}% against ${side.toUpperCase()} entry €${entryPrice.toFixed(4)} — wait for momentum exhaustion before adding`,
              `dca-${posId}-${dcaLevel}`,
              'high',
              `dca-${posId}`,
            );
          }
        }

        // V2 Engine DCA signal notification (momentum exhaustion based)
        if (dcaSignal?.shouldDCA && dcaSignal.confidence >= 60) {
          const dcaKey = `v2-dca-${posId}`;
          if (!notifiedDcaLevelsRef.current.has(dcaKey) || !notifiedDcaLevelsRef.current.get(dcaKey)?.has(dcaSignal.dcaLevel)) {
            if (!notifiedDcaLevelsRef.current.has(dcaKey)) {
              notifiedDcaLevelsRef.current.set(dcaKey, new Set());
            }
            notifiedDcaLevelsRef.current.get(dcaKey)!.add(dcaSignal.dcaLevel);
            notify(
              `DCA Signal: Level ${dcaSignal.dcaLevel}`,
              `Momentum exhaustion detected (${dcaSignal.confidence}% confidence) — ${dcaSignal.reason}`,
              `v2-dca-${posId}-${dcaSignal.dcaLevel}`,
              'high',
              `v2-dca-${posId}`,
            );
          }
        }
      }
    }
  }, [price, simulatedPositions, openPositions, testMode, notificationsEnabled, dcaSignal]);

  // V2 Engine exit signal notification (10% buckets, only notify on increasing pressure)
  useEffect(() => {
    if (!notificationsEnabled || !exitSignal?.shouldExit) {
      // Reset tracking when exit is no longer active
      if (!exitSignal?.shouldExit) {
        lastExitPressureBucketRef.current = 0;
      }
      return;
    }

    // Use 10% buckets instead of 5% to reduce notification noise
    const pressureBucket = Math.floor(exitSignal.totalPressure / 10) * 10;
    const exitKey = `${exitSignal.urgency}-${pressureBucket}`;
    if (lastExitSignalRef.current === exitKey) return;

    // Only notify when pressure is increasing (not oscillating down then back up)
    if (pressureBucket < lastExitPressureBucketRef.current) return;

    lastExitSignalRef.current = exitKey;
    lastExitPressureBucketRef.current = pressureBucket;

    notify(
      `Exit Signal: ${exitSignal.urgency.toUpperCase()}`,
      `Exit pressure ${exitSignal.totalPressure}% — ${exitSignal.explanation}`,
      'v2-exit-signal',
      exitSignal.urgency === 'immediate' ? 'high' : 'medium',
    );
  }, [exitSignal?.shouldExit, exitSignal?.urgency, exitSignal?.totalPressure, notificationsEnabled]);

  // --- 7. Order Fill Detection ---
  // Track open orders and detect when they disappear (filled/executed)
  useEffect(() => {
    if (!notificationsEnabled) return;

    const currentOrderIds = new Set(openOrders.map(o => o.id));

    // Skip the first load — just record initial state
    if (!orderFillInitializedRef.current) {
      const map = new Map<string, OpenOrder>();
      for (const order of openOrders) {
        map.set(order.id, order);
      }
      prevOpenOrdersRef.current = map;
      orderFillInitializedRef.current = true;
      return;
    }

    // Find orders that were open before but are no longer present
    for (const [orderId, prevOrder] of prevOpenOrdersRef.current) {
      if (!currentOrderIds.has(orderId)) {
        // Skip if this order was just cancelled by the user
        if (cancelledOrderIdsRef.current.has(orderId)) {
          cancelledOrderIdsRef.current.delete(orderId);
          continue;
        }

        // Order disappeared — it was filled/executed
        const side = prevOrder.type === 'buy' ? 'BUY' : 'SELL';
        const orderTypeLabel = (prevOrder.orderType || 'market').replace(/-/g, ' ');
        const priceStr = prevOrder.price > 0 ? ` @ €${prevOrder.price.toFixed(4)}` : '';
        const volumeStr = prevOrder.volume > 0 ? `${prevOrder.volume.toFixed(1)} XRP` : '';

        notify(
          `Order Filled: ${side} ${volumeStr}`,
          `${orderTypeLabel.charAt(0).toUpperCase() + orderTypeLabel.slice(1)} order executed${priceStr}`,
          `order-fill-${orderId}`,
          'high',
        );
      }
    }

    // Update previous orders ref
    const map = new Map<string, OpenOrder>();
    for (const order of openOrders) {
      map.set(order.id, order);
    }
    prevOpenOrdersRef.current = map;
  }, [openOrders, notificationsEnabled]);

  // Clean up notified levels for closed positions
  useEffect(() => {
    const positions = testMode ? simulatedPositions : openPositions;
    const openIds = new Set(positions.map(p => getPositionKey(p, testMode)));

    for (const id of notifiedPnlLevelsRef.current.keys()) {
      if (!openIds.has(id)) {
        notifiedPnlLevelsRef.current.delete(id);
      }
    }
    for (const id of notifiedDcaLevelsRef.current.keys()) {
      if (!openIds.has(id)) {
        notifiedDcaLevelsRef.current.delete(id);
      }
    }
  }, [simulatedPositions, openPositions, testMode]);

  // Return a function to mark an order as cancelled (prevents false fill notifications)
  return {
    markOrderCancelled: (orderId: string) => {
      cancelledOrderIdsRef.current.add(orderId);
    },
  };
}
