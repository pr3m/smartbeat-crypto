/**
 * Master Agent - AI-Powered Agent Roster Generator
 *
 * Makes a single LLM call to generate a full roster of unique, diverse
 * AI trading agents for the Arena. Each agent gets a complete TradingStrategy,
 * personality, commentary templates, and visual identity.
 *
 * The quality of agents depends entirely on the system prompt - it must be
 * detailed enough for the LLM to produce valid, diverse strategies that
 * pass validation.
 */

import { createOpenAIClient } from '@/lib/ai/client';
import { trackAIUsage } from '@/lib/ai/usage-tracker';
import { validateStrategy } from './strategy-validator';
import type {
  GeneratedAgentConfig,
  MasterAgentRoster,
  AvatarShape,
  CommentaryTrigger,
} from './types';
import { estimateTokenCost } from './types';

// ============================================================================
// CONSTANTS
// ============================================================================

const AVATAR_SHAPES: AvatarShape[] = [
  'hexagon', 'diamond', 'circle', 'triangle',
  'square', 'pentagon', 'octagon', 'star',
];

const COMMENTARY_TRIGGERS: CommentaryTrigger[] = [
  'on_entry', 'on_exit_profit', 'on_exit_loss', 'on_death', 'on_rival_death',
];

// ============================================================================
// SYSTEM PROMPT BUILDER
// ============================================================================

