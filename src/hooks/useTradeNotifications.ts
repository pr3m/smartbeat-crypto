'use client';

import { useEffect, useRef } from 'react';
import { sendBrowserNotification } from '@/components/Toast';
import type { TradingRecommendation, TimeframeData } from '@/lib/kraken/types';
import type { SimulatedPosition, Position } from '@/components/TradingDataProvider';

interface UseTradeNotificationsProps {
  recommendation: TradingRecommendation | null;
  tfData: Record<number, TimeframeData>;
  price: number;
  simulatedPositions: SimulatedPosition[];
  openPositions: Position[];
  testMode: boolean;
  notificationsEnabled: boolean;
}

// Cooldown durations in ms
const COOLDOWN_GRADE_MS = 5 * 60 * 1000;
const COOLDOWN_SETUP_MS = 10 * 60 * 1000;
const COOLDOWN_VOLUME_MS = 10 * 60 * 1000;
const COOLDOWN_RSI_MS = 15 * 60 * 1000;

// P&L milestone levels (percent from entry)
const PNL_MILESTONES = [3, 5, -3, -5];
// DCA levels (percent below entry for adding to position)
const DCA_LEVELS = [-3, -5];

function getPositionKey(position: SimulatedPosition | Position, testMode: boolean): string {
  const baseId = position.id;
  if (testMode) {
    const openedAt = 'openedAt' in position ? Date.parse(position.openedAt) : NaN;
    return Number.isFinite(openedAt) ? `${baseId}-${openedAt}` : baseId;
  }
  const openTime = 'openTime' in position ? position.openTime : undefined;
  return typeof openTime === 'number' && Number.isFinite(openTime)
    ? `${baseId}-${openTime}`
    : baseId;
}

function notify(
  title: string,
  body: string,
  tag: string,
  priority: 'high' | 'medium' = 'medium',
  replacePrefix?: string,
) {
  sendBrowserNotification(title, body, { tag, renotify: true });

  // Persist to database (fire-and-forget)
  fetch('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      body,
      type: tag.replace(/-.*/, ''), // "signal-change" -> "signal"
      tag,
      priority,
      ...(replacePrefix && { replacePrefix }),
    }),
  }).catch(() => {}); // Silent fail — browser notification still works
}

export function useTradeNotifications({
  recommendation,
  tfData,
  price,
  simulatedPositions,
  openPositions,
  testMode,
  notificationsEnabled,
}: UseTradeNotificationsProps) {
  // Previous state refs
  const prevActionRef = useRef<string | null>(null);
  const prevConfidenceRef = useRef<number>(0);

  // Cooldown tracking
  const lastGradeAlertRef = useRef<number>(0);
  const lastSetupAlertRef = useRef<number>(0);
  const lastVolumeAlertRef = useRef<number>(0);
  const lastRsiAlertRef = useRef<number>(0);

  // P&L / DCA tracking: Map<positionId, Set<milestone>>
  const notifiedPnlLevelsRef = useRef<Map<string, Set<number>>>(new Map());
  const notifiedDcaLevelsRef = useRef<Map<string, Set<number>>>(new Map());

  useEffect(() => {
    if (!notificationsEnabled || !recommendation) return;

    const now = Date.now();
    const prevAction = prevActionRef.current;
    const prevConfidence = prevConfidenceRef.current;
    const action = recommendation.action;
    const confidence = recommendation.confidence;

    // --- 1. New Signal ---
    if (
      (action === 'LONG' || action === 'SHORT') &&
      action !== prevAction
    ) {
      notify(
        `Signal: ${action}`,
        recommendation.reason,
        'signal-change',
        'high',
      );
    }

    // --- 2. Setup Invalidated ---
    if (
      prevAction &&
      (prevAction === 'LONG' || prevAction === 'SHORT') &&
      action !== prevAction
    ) {
      // Already covered by "New Signal" if it flipped to opposite
      // Only notify separately if it went to WAIT
      if (action === 'WAIT') {
        notify(
          'Setup Invalidated',
          `${prevAction} signal lost — now WAIT`,
          'signal-invalidated',
          'high',
        );
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
      );
      lastSetupAlertRef.current = now;
    }

    // Update refs
    prevActionRef.current = action;
    prevConfidenceRef.current = confidence;
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
      indicators15m.volRatio > 2.0
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
      if (indicators15m.rsi < 25) {
        notify(
          'RSI Oversold',
          `15m RSI at ${indicators15m.rsi.toFixed(1)} — extreme oversold`,
          'rsi-extreme',
        );
        lastRsiAlertRef.current = now;
      } else if (indicators15m.rsi > 75) {
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

      // DCA levels (only for long positions — Martingale add-on)
      if (side === 'long') {
        if (!notifiedDcaLevelsRef.current.has(positionKey)) {
          notifiedDcaLevelsRef.current.set(positionKey, new Set());
        }
        const notifiedDca = notifiedDcaLevelsRef.current.get(positionKey)!;

        for (const level of DCA_LEVELS) {
          if (notifiedDca.has(level)) continue;

          const priceLevel = entryPrice * (1 + level / 100);
          if (price <= priceLevel) {
            notifiedDca.add(level);
            notify(
              `DCA Level Hit: ${level}%`,
              `Price €${price.toFixed(4)} is ${level}% below entry €${entryPrice.toFixed(4)} — consider Martingale add`,
              `dca-${posId}-${level}`,
              'high',
              `dca-${posId}`,
            );
          }
        }
      }
    }
  }, [price, simulatedPositions, openPositions, testMode, notificationsEnabled]);

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
}
