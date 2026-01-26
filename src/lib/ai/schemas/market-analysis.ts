/**
 * Zod Schema for Market Analysis
 * Defines the structured output for AI market analysis
 * NOTE: Schemas are lenient to handle various AI output formats
 */

import { z } from 'zod';

// Helper to coerce string to number
const coerceNumber = z.union([z.number(), z.string().transform(s => parseFloat(s))]).pipe(z.number());

/**
 * AI Trade Target Schema
 */
export const AITradeTargetSchema = z.object({
  level: z.number().optional(),
  price: coerceNumber.optional().nullable(),
  probability: coerceNumber.optional().nullable(),
});

/**
 * AI Indicators Schema
 */
export const AIIndicatorsSchema = z.object({
  trendStrength: coerceNumber.optional().default(0),
  momentumScore: coerceNumber.optional().default(0),
  volatilityRisk: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  marketPhase: z.enum(['accumulation', 'markup', 'distribution', 'markdown']).optional().default('accumulation'),
});

/**
 * AI Trade Data Schema - The structured output from market analysis
 * Made flexible to handle AI variations in output format
 */
export const AITradeDataSchema = z.object({
  action: z.enum(['LONG', 'SHORT', 'WAIT']),
  conviction: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  entry: z
    .object({
      low: coerceNumber,
      high: coerceNumber,
    })
    .optional()
    .nullable(),
  stopLoss: coerceNumber.optional().nullable(),
  targets: z.array(AITradeTargetSchema).optional().nullable(),
  riskReward: coerceNumber.optional().nullable(),
  positionSizePct: coerceNumber.optional().nullable().default(1),
  timeHorizon: z.enum(['scalp', 'intraday', 'swing', 'position']).optional().default('intraday'),
  aiIndicators: AIIndicatorsSchema.optional(),
  keyLevels: z.object({
    support: z.array(coerceNumber).optional().default([]),
    resistance: z.array(coerceNumber).optional().default([]),
  }).optional(),
  confidence: coerceNumber.optional().default(50),
});

/**
 * Full Market Analysis Response Schema
 */
export const MarketAnalysisResponseSchema = z.object({
  analysis: z.string(),
  tradeData: AITradeDataSchema,
  model: z.string(),
  timestamp: z.string(),
  inputData: z.string(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    total: z.number(),
  }),
});

// Type exports
export type AITradeTarget = z.infer<typeof AITradeTargetSchema>;
export type AIIndicators = z.infer<typeof AIIndicatorsSchema>;
export type AITradeData = z.infer<typeof AITradeDataSchema>;
export type MarketAnalysisResponse = z.infer<typeof MarketAnalysisResponseSchema>;