function buildSystemPrompt(
  agentCount: number,
  sessionDurationHours: number,
  marketContext?: { price: number; btcTrend: string; volatility: string }
): string {
  const marketSection = marketContext
    ? `
CURRENT MARKET CONDITIONS:
- XRP/EUR price: €${marketContext.price.toFixed(4)}
- BTC trend: ${marketContext.btcTrend}
- Volatility regime: ${marketContext.volatility}

Factor these conditions into each agent's commentary and philosophy. Some agents
should be excited about the current conditions, others nervous, others dismissive.
`
    : '';

  return `You are a professional crypto trading arena master who designs AI trading competitions.

Your job is to create ${agentCount} UNIQUE AI trading agents for a paper trading arena session.
The session lasts ${sessionDurationHours} hours. All agents trade XRPEUR with 10x leverage on paper.

CRITICAL RULES:
- No stop losses (risk.useStopLoss = false always)
- No fixed take-profit (risk.useFixedTP = false always)
- Accept liquidation risk (risk.acceptLiquidation = true always)
- All agents trade XRPEUR only
- Leverage is always 10x (positionSizing.leverage = 10)
- This is paper trading — agents should be bold and varied

${marketSection}
DIVERSITY REQUIREMENTS — EVERY agent must be meaningfully different:
1. TIMEFRAME FOCUS: Spread agents across different timeframe priorities.
   - Some should be scalpers (heavy 5m/15m weights)
   - Some should be swing traders (heavy 4h/1d weights)
   - Some should be balanced multi-timeframe traders
   - At least one should be a "big picture" trader (1d dominant)

2. ENTRY AGGRESSION: Vary how eagerly agents enter trades.
   - Conservative: high minEntryConfidence (70-85), low margin (5-8%)
   - Moderate: balanced confidence (55-65), moderate margin (10-15%)
   - Aggressive: low minEntryConfidence (40-55), high margin (15-20%)
   - Degenerate: lowest confidence thresholds, maximum margin

3. DCA PHILOSOPHY: Different averaging-down approaches.
   - No-DCA purists (maxDCACount = 0)
   - Careful DCA (maxDCACount = 1, small dcaMarginPercent)
   - Heavy DCA believers (maxDCACount = 2-3, large dcaMarginPercent)

4. TIMEBOX STYLE: Different position holding durations.
   - Flash traders: maxHours 0.5-1, linear pressure
   - Day traders: maxHours 2-4, exponential pressure
   - Patient holders: maxHours up to ${sessionDurationHours}, step or linear pressure

5. SIGNAL PREFERENCES: Different indicator focuses.
   - RSI-obsessed agents
   - MACD momentum readers
   - Bollinger Band mean-reversion traders
   - Volume spike hunters
   - Multi-indicator synthesizers

6. REGIME PREFERENCES: How agents feel about market conditions.
   - Trend followers (trending: 0.5-1.0, ranging: -0.5 to 0)
   - Range traders (ranging: 0.5-1.0, trending: -0.3 to 0.2)
   - Volatility lovers (volatile: 0.5-1.0)
   - Each value ranges from -1.0 (hates this regime) to 1.0 (loves it)

AGENT NAMES:
Names MUST be humorous, creative, and memorable. Think trading floor nicknames.
Examples of good names: "HODL McBagface", "Sir Leverages-A-Lot", "The Liquidator",
"Diamond Hands Dave", "Paperhands Pete", "Dip Buyer Supreme", "Señor Fibonacci",
"Captain Timebox", "RSI Whisperer", "The Bollinger Bandit", "Margin Call Mary".
Each name should hint at the agent's trading personality.

PERSONALITY:
Each agent needs a ~100 word personality description written in the voice of a
character. This is used as the agent's system prompt when it makes trading decisions.
It should describe their trading philosophy, emotional tendencies, risk appetite,
and what makes them unique. Write it as if describing a character in a trading movie.

COMMENTARY TEMPLATES:
Each agent needs 3-5 templates per trigger event. Templates use {variable} placeholders.
Available variables: {name}, {direction}, {price}, {pnl}, {pnlPercent}, {rival},
{marginPercent}, {confidence}, {timeHeld}.

Template style should match the agent's personality — cocky agents should brag,
cautious agents should hedge, degenerate agents should sound unhinged.

Triggers required:
- on_entry: When the agent opens a trade (3-5 templates)
- on_exit_profit: When closing in profit (3-5 templates)
- on_exit_loss: When closing at a loss (3-5 templates)
- on_death: When the agent gets liquidated or goes bankrupt (3-5 templates)
- on_rival_death: When another agent dies (3-5 templates)

TRADING STRATEGY SCHEMA:
Each agent needs a complete "strategy" object. Here are the parameter ranges:

timeframeWeights: Object with keys "1d", "4h", "1h", "15m", "5m"
  - 5 numeric values that MUST sum to exactly 100
  - Each value represents the weight (%) given to that timeframe
  - Example scalper: {"1d": 5, "4h": 10, "1h": 15, "15m": 30, "5m": 40}
  - Example swing:  {"1d": 25, "4h": 35, "1h": 25, "15m": 10, "5m": 5}

positionSizing:
  - leverage: 10 (always 10, do not change)
  - fullEntryMarginPercent: 5-20 (margin % for full-confidence entries)
  - cautiousEntryMarginPercent: 3-15 (margin % for lower-confidence entries)
  - minEntryConfidence: 40-85 (minimum confidence to enter at all)
  - fullEntryConfidence: 60-95 (confidence needed for full-size entry)
  - maxDCACount: 0-3 (how many DCA entries allowed)
  - dcaMarginPercent: 3-15 (margin % per DCA entry)
  - maxTotalMarginPercent: 10-80 (max total margin after all entries)
  - minFreeMarginPercent: 20-90 (minimum free margin to keep as safety buffer)

timebox:
  - maxHours: 0.5 to ${sessionDurationHours} (max position hold time)
  - escalationStartHours: should be roughly half of maxHours
  - pressureCurve: "linear" | "exponential" | "step"
  - steps: Array of {hours, pressure, label} objects (used when pressureCurve="step")
    - Include 2-4 step entries, e.g. [{hours: 1, pressure: 20, label: "Warming up"}, ...]

spike:
  - volumeRatioThreshold: 1.5-3.0 (volume spike multiplier)
  - oversoldRSI: 15-40 (RSI below this = oversold)
  - overboughtRSI: 60-85 (RSI above this = overbought)

signals:
  - actionThreshold: 35-65 (minimum direction score to act)
  - directionLeadThreshold: 5-20 (minimum lead over opposite direction)
  - sitOnHandsThreshold: 20-40 (below this = do nothing)
  - directionWeights: Object with keys "1dTrend", "4hTrend", "1hSetup", "15mEntry",
    "volume", "btcAlign", "macdMom", "flow", "liq", "candlestick"
    - Each weight 0-30, should reflect the agent's indicator preferences
    - A MACD-focused agent would have high "macdMom", lower others
    - A trend-following agent would have high "4hTrend" and "1dTrend"
  - gradeThresholds: {A: 75-90, B: 55-70, C: 35-55, D: 15-35}

risk:
  - useStopLoss: false (ALWAYS false)
  - useFixedTP: false (ALWAYS false)
  - acceptLiquidation: true (ALWAYS true)

dca:
  - minDrawdownForDCA: 1-5 (minimum drawdown % before considering DCA)
  - minTimeBetweenDCAs: 60000-600000 (ms between DCAs, 1-10 min)
  - minExhaustionConfidence: 30-70 (minimum exhaustion signal confidence)
  - dcaSizeScaleFactor: 0.5-2.0 (how much to scale DCA size per level)
  - allowDCAAfterMidpoint: true or false
  - exhaustionThresholds: Object with keys:
    - rsiOversold: 20-35, rsiOverbought: 65-80
    - volumeDecline5m: 0.5-0.9, volumeFading5m: 0.3-0.7, volumeDecline15m: 0.5-0.9
    - macdNearZero: 0.001-0.01, macdSignalProximity: 0.001-0.01
    - bbMiddleLow: 0.3-0.45, bbMiddleHigh: 0.55-0.7
    - priceStabilizingLookback: 3-8, priceStabilizingMinMatches: 2-4
    - minHoursBetweenByLevel: {"1": 0.5-2, "2": 1-3, "3": 2-4}

exit:
  - exitPressureThreshold: 50-80 (pressure score to trigger exit)
  - minConditionFlips: 2-4 (conditions that must flip for deterioration exit)
  - allowPartialExits: true or false
  - minProfitForExit: 0.5-5.0 (minimum EUR profit to consider exiting)

antiGreed:
  - enabled: true or false
  - drawdownThresholdPercent: 0.3-0.7 (how much drawdown from peak triggers exit)
  - minPnLToActivate: 2-20 (minimum EUR P&L before anti-greed kicks in)
  - minHWMToTrack: 3-25 (minimum high water mark EUR to start tracking)

meta:
  - name: Same as agent name
  - description: One-sentence strategy description
  - version: "1.0.0"
  - pair: "XRPEUR"
  - author: "arena-master"

OUTPUT FORMAT:
Respond with ONLY valid JSON (no markdown, no explanation, no code fences).
The JSON must match this exact schema:

{
  "sessionTheme": "A fun, creative theme for this arena session (e.g. 'Battle of the Bollinger Bands', 'The Great XRP Showdown')",
  "masterCommentary": "2-3 sentences of hype introduction from you, the arena master, setting the stage for the competition",
  "agents": [
    {
      "name": "Agent Name Here",
      "personality": "~100 word personality description...",
      "archetypeId": "slug_style_id",
      "tradingPhilosophy": "One-liner trading philosophy",
      "primaryIndicators": ["RSI_15m", "MACD_1h", "BB_4h"],
      "marketRegimePreference": {
        "trending": 0.5,
        "ranging": -0.3,
        "volatile": 0.8
      },
      "commentaryTemplates": {
        "on_entry": ["template1...", "template2...", "template3..."],
        "on_exit_profit": ["template1...", "template2...", "template3..."],
        "on_exit_loss": ["template1...", "template2...", "template3..."],
        "on_death": ["template1...", "template2...", "template3..."],
        "on_rival_death": ["template1...", "template2...", "template3..."]
      },
      "strategy": {
        "meta": { "name": "...", "description": "...", "version": "1.0.0", "pair": "XRPEUR", "author": "arena-master" },
        "timeframeWeights": { "1d": 10, "4h": 25, "1h": 30, "15m": 25, "5m": 10 },
        "positionSizing": { ... },
        "timebox": { ... },
        "spike": { ... },
        "signals": { ... },
        "risk": { "useStopLoss": false, "useFixedTP": false, "acceptLiquidation": true },
        "dca": { ... },
        "exit": { ... },
        "antiGreed": { ... }
      }
    }
  ]
}

Generate exactly ${agentCount} agents. Each must be genuinely different in strategy,
personality, and trading approach. Do NOT create slight variations of the same agent.
Make them compete with fundamentally different philosophies.`;
}

