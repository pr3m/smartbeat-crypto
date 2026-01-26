/**
 * Zod Schema for Trade Review
 * Defines the structured output for backtesting trade analysis
 */

import { z } from 'zod';

/**
 * Single Trade Analysis Result Schema
 */
export const TradeAnalysisResultSchema = z.object({
  entryQuality: z.enum(['excellent', 'good', 'fair', 'poor']),
  whatWorked: z.array(z.string()).max(5),
  whatDidntWork: z.array(z.string()).max(5),
  lessonsLearned: z.array(z.string()).max(3),
  suggestedImprovements: z.array(z.string()).max(3),
  narrative: z.string().max(500),
});

/**
 * Batch Trade Analysis Result Schema
 */
export const BatchAnalysisResultSchema = z.object({
  overallGrade: z.enum(['A', 'B', 'C', 'D', 'F']),
  winningPatterns: z.array(z.string()).max(5),
  losingPatterns: z.array(z.string()).max(5),
  riskManagement: z.string().max(200),
  entryTiming: z.string().max(200),
  topRecommendations: z.array(z.string()).max(3),
  narrative: z.string().max(500),
});

/**
 * Trade Data for Analysis Input
 */
export const TradeForAnalysisSchema = z.object({
  id: z.string(),
  positionId: z.string().nullable(),
  tradeType: z.string(),
  entryPrice: z.number(),
  exitPrice: z.number().nullable(),
  realizedPnl: z.number().nullable(),
  pnlPercent: z.number().nullable(),
  outcome: z.string().nullable(),
  entrySnapshot: z.string(),
  createdAt: z.date(),
});

/**
 * Trade Review API Response
 */
export const TradeReviewResponseSchema = z.object({
  success: z.boolean(),
  analysis: z.string(),
  parsed: z.union([TradeAnalysisResultSchema, BatchAnalysisResultSchema]).nullable(),
  model: z.string(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    total: z.number(),
  }),
  tradesAnalyzed: z.number(),
});

// Type exports
export type TradeAnalysisResult = z.infer<typeof TradeAnalysisResultSchema>;
export type BatchAnalysisResult = z.infer<typeof BatchAnalysisResultSchema>;
export type TradeForAnalysis = z.infer<typeof TradeForAnalysisSchema>;
export type TradeReviewResponse = z.infer<typeof TradeReviewResponseSchema>;
