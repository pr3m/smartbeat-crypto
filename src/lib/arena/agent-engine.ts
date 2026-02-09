/**
 * Arena Agent Engine
 *
 * Core decision-making class for arena agents.
 * Three-tier decision system:
 * - Tier 1 (rule-based, ~70%): Uses generateRecommendation() with agent's strategy params
 * - Tier 2 (structured LLM, ~25%): GPT for ambiguous signals
 * - Tier 3 (full LLM, ~5%): Detailed reasoning on trade execution events
 */

import { generateRecommendation } from '@/lib/trading/recommendation';
import type { TradingStrategy } from '@/lib/trading/v2-types';
import type { TimeframeData, TradingRecommendation } from '@/lib/kraken/types';
import { createOpenAIClient, isOpenAIConfigured } from '@/lib/ai/client';
import { trackAIUsage } from '@/lib/ai/usage-tracker';
import { getAgentDecisionPrompt } from './prompt-loader';
import type {
  GeneratedAgentConfig,
  AgentActivity,
  AgentState,
  AgentDecision,
  ArenaAction,
  SharedMarketData,
  HealthZone,
} from './types';
import { getHealthZone, estimateTokenCost } from './types';

// ============================================================================
// AGENT ENGINE
// ============================================================================

export class ArenaAgentEngine {
  readonly config: GeneratedAgentConfig;
  readonly strategy: TradingStrategy;
  private modelId: string;
  private budgetRemaining: number;
  private consecutiveHolds: number = 0;

  constructor(config: GeneratedAgentConfig, modelId: string, agentBudget: number) {
    this.config = config;
    this.modelId = modelId;
    this.budgetRemaining = agentBudget;

    // Already complete strategy, no merge needed
    this.strategy = config.strategy;
  }

  /**
   * Main decision method - called every tick
   */
  async evaluate(
    state: AgentState,
    market: SharedMarketData,
    tickNumber: number
  ): Promise<AgentDecision> {
    // Dead agents don't decide
    if (state.isDead) {
      return { action: 'wait', reasoning: 'Agent is dead', confidence: 0, usedLLM: false };
    }

    // Get recommendation using agent's mutated strategy
    const recommendation = this.getRecommendation(market);
    const healthZone = getHealthZone(state.health);

    // Tier 1: Rule-based decision (~70% of decisions)
    const ruleDecision = this.evaluateRules(state, market, recommendation, healthZone);

    if (ruleDecision.confidence >= 70 || ruleDecision.action === 'hold' || ruleDecision.action === 'wait') {
      // High confidence rule-based or hold/wait -> use directly
      this.consecutiveHolds = ruleDecision.action === 'hold' || ruleDecision.action === 'wait'
        ? this.consecutiveHolds + 1
        : 0;
      return ruleDecision;
    }

    // Tier 2: Structured LLM for ambiguous signals (~25%)
    // Only if we have budget and the signal is ambiguous (30-70 confidence)
    if (
      this.budgetRemaining > 0 &&
      ruleDecision.confidence >= 30 &&
      ruleDecision.confidence < 70 &&
      isOpenAIConfigured()
    ) {
      try {
        const llmDecision = await this.evaluateWithLLM(state, market, recommendation, ruleDecision);
        this.consecutiveHolds = 0;
        return llmDecision;
      } catch {
        // LLM failed, fall back to rule-based
        return ruleDecision;
      }
    }

    // Fall back to rule-based
    return ruleDecision;
  }

  // ============================================================================
  // TIER 1: RULE-BASED EVALUATION
  // ============================================================================

  private evaluateRules(
    state: AgentState,
    market: SharedMarketData,
    recommendation: TradingRecommendation | null,
    healthZone: HealthZone
  ): AgentDecision {
    // If we have a position, evaluate exit/hold/dca
    if (state.hasPosition && state.position) {
      return this.evaluatePositionRules(state, market, recommendation, healthZone);
    }

    // No position - evaluate entry
    return this.evaluateEntryRules(state, market, recommendation, healthZone);
  }