// ============================================================================
// JSON EXTRACTION
// ============================================================================

/**
 * Extract JSON from LLM response, handling potential markdown fences
 * or extra text around the JSON.
 */
function extractJSON(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract from markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      return JSON.parse(fenceMatch[1].trim());
    }

    // Try to find the first { ... } block
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }

    throw new Error('Could not extract valid JSON from LLM response');
  }
}

// ============================================================================
// RESPONSE VALIDATION
// ============================================================================

interface RawAgentResponse {
  name?: string;
  personality?: string;
  archetypeId?: string;
  tradingPhilosophy?: string;
  primaryIndicators?: string[];
  marketRegimePreference?: {
    trending?: number;
    ranging?: number;
    volatile?: number;
  };
  commentaryTemplates?: Partial<Record<string, string[]>>;
  strategy?: unknown;
}

interface RawRosterResponse {
  sessionTheme?: string;
  masterCommentary?: string;
  agents?: RawAgentResponse[];
}

function clampRegime(value: unknown): number {
  const n = typeof value === 'number' ? value : 0;
  return Math.max(-1, Math.min(1, n));
}

/**
 * Validate and enrich the raw LLM response into a proper MasterAgentRoster.
 */
function processRosterResponse(
  raw: RawRosterResponse,
  sessionDurationHours: number
): GeneratedAgentConfig[] {
  const rawAgents = raw.agents;
  if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
    throw new Error('LLM response contains no agents array');
  }

  const agents: GeneratedAgentConfig[] = [];

  for (let i = 0; i < rawAgents.length; i++) {
    const rawAgent = rawAgents[i];

    // Validate required string fields
    const name = rawAgent.name || `Agent ${i + 1}`;
    const personality = rawAgent.personality || 'A mysterious trader with unknown motivations.';
    const archetypeId = rawAgent.archetypeId || `agent_${i}`;
    const tradingPhilosophy = rawAgent.tradingPhilosophy || 'Trade hard, trade often.';
    const primaryIndicators = Array.isArray(rawAgent.primaryIndicators)
      ? rawAgent.primaryIndicators
      : ['RSI_15m', 'MACD_1h'];

    // Validate market regime preferences
    const regime = rawAgent.marketRegimePreference || {};
    const marketRegimePreference = {
      trending: clampRegime(regime.trending),
      ranging: clampRegime(regime.ranging),
      volatile: clampRegime(regime.volatile),
    };

    // Validate commentary templates
    const rawTemplates = rawAgent.commentaryTemplates || {};
    const commentaryTemplates: Partial<Record<CommentaryTrigger, string[]>> = {};
    for (const trigger of COMMENTARY_TRIGGERS) {
      const templates = rawTemplates[trigger];
      if (Array.isArray(templates) && templates.length > 0) {
        commentaryTemplates[trigger] = templates.filter(
          (t): t is string => typeof t === 'string' && t.length > 0
        );
      }
    }

    // Validate and correct strategy via strategy-validator
    const validated = validateStrategy(rawAgent.strategy, sessionDurationHours);
    if (validated.errors.length > 0) {
      console.warn(
        `[MasterAgent] Agent "${name}" strategy had errors (auto-corrected):`,
        validated.errors
      );
    }
    if (validated.warnings.length > 0) {
      console.info(
        `[MasterAgent] Agent "${name}" strategy warnings:`,
        validated.warnings.slice(0, 5) // limit noise
      );
    }

    // Assign visual identity: round-robin shape, sequential color
    const avatarShape = AVATAR_SHAPES[i % AVATAR_SHAPES.length];
    const colorIndex = i;

    agents.push({
      name,
      personality,
      avatarShape,
      colorIndex,
      archetypeId,
      strategy: validated.corrected,
      commentaryTemplates,
      tradingPhilosophy,
      marketRegimePreference,
      primaryIndicators,
    });
  }

  return agents;
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Generate a full roster of unique AI trading agents via a single LLM call.
 *
 * @param agentCount - Number of agents to generate (3-8)
 * @param sessionDurationHours - How long the session lasts (affects timebox ranges)
 * @param modelId - OpenAI model to use (e.g. 'gpt-4o-mini', 'gpt-4o')
 * @param marketContext - Optional current market conditions for contextual agents
 * @returns Complete roster with agents, theme, commentary, and cost info
 * @throws Error if LLM call fails or response cannot be parsed
 */
