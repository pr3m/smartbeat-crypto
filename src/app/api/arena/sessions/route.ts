/**
 * GET /api/arena/sessions - List historical sessions
 * POST /api/arena/sessions - Session control (start, pause, resume, stop)
 */

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ArenaOrchestrator } from '@/lib/arena/orchestrator';
import { AGENT_ARCHETYPES, getRandomArchetypes, archetypeToGeneratedConfig } from '@/lib/arena/archetypes';
import { generateAgentRoster } from '@/lib/arena/master-agent';
import { DEFAULT_SESSION_CONFIG } from '@/lib/arena/types';
import type { ArenaSessionConfig, GeneratedAgentConfig } from '@/lib/arena/types';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const [sessions, total] = await Promise.all([
      prisma.arenaSession.findMany({
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: Math.min(limit, 50),
        include: {
          agents: {
            orderBy: { rank: 'asc' },
            take: 1,
            select: {
              name: true,
              totalPnl: true,
              rank: true,
            },
          },
          _count: {
            select: { agents: true },
          },
        },
      }),
      prisma.arenaSession.count(),
    ]);

    return NextResponse.json({
      sessions: sessions.map(s => ({
        id: s.id,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        totalRunTimeMs: s.totalRunTimeMs,
        startPrice: s.startPrice,
        endPrice: s.endPrice,
        agentCount: s._count.agents,
        winner: s.agents[0] ?? null,
        config: JSON.parse(s.config),
      })),
      total,
    });
  } catch (error) {
    console.error('[Arena] List sessions error:', error);
    return NextResponse.json(
      { error: 'Failed to list sessions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;
    const orchestrator = ArenaOrchestrator.getInstance();

    switch (action) {
      case 'start': {
        const config: ArenaSessionConfig = {
          ...DEFAULT_SESSION_CONFIG,
          ...body.config,
          pair: 'XRPEUR',
        };

        if (config.agentCount < 2 || config.agentCount > 8) {
          return NextResponse.json(
            { error: 'Agent count must be between 2 and 8' },
            { status: 400 }
          );
        }

        // Stream progress events as NDJSON
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: { type: string; message?: string; [key: string]: unknown }) => {
              controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
            };

            try {
              let agentConfigs: GeneratedAgentConfig[];
              let rosterIntro: {
                theme: string;
                masterCommentary: string;
                generationCost: { inputTokens: number; outputTokens: number; costUsd: number };
              } | null = null;

              if (config.useMasterAgent !== false) {
                // AI-generated agents via Master Agent
                send({ type: 'progress', message: `Connecting to AI (${config.modelId})...` });

                try {
                  send({ type: 'progress', message: `Generating ${config.agentCount} unique agents...` });

                  const roster = await generateAgentRoster(
                    config.agentCount,
                    config.maxDurationHours,
                    config.modelId
                  );
                  agentConfigs = roster.agents;
                  rosterIntro = {
                    theme: roster.sessionTheme,
                    masterCommentary: roster.masterCommentary,
                    generationCost: {
                      inputTokens: roster.tokensUsed.input,
                      outputTokens: roster.tokensUsed.output,
                      costUsd: roster.costUsd,
                    },
                  };

                  send({
                    type: 'progress',
                    message: `Validated ${agentConfigs.length} agents (${roster.tokensUsed.input + roster.tokensUsed.output} tokens, $${roster.costUsd.toFixed(4)})`,
                  });
                } catch (err) {
                  console.warn('[Arena] Master agent failed, falling back to classic archetypes:', err);
                  send({ type: 'progress', message: 'AI generation failed, falling back to classic archetypes...' });
                  const archetypes = getRandomArchetypes(config.agentCount);
                  agentConfigs = archetypes.map((a, i) => archetypeToGeneratedConfig(a, i));
                }
              } else {
                send({ type: 'progress', message: 'Loading classic archetypes...' });
                const archetypes = config.archetypeIds
                  ? AGENT_ARCHETYPES.filter(a => config.archetypeIds!.includes(a.id)).slice(0, config.agentCount)
                  : getRandomArchetypes(config.agentCount);

                if (archetypes.length < config.agentCount) {
                  const remaining = getRandomArchetypes(config.agentCount - archetypes.length);
                  archetypes.push(...remaining);
                }
                agentConfigs = archetypes.map((a, i) => archetypeToGeneratedConfig(a, i));
              }

              // Create session + start
              send({ type: 'progress', message: 'Creating session & initializing agents...' });
              const { sessionId, agents } = await orchestrator.createSession(config, agentConfigs);

              // Store roster intro in orchestrator for reconnect restoration
              if (rosterIntro) {
                orchestrator.setRosterIntro(rosterIntro);
              }

              send({ type: 'progress', message: 'Fetching market data & starting arena...' });
              await orchestrator.start();

              // Build comprehensive response for UI
              const agentStrategies: Record<string, unknown> = {};
              const agentConfigsMap: Record<string, unknown> = {};

              agents.forEach((a, i) => {
                if (agentConfigs[i]) {
                  agentStrategies[a.agentId] = agentConfigs[i].strategy;
                  agentConfigsMap[a.agentId] = {
                    personality: agentConfigs[i].personality,
                    tradingPhilosophy: agentConfigs[i].tradingPhilosophy,
                    primaryIndicators: agentConfigs[i].primaryIndicators,
                    marketRegimePreference: agentConfigs[i].marketRegimePreference,
                    commentaryTemplates: agentConfigs[i].commentaryTemplates,
                  };
                }
              });

              send({
                type: 'done',
                sessionId,
                config,
                agents: agents.map((a, i) => ({
                  agentId: a.agentId,
                  name: a.name,
                  archetypeId: a.archetypeId,
                  avatarShape: a.avatarShape,
                  colorIndex: a.colorIndex,
                  startingCapital: a.startingCapital,
                  tradingPhilosophy: agentConfigs[i]?.tradingPhilosophy ?? '',
                  primaryIndicators: agentConfigs[i]?.primaryIndicators ?? [],
                  marketRegimePreference: agentConfigs[i]?.marketRegimePreference,
                })),
                agentStrategies,
                agentConfigs: agentConfigsMap,
                rosterIntro,
              });
            } catch (err) {
              console.error('[Arena] Session start stream error:', err);
              send({
                type: 'error',
                error: err instanceof Error ? err.message : 'Failed to start session',
              });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            'Transfer-Encoding': 'chunked',
          },
        });
      }

      case 'pause':
        await orchestrator.pause();
        return NextResponse.json({ status: 'paused' });

      case 'resume':
        await orchestrator.resume();
        return NextResponse.json({ status: 'running' });

      case 'stop': {
        const summary = await orchestrator.stop();
        return NextResponse.json({ status: 'completed', summary });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Arena] Session action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to perform action' },
      { status: 500 }
    );
  }
}