  private evaluateEntryRules(
    state: AgentState,
    market: SharedMarketData,
    recommendation: TradingRecommendation | null,
    healthZone: HealthZone
  ): AgentDecision {
    // Dead or too unhealthy to trade (except death_row gets one last shot)
    if (healthZone === 'dead') {
      return { action: 'wait', reasoning: 'Dead', confidence: 0, usedLLM: false };
    }

    if (!recommendation) {
      return { action: 'wait', reasoning: 'No recommendation data available', confidence: 0, usedLLM: false };
    }

    const action = recommendation.action;
    const confidence = recommendation.confidence ?? 0;

    // Adjust confidence threshold based on health zone
    let confidenceThreshold = this.strategy.positionSizing.minEntryConfidence;
    if (healthZone === 'critical') {
      confidenceThreshold = Math.min(90, confidenceThreshold + 20);
    } else if (healthZone === 'danger') {
      confidenceThreshold = Math.min(85, confidenceThreshold + 10);
    } else if (healthZone === 'death_row') {
      // Death row: go for it with original threshold (last stand)
      confidenceThreshold = this.strategy.positionSizing.minEntryConfidence;
    }

    // Check regime preference
    const regimeBonus = this.getRegimeBonus(market);

    const effectiveConfidence = confidence + regimeBonus;

    if (action === 'LONG' && effectiveConfidence >= confidenceThreshold) {
      const marginPct = this.calculateMarginPercent(effectiveConfidence, healthZone);
      return {
        action: 'open_long',
        reasoning: `${this.config.name} sees LONG signal. Confidence: ${effectiveConfidence.toFixed(0)}%. ${recommendation.reason || ''}`,
        confidence: effectiveConfidence,
        usedLLM: false,
        marginPercent: marginPct,
      };
    }

    if (action === 'SHORT' && effectiveConfidence >= confidenceThreshold) {
      const marginPct = this.calculateMarginPercent(effectiveConfidence, healthZone);
      return {
        action: 'open_short',
        reasoning: `${this.config.name} sees SHORT signal. Confidence: ${effectiveConfidence.toFixed(0)}%. ${recommendation.reason || ''}`,
        confidence: effectiveConfidence,
        usedLLM: false,
        marginPercent: marginPct,
      };
    }

    return {
      action: 'wait',
      reasoning: `Waiting. Action: ${action}, Confidence: ${effectiveConfidence.toFixed(0)}% (need ${confidenceThreshold}%)`,
      confidence: effectiveConfidence,
      usedLLM: false,
    };
  }