export async function generateAgentRoster(
  agentCount: number,
  sessionDurationHours: number,
  modelId: string,
  marketContext?: { price: number; btcTrend: string; volatility: string }
): Promise<MasterAgentRoster> {
  const startTime = Date.now();

  console.log(`[MasterAgent] Generating ${agentCount} agents for ${sessionDurationHours}h session using ${modelId}`);

  // Build the system prompt
  const systemPrompt = buildSystemPrompt(agentCount, sessionDurationHours, marketContext);
  console.log(`[MasterAgent] System prompt: ${systemPrompt.length} chars (~${Math.ceil(systemPrompt.length / 4)} tokens)`);

  // Create a fresh client for this call
  const client = createOpenAIClient({
    model: modelId,
    temperature: 0.7,
    maxTokens: 6000,
  });

  // Make the LLM call
  let responseText: string;
  let inputTokens = 0;
  let outputTokens = 0;

  console.log(`[MasterAgent] Calling LLM...`);
  try {
    const response = await client.invoke([
      { role: 'system' as const, content: systemPrompt },
      {
        role: 'user' as const,
        content: `Generate ${agentCount} unique AI trading agents for a ${sessionDurationHours}-hour arena session. Output ONLY valid JSON.`,
      },
    ]);

    // Extract text content from the response
    responseText = typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .filter((block): block is { type: 'text'; text: string } =>
              typeof block === 'object' && block !== null && 'type' in block && block.type === 'text'
            )
            .map(block => block.text)
            .join('')
        : String(response.content);

    // Extract token usage from response metadata
    const usage = response.response_metadata?.tokenUsage ||
      response.usage_metadata ||
      (response.response_metadata as Record<string, unknown>)?.usage;

    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, number>;
      inputTokens = u.promptTokens || u.prompt_tokens || u.input_tokens || u.totalTokens || 0;
      outputTokens = u.completionTokens || u.completion_tokens || u.output_tokens || 0;
    }

    // Fallback token estimation if metadata unavailable
    if (inputTokens === 0) {
      // Rough estimate: ~4 chars per token
      inputTokens = Math.ceil((systemPrompt.length + 100) / 4);
    }
    if (outputTokens === 0) {
      outputTokens = Math.ceil(responseText.length / 4);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[MasterAgent] LLM call failed after ${Date.now() - startTime}ms:`, errMsg);
    throw new Error(`Master Agent LLM call failed: ${errMsg}`);
  }

  console.log(`[MasterAgent] LLM responded in ${Date.now() - startTime}ms — ${responseText.length} chars, ${inputTokens} in / ${outputTokens} out tokens`);

  // Parse the JSON response
  let rawRoster: RawRosterResponse;
  try {
    rawRoster = extractJSON(responseText) as RawRosterResponse;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Master Agent failed to parse LLM response as JSON: ${errMsg}. ` +
      `Response preview: "${responseText.slice(0, 200)}..."`
    );
  }

  console.log(`[MasterAgent] Parsed JSON — theme: "${rawRoster.sessionTheme}", ${rawRoster.agents?.length ?? 0} agents`);

  // Process and validate all agents
  const agents = processRosterResponse(rawRoster, sessionDurationHours);

  // Calculate cost
  const costUsd = estimateTokenCost(modelId, inputTokens, outputTokens);
  const durationMs = Date.now() - startTime;

  // Track usage asynchronously (don't block return)
  trackAIUsage({
    feature: 'arena_agent',
    model: modelId,
    inputTokens,
    outputTokens,
    success: true,
    durationMs,
    endpoint: 'master-agent/generateRoster',
    userContext: `Generated ${agents.length} agents for ${sessionDurationHours}h session`,
  }).catch((err) => {
    console.error('[MasterAgent] Failed to track usage:', err);
  });

  console.log(`[MasterAgent] Done in ${durationMs}ms — ${agents.length} agents validated, cost $${costUsd.toFixed(4)}`);
  for (const a of agents) {
    console.log(`[MasterAgent]   → ${a.name} (${a.archetypeId}) — TF: ${JSON.stringify(a.strategy.timeframeWeights)}, DCA: ${a.strategy.positionSizing.maxDCACount}, Timebox: ${a.strategy.timebox.maxHours}h`);
  }

  return {
    agents,
    sessionTheme: rawRoster.sessionTheme || 'The Arena Awaits',
    masterCommentary: rawRoster.masterCommentary || 'Let the trading games begin!',
    tokensUsed: { input: inputTokens, output: outputTokens },
    costUsd,
  };
}
