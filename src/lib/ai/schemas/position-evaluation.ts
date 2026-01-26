/**
 * Zod Schema for Position Evaluation
 * Defines the structured output for per-position AI analysis
 */

import { z } from 'zod';

/**
 * Risk Assessment Schema
 */
export const RiskAssessmentSchema = z.object({
  level: z.enum(['extreme', 'high', 'medium', 'low']),
  factors: z.array(z.string()).max(5),
});

/**
 * Position Evaluation Response Schema
 * Concise, actionable output for evaluating open positions
 */
export const PositionEvaluationSchema = z.object({
  recommendation: z.enum(['HOLD', 'ADD', 'REDUCE', 'CLOSE']),
  conviction: z.enum(['high', 'medium', 'low']),
  suggestedStopLoss: z.number().positive().nullable(),
  suggestedTakeProfit: z.number().positive().nullable(),
  riskAssessment: RiskAssessmentSchema,
  marketAlignment: z.enum(['aligned', 'neutral', 'opposing']),
  rationale: z.string().max(300), // Keep concise
  actionItems: z.array(z.string()).max(3), // Max 3 actions
  confidence: z.number().min(0).max(100),
});

/**
 * Position Health Metrics Schema (calculated locally, not AI)
 */
export const PositionHealthMetricsSchema = z.object({
  liquidationDistance: z.number(), // % from current to liq price
  liquidationStatus: z.enum(['danger', 'warning', 'safe']),
  marginLevel: z.number(), // (equity/margin) * 100
  marginStatus: z.enum(['critical', 'low', 'healthy']),
  hoursOpen: z.number(),
  timeStatus: z.enum(['overdue', 'approaching']).nullable(),
  estimatedRolloverFee: z.number(),
  riskLevel: z.enum(['extreme', 'high', 'medium', 'low']),
  riskFactors: z.array(z.string()),
});

/**
 * Full Position Evaluation API Response
 */
export const PositionEvaluationResponseSchema = z.object({
  success: z.boolean(),
  evaluation: PositionEvaluationSchema,
  health: PositionHealthMetricsSchema,
  model: z.string(),
  timestamp: z.string(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    total: z.number(),
  }),
});

// Type exports
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type PositionEvaluation = z.infer<typeof PositionEvaluationSchema>;
export type PositionHealthMetrics = z.infer<typeof PositionHealthMetricsSchema>;
export type PositionEvaluationResponse = z.infer<typeof PositionEvaluationResponseSchema>;
