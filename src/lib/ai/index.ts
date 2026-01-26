/**
 * AI Trading Analysis Module
 * Main entry point - exports all AI functionality
 *
 * This module uses LangChain for structured AI interactions
 * with organized prompts and Zod schema validation.
 */

// Re-export types
export type {
  AIPrompts,
  MarketSnapshot,
  TimeframeSnapshot,
  AIAnalysisRequest,
  AIAnalysisResponse,
  AITradeData,
  AITradeTarget,
  AIIndicators,
  // New types from schemas
  RiskAssessment,
  PositionEvaluation,
  PositionHealthMetrics,
  PositionEvaluationResponse,
  TradeAnalysisResult,
  BatchAnalysisResult,
  TradeForAnalysis,
  TradeReviewResponse,
} from './types';

// Re-export chains
export {
  analyzeMarket,
  formatMarketData,
  evaluatePosition,
  type PositionData,
  analyzeSingleTrade,
  analyzeTrades,
} from './chains';

// Re-export schemas (for validation in API routes)
export {
  AITradeDataSchema,
  PositionEvaluationSchema,
  PositionHealthMetricsSchema,
  TradeAnalysisResultSchema,
  BatchAnalysisResultSchema,
} from './schemas';

// Re-export utilities
export { getOpenAIClient, createOpenAIClient, isOpenAIConfigured } from './client';
export { loadPrompt, clearPromptCache, interpolatePrompt } from './prompt-loader';

import type { MarketSnapshot, AIAnalysisResponse } from './types';
import { analyzeMarket } from './chains';

/**
 * Analyze market data with AI (backward-compatible wrapper)
 *
 * @deprecated Use `analyzeMarket` from './chains' directly for better typing
 */
export async function analyzeWithAI(
  snapshot: MarketSnapshot,
  apiKey: string,
  model: string
): Promise<AIAnalysisResponse> {
  const result = await analyzeMarket(snapshot, { apiKey, model });

  // Convert to legacy response format
  return {
    analysis: result.analysis,
    tradeData: result.tradeData,
    model: result.model,
    timestamp: result.timestamp,
    inputData: result.inputData,
    tokens: result.tokens,
  };
}

/**
 * Legacy function to load prompts from YAML
 *
 * @deprecated Use `loadPrompt` from './prompt-loader' directly
 */
export function loadPrompts() {
  const { loadPrompt } = require('./prompt-loader');
  return loadPrompt('market-analysis');
}

/**
 * Legacy function to build user prompt
 *
 * @deprecated Use the chains directly which handle prompt building
 */
export function buildUserPrompt(
  prompts: { user_prompt_template: string },
  snapshot: MarketSnapshot
): string {
  const { formatMarketData } = require('./chains/market-analysis');
  const { interpolatePrompt } = require('./prompt-loader');
  const marketDataJson = formatMarketData(snapshot);
  return interpolatePrompt(prompts.user_prompt_template, { market_data: marketDataJson });
}
