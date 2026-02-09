/**
 * GET /api/arena/stream - SSE endpoint for real-time arena events
 *
 * Translates ArenaEvent objects from the orchestrator into typed SSE messages
 * that the ArenaProvider can dispatch to the Zustand store.
 */

import { ArenaOrchestrator } from '@/lib/arena/orchestrator';
import type { ArenaEvent } from '@/lib/arena/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const orchestrator = ArenaOrchestrator.getInstance();

  const send = async (data: Record<string, unknown>) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      // Writer closed
    }
  };

  // Translate ArenaEvent into typed SSE message the provider understands
  const sendEvent = async (event: ArenaEvent) => {
    try {
      const meta = (event.metadata ?? {}) as Record<string, unknown>;

      switch (event.type) {
        case 'tick':
          // Send tick with flattened metadata
          await send({
            type: 'tick',
            data: {
              priceAt: event.priceAt,
              price: event.priceAt,
              elapsedMs: meta.elapsedMs,
              tick: meta.tick,
              agents: meta.agents,
              rankings: meta.rankings,
            },
          });
          break;

        case 'session_started':
        case 'session_paused':
        case 'session_resumed':
        case 'session_ended':
          await send({
            type: 'session_status',
            data: {
              status: event.type === 'session_started' ? 'running'
                : event.type === 'session_paused' ? 'paused'
                : event.type === 'session_resumed' ? 'running'
                : 'completed',
              sessionId: orchestrator.getSessionId(),
              config: orchestrator.getConfig(),
              summary: event.type === 'session_ended' ? meta.summary : undefined,
            },
          });
          // Also send as feed event
          await send({ type: 'event', data: { event } });
          // On start/resume, immediately push agent states so UI populates without waiting for first tick
          if (event.type === 'session_started' || event.type === 'session_resumed') {
            const agents = orchestrator.getAgentStates();
            if (agents.length > 0) {
              await send({ type: 'agent_update', data: { agents } });
            }
          }
          break;

        case 'agent_death':
        case 'trade_open':
        case 'trade_close':
        case 'trade_dca':
        case 'badge_earned':
        case 'face_off':
        case 'lead_change':
        case 'near_death':
        case 'hot_streak':
        case 'comeback':
        case 'market_shock':
        case 'milestone':
        case 'agent_hold':
        case 'agent_wait':
        case 'agent_analyzing':
        case 'agent_action':
          // All activity events go to the feed
          await send({ type: 'event', data: { event } });
          break;

        default:
          // Any other event goes to feed
          if (event.id && event.type) {
            await send({ type: 'event', data: { event } });
          }
          break;
      }
    } catch {
      // Writer closed
    }
  };

  // Subscribe to orchestrator events
  const unsubscribe = orchestrator.subscribe(sendEvent);

  // Heartbeat every 15 seconds
  const heartbeat = setInterval(async () => {
    try {
      await writer.write(encoder.encode(': heartbeat\n\n'));
    } catch {
      clearInterval(heartbeat);
      unsubscribe();
    }
  }, 15000);

  // Start background - send initial state after response is returned
  (async () => {
    const status = orchestrator.getStatus();
    const sessionId = orchestrator.getSessionId();

    // Build agent strategies/configs for restoration
    const agentConfigsMap = orchestrator.getAgentConfigsMap();
    const agentStrategies: Record<string, unknown> = {};
    const agentConfigsData: Record<string, unknown> = {};
    for (const [id, cfg] of agentConfigsMap) {
      agentStrategies[id] = cfg.strategy;
      agentConfigsData[id] = {
        personality: cfg.personality,
        tradingPhilosophy: cfg.tradingPhilosophy,
        primaryIndicators: cfg.primaryIndicators,
        marketRegimePreference: cfg.marketRegimePreference,
        commentaryTemplates: cfg.commentaryTemplates,
      };
    }

    // Send connected message with full restoration data
    await send({
      type: 'connected',
      status,
      sessionId,
      tick: orchestrator.getCurrentTick(),
      elapsedMs: orchestrator.getElapsedMs(),
      config: sessionId ? orchestrator.getConfig() : null,
      currentPrice: orchestrator.getCurrentPrice() || undefined,
      agentStrategies: Object.keys(agentStrategies).length > 0 ? agentStrategies : undefined,
      agentConfigs: Object.keys(agentConfigsData).length > 0 ? agentConfigsData : undefined,
      rosterIntro: orchestrator.getRosterIntro() || undefined,
      timestamp: Date.now(),
    });

    // Send current agent states + rankings if session exists
    const agents = orchestrator.getAgentStates();
    if (agents.length > 0) {
      await send({
        type: 'agent_update',
        data: { agents },
      });
      const rankings = orchestrator.getRankings();
      if (rankings.length > 0) {
        await send({ type: 'leaderboard', data: { rankings } });
      }
    }

    // Replay buffered events so client gets full activity feed history
    const bufferedEvents = orchestrator.getEventBuffer();
    if (bufferedEvents.length > 0) {
      await send({
        type: 'event_replay',
        data: { events: bufferedEvents },
      });
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
