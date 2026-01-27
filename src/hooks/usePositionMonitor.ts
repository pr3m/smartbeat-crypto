/**
 * Position Monitor Hook
 * Monitors positions and triggers AI analysis when thresholds are crossed
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';

export interface TradeAgentData {
  id: string;
  positionId: string;
  positionType: string;
  pair: string;
  side: string;
  entryPrice: number;
  status: string;
  priceAlertPct: number;
  checkCooldown: number;
  lastPrice: number | null;
  lastCheckAt: string | null;
  lastAlertAt: string | null;
}

interface PositionMonitorOptions {
  enabled?: boolean;
  testMode?: boolean;
}

export function usePositionMonitor(
  currentPrice: number,
  options: PositionMonitorOptions = {}
) {
  const { enabled = true, testMode = false } = options;

  const [agents, setAgents] = useState<TradeAgentData[]>([]);
  const [loading, setLoading] = useState(true);
  const lastPriceRef = useRef<number>(0);
  const checkingRef = useRef(false);

  const { addAgentAlert, openChat, addMessage } = useChatStore();

  // Fetch active agents
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/agents?status=active');
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Create agent for a new position
  const createAgent = useCallback(
    async (position: {
      id: string;
      pair: string;
      side: string;
      entryPrice: number;
    }) => {
      try {
        const res = await fetch('/api/ai/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            positionId: position.id,
            positionType: testMode ? 'simulated' : 'kraken',
            pair: position.pair,
            side: position.side,
            entryPrice: position.entryPrice,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setAgents((prev) => [...prev, data.agent]);
          return data.agent;
        }
      } catch (err) {
        console.error('Failed to create agent:', err);
      }
      return null;
    },
    [testMode]
  );

  // Deactivate agent when position closes
  const deactivateAgent = useCallback(async (positionId: string) => {
    try {
      const agent = agents.find((a) => a.positionId === positionId);
      if (agent) {
        await fetch(`/api/ai/agents/${agent.id}`, { method: 'DELETE' });
        setAgents((prev) => prev.filter((a) => a.positionId !== positionId));
      }
    } catch (err) {
      console.error('Failed to deactivate agent:', err);
    }
  }, [agents]);

  // Check if any thresholds are crossed
  const checkThresholds = useCallback(async () => {
    if (!enabled || agents.length === 0 || checkingRef.current) return;
    if (currentPrice <= 0) return;

    checkingRef.current = true;

    try {
      for (const agent of agents) {
        if (agent.status !== 'active') continue;

        // Calculate price change from entry
        const priceChange =
          ((currentPrice - agent.entryPrice) / agent.entryPrice) * 100;
        const priceChangeAbs = Math.abs(priceChange);

        // Check cooldown
        const lastCheck = agent.lastCheckAt
          ? new Date(agent.lastCheckAt).getTime()
          : 0;
        const cooldownMs = agent.checkCooldown * 1000;
        const timeSinceLastCheck = Date.now() - lastCheck;

        if (timeSinceLastCheck < cooldownMs) continue;

        // Check if threshold crossed
        if (priceChangeAbs >= agent.priceAlertPct) {
          // Trigger analysis
          const direction = priceChange > 0 ? 'up' : 'down';
          const alertMessage = `${agent.pair} ${agent.side.toUpperCase()} position has moved ${priceChangeAbs.toFixed(1)}% ${direction} since entry at €${agent.entryPrice.toFixed(4)}. Current: €${currentPrice.toFixed(4)}.`;

          // Send browser notification
          sendNotification(
            `Position Alert: ${agent.pair}`,
            alertMessage
          );

          // Add to chat alerts
          addAgentAlert({
            positionId: agent.positionId,
            title: `Position Alert: ${agent.pair}`,
            message: alertMessage,
            priority: priceChangeAbs >= agent.priceAlertPct * 2 ? 'high' : 'medium',
          });

          // Update agent state
          await fetch(`/api/ai/agents/${agent.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lastPrice: currentPrice,
              lastCheckAt: new Date().toISOString(),
              lastAlertAt: new Date().toISOString(),
            }),
          });

          // Log the check
          await fetch('/api/ai/agents/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: agent.id,
              type: 'alert',
              content: alertMessage,
              priceAt: currentPrice,
            }),
          });
        }
      }
    } finally {
      checkingRef.current = false;
    }
  }, [enabled, agents, currentPrice, addAgentAlert]);

  // Fetch agents on mount
  useEffect(() => {
    if (enabled) {
      fetchAgents();
    }
  }, [enabled, fetchAgents]);

  // Check thresholds when price changes significantly
  useEffect(() => {
    if (!enabled || currentPrice <= 0) return;

    // Only check if price changed by at least 0.1%
    const priceDiff = Math.abs(currentPrice - lastPriceRef.current);
    const percentDiff = (priceDiff / (lastPriceRef.current || currentPrice)) * 100;

    if (percentDiff >= 0.1 || lastPriceRef.current === 0) {
      lastPriceRef.current = currentPrice;
      checkThresholds();
    }
  }, [enabled, currentPrice, checkThresholds]);

  return {
    agents,
    loading,
    createAgent,
    deactivateAgent,
    fetchAgents,
  };
}

/**
 * Send a browser notification (requests permission if needed)
 */
function sendNotification(title: string, body: string) {
  if (typeof window === 'undefined') return;

  if (!('Notification' in window)) {
    console.log('Browser does not support notifications');
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'position-alert',
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          tag: 'position-alert',
        });
      }
    });
  }
}
