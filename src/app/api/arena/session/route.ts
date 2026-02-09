/**
 * POST /api/arena/session - Create a new arena session
 */

import { NextRequest, NextResponse } from 'next/server';
import { ArenaOrchestrator } from '@/lib/arena/orchestrator';
import { AGENT_ARCHETYPES, getRandomArchetypes, archetypeToGeneratedConfig } from '@/lib/arena/archetypes';
import type { ArenaSessionConfig } from '@/lib/arena/types';
import { DEFAULT_SESSION_CONFIG } from '@/lib/arena/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config: ArenaSessionConfig = {
      ...DEFAULT_SESSION_CONFIG,
      ...body,
      pair: 'XRPEUR', // Always XRP/EUR
    };

    // Validate
    if (config.agentCount < 2 || config.agentCount > 8) {
      return NextResponse.json(
        { error: 'Agent count must be between 2 and 8' },
        { status: 400 }
      );
    }

    if (config.startingCapital < 100 || config.startingCapital > 100000) {
      return NextResponse.json(
        { error: 'Starting capital must be between 100 and 100,000 EUR' },
        { status: 400 }
      );
    }

    // Select archetypes
    const archetypes = config.archetypeIds
      ? AGENT_ARCHETYPES.filter(a => config.archetypeIds!.includes(a.id)).slice(0, config.agentCount)
      : getRandomArchetypes(config.agentCount);

    if (archetypes.length < config.agentCount) {
      // Fill remaining with random
      const remaining = getRandomArchetypes(config.agentCount - archetypes.length);
      archetypes.push(...remaining);
    }

    const agentConfigs = archetypes.map((arch, i) => archetypeToGeneratedConfig(arch, i));

    const orchestrator = ArenaOrchestrator.getInstance();
    const { sessionId, agents } = await orchestrator.createSession(config, agentConfigs);

    return NextResponse.json({
      sessionId,
      config,
      agents: agents.map(a => ({
        agentId: a.agentId,
        name: a.name,
        archetypeId: a.archetypeId,
        avatarShape: a.avatarShape,
        colorIndex: a.colorIndex,
        startingCapital: a.startingCapital,
      })),
    });
  } catch (error) {
    console.error('[Arena] Create session error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create session' },
      { status: 500 }
    );
  }
}