  private evaluatePositionRules(
    state: AgentState,
    market: SharedMarketData,
    recommendation: TradingRecommendation | null,
    healthZone: HealthZone
  ): AgentDecision {
    const pos = state.position!;
    const holdDuration = Date.now() - pos.openedAt;
    const holdHours = holdDuration / (1000 * 60 * 60);
    const pnlPercent = pos.unrealizedPnlPercent;

    // 1. Check timebox expiry
    if (holdHours >= this.strategy.timebox.maxHours) {
      return {
        action: 'close',
        reasoning: `Timebox expired (${holdHours.toFixed(1)}h >= ${this.strategy.timebox.maxHours}h). Closing position.`,
        confidence: 95,
        usedLLM: false,
      };
    }

    // 2. Check if trend reversed strongly against position
    if (recommendation) {
      const trendAgainst =
        (pos.side === 'long' && recommendation.action === 'SHORT' && (recommendation.confidence ?? 0) >= 75) ||
        (pos.side === 'short' && recommendation.action === 'LONG' && (recommendation.confidence ?? 0) >= 75);

      if (trendAgainst) {
        return {
          action: 'close',
          reasoning: `Strong reversal signal detected. ${recommendation.action} at ${(recommendation.confidence ?? 0).toFixed(0)}% confidence.`,
          confidence: 85,
          usedLLM: false,
        };
      }
    }

    // 3. Anti-greed: if we're up significantly and starting to give back
    if (pnlPercent > 3) {
      // We're profitable - check if we should take profit
      const timeboxPressure = holdHours / this.strategy.timebox.maxHours;

      if (timeboxPressure > 0.6 && pnlPercent > 5) {
        return {
          action: 'close',
          reasoning: `Taking profit. Up ${pnlPercent.toFixed(1)}% with ${((1 - timeboxPressure) * this.strategy.timebox.maxHours).toFixed(1)}h remaining.`,
          confidence: 80,
          usedLLM: false,
        };
      }
    }

    // 4. Check for DCA opportunity
    if (
      pnlPercent < -2 &&
      pos.dcaCount < this.strategy.positionSizing.maxDCACount &&
      healthZone !== 'critical' &&
      healthZone !== 'death_row'
    ) {
      // Price moved against us - check if we should DCA
      const dcaConfidence = this.evaluateDCASignal(state, market, recommendation);
      if (dcaConfidence >= 60) {
        const dcaMargin = this.calculateMarginPercent(dcaConfidence, healthZone) * 0.5;
        return {
          action: 'dca',
          reasoning: `DCA opportunity. Position at ${pnlPercent.toFixed(1)}%, exhaustion signals present.`,
          confidence: dcaConfidence,
          usedLLM: false,
          marginPercent: dcaMargin,
        };
      }
    }

    // 5. Health-based exit
    if (healthZone === 'critical' && pnlPercent < -5) {
      return {
        action: 'close',
        reasoning: `Critical health (${state.health.toFixed(0)}%) with ${pnlPercent.toFixed(1)}% loss. Cutting losses.`,
        confidence: 85,
        usedLLM: false,
      };
    }

    // 6. Default: hold
    return {
      action: 'hold',
      reasoning: `Holding ${pos.side} position. P&L: ${pnlPercent.toFixed(1)}%, Duration: ${holdHours.toFixed(1)}h`,
      confidence: 50,
      usedLLM: false,
    };
  }

  // ============================================================================
  // TIER 2: LLM EVALUATION (for ambiguous signals)
  // ============================================================================

