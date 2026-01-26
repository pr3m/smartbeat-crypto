/**
 * AI Schemas Index
 * Re-exports all Zod schemas for AI responses
 */

// Market Analysis
export {
  AITradeTargetSchema,
  AIIndicatorsSchema,
  AITradeDataSchema,
  MarketAnalysisResponseSchema,
  type AITradeTarget,
  type AIIndicators,
  type AITradeData,
  type MarketAnalysisResponse,
} from './market-analysis';

// Position Evaluation
export {
  RiskAssessmentSchema,
  PositionEvaluationSchema,
  PositionHealthMetricsSchema,
  PositionEvaluationResponseSchema,
  type RiskAssessment,
  type PositionEvaluation,
  type PositionHealthMetrics,
  type PositionEvaluationResponse,
} from './position-evaluation';

// Trade Review
export {
  TradeAnalysisResultSchema,
  BatchAnalysisResultSchema,
  TradeForAnalysisSchema,
  TradeReviewResponseSchema,
  type TradeAnalysisResult,
  type BatchAnalysisResult,
  type TradeForAnalysis,
  type TradeReviewResponse,
} from './trade-review';