  private async evaluateWithLLM(
    state: AgentState,
    market: SharedMarketData,
    recommendation: TradingRecommendation | null,
    ruleDecision: AgentDecision
  ): Promise<AgentDecision> {
    const client = createOpenAIClient({
      model: this.modelId,
      temperature: 0.3,
      maxTokens: 500,
    });

    const positionInfo = state.hasPosition
      ? `${state.position!.side} at ${state.position!.avgEntryPrice}, P&L: ${state.position!.unrealizedPnlPercent.toFixed(1)}%`
      : 'None';

    const systemPrompt = getAgentDecisionPrompt({
      name: this.config.name,
      personality: this.config.personality,
      balance: state.balance.toFixed(2),
      health: state.health.toFixed(0),
      position_info: positionInfo,
      wins: String(state.winCount),
      losses: String(state.lossCount),
      price: market.price.toFixed(4),
      signal: recommendation?.action || 'WAIT',
      signal_confidence: String(recommendation?.confidence?.toFixed(0) ?? 0),
      rule_action: ruleDecision.action,
      rule_confidence: ruleDecision.confidence.toFixed(0),
    });

    const response = await client.invoke([{ role: 'user', content: systemPrompt }]);
    const content = typeof response.content === 'string' ? response.content : '';

    // Track token usage
    const usage = response.usage_metadata;
    const inputTokens = usage?.input_tokens ?? 200;
    const outputTokens = usage?.output_tokens ?? 50;
    const cost = estimateTokenCost(this.modelId, inputTokens, outputTokens);
    this.budgetRemaining -= cost;

    // Track usage to AI Usage DB (fire-and-forget)
    trackAIUsage({
      feature: 'arena_agent',
      model: this.modelId,
      inputTokens,
      outputTokens,
      success: true,
      userContext: `agent:${this.config.name}`,
    });

    // Parse LLM response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);

      return {
        action: parsed.action as ArenaAction,
        reasoning: `[LLM] ${parsed.reasoning}`,
        confidence: parsed.confidence ?? ruleDecision.confidence,
        usedLLM: true,
        marginPercent: parsed.marginPercent ?? ruleDecision.marginPercent,
        inputTokens,
        outputTokens,
      };
    } catch {
      // Parse failed, use rule decision but mark as LLM attempt
      return {
        ...ruleDecision,
        reasoning: `[LLM fallback] ${ruleDecision.reasoning}`,
        usedLLM: true,
        inputTokens,
        outputTokens,
      };
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private getRecommendation(market: SharedMarketData): TradingRecommendation | null {
    const tf4h = market.tfData['4h'];
    const tf1h = market.tfData['1h'];
    const tf15m = market.tfData['15m'];
    const tf5m = market.tfData['5m'];
    const tf1d = market.tfData['1d'];

    if (!tf4h || !tf1h || !tf15m || !tf5m) return null;

    return generateRecommendation(
      tf4h,
      tf1h,
      tf15m,
      tf5m,
      market.btcTrend,
      market.btcChange,
      null, // micro
      null, // liq
      tf1d || null,
      market.price,
      'kraken',
      'XRPEUR',
      this.strategy
    );
  }

  private calculateMarginPercent(confidence: number, healthZone: HealthZone): number {
    const minMargin = this.strategy.positionSizing.cautiousEntryMarginPercent;
    const maxMargin = this.strategy.positionSizing.fullEntryMarginPercent;

    // Base margin from confidence
    let marginPct = minMargin + (confidence / 100) * (maxMargin - minMargin);

    // Health-based adjustment
    switch (healthZone) {
      case 'caution':
        marginPct *= 0.9;
        break;
      case 'danger':
        marginPct *= 0.7;
        break;
      case 'critical':
        marginPct *= 0.5;
        break;
      case 'death_row':
        // Last stand - use full margin range
        marginPct = maxMargin;
        break;
    }

    return Math.max(minMargin, Math.min(maxMargin, marginPct));
  }

  private getRegimeBonus(market: SharedMarketData): number {
    // Detect market regime from indicators
    const tf1h = market.tfData['1h'];
    const tf4h = market.tfData['4h'];
    if (!tf1h?.indicators || !tf4h?.indicators) return 0;

    const atr = tf1h.indicators.atr ?? 0;
    const bbPosition = tf1h.indicators.bbPos ?? 0.5;

    // Simple regime detection
    let regime: 'trending' | 'ranging' | 'volatile' = 'ranging';
    if (atr > 0.005) {
      regime = 'volatile';
    } else if (Math.abs(bbPosition - 0.5) > 0.3) {
      regime = 'trending';
    }

    // Apply agent's regime preference
    const pref = this.config.marketRegimePreference;
    return pref[regime] * 10; // Convert preference (-1 to 1) to confidence bonus (-10 to +10)
  }

  private evaluateDCASignal(
    state: AgentState,
    market: SharedMarketData,
    recommendation: TradingRecommendation | null
  ): number {
    if (!recommendation || !state.position) return 0;

    const pos = state.position;
    const pnlPct = pos.unrealizedPnlPercent;

    // Must be losing to DCA
    if (pnlPct >= 0) return 0;

    // Check if the recommendation still supports our direction
    const sameDirection =
      (pos.side === 'long' && recommendation.action !== 'SHORT') ||
      (pos.side === 'short' && recommendation.action !== 'LONG');

    if (!sameDirection) return 0;

    // DCA confidence based on drawdown + remaining support
    let dcaConfidence = 30;

    // More drawdown = more confident in DCA (mean reversion)
    if (pnlPct < -3) dcaConfidence += 15;
    if (pnlPct < -5) dcaConfidence += 15;

    // If recommendation still agrees, boost confidence
    if (recommendation.action === (pos.side === 'long' ? 'LONG' : 'SHORT')) {
      dcaConfidence += 20;
    }

    return Math.min(90, dcaConfidence);
  }

  /** Map a decision to an activity state for UI tracking */
  getActivity(decision: AgentDecision): AgentActivity {
    switch (decision.action) {
      case 'open_long':
      case 'open_short':
      case 'close':
      case 'dca':
        return 'trading';
      case 'hold':
        return 'holding';
      case 'wait':
        return 'waiting';
      default:
        return 'idle';
    }
  }

  /** Get remaining budget for this agent */
  getRemainingBudget(): number {
    return this.budgetRemaining;
  }
}
