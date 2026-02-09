/**
 * AI Usage Tracker
 * Centralized tracking of all AI API usage for monitoring and cost estimation
 */

import { prisma } from '@/lib/db';

// Model pricing per 1M tokens (as of 2024)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o1-preview': { input: 15.00, output: 60.00 },
};

export type AIFeature = 'chat' | 'market_analysis' | 'position_evaluation' | 'trade_review' | 'arena_agent';

export interface TrackUsageParams {
  feature: AIFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  conversationId?: string;
  success?: boolean;
  errorMessage?: string;
  durationMs?: number;
  endpoint?: string;
  userContext?: string;
}

/**
 * Calculate estimated cost based on model and token usage
 */
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4o'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Track AI usage to database
 */
export async function trackAIUsage(params: TrackUsageParams): Promise<void> {
  const {
    feature,
    model,
    inputTokens,
    outputTokens,
    conversationId,
    success = true,
    errorMessage,
    durationMs,
    endpoint,
    userContext,
  } = params;

  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = calculateCost(model, inputTokens, outputTokens);

  try {
    await prisma.aIUsage.create({
      data: {
        feature,
        model,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost,
        conversationId,
        success,
        errorMessage,
        durationMs,
        endpoint,
        userContext,
      },
    });
  } catch (error) {
    // Don't throw - usage tracking should not break the main flow
    console.error('[AIUsage] Failed to track usage:', error);
  }
}

/**
 * Get usage summary for a time period
 */
export async function getUsageSummary(
  startDate?: Date,
  endDate?: Date
): Promise<{
  byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>;
  byFeature: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>;
  totals: { requests: number; inputTokens: number; outputTokens: number; cost: number };
}> {
  const where: Record<string, unknown> = {};
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) (where.createdAt as Record<string, Date>).gte = startDate;
    if (endDate) (where.createdAt as Record<string, Date>).lte = endDate;
  }

  const usages = await prisma.aIUsage.findMany({
    where,
    select: {
      model: true,
      feature: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCost: true,
    },
  });

  const byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }> = {};
  const byFeature: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }> = {};
  const totals = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };

  for (const usage of usages) {
    // By model
    if (!byModel[usage.model]) {
      byModel[usage.model] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    }
    byModel[usage.model].requests++;
    byModel[usage.model].inputTokens += usage.inputTokens;
    byModel[usage.model].outputTokens += usage.outputTokens;
    byModel[usage.model].cost += usage.estimatedCost || 0;

    // By feature
    if (!byFeature[usage.feature]) {
      byFeature[usage.feature] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    }
    byFeature[usage.feature].requests++;
    byFeature[usage.feature].inputTokens += usage.inputTokens;
    byFeature[usage.feature].outputTokens += usage.outputTokens;
    byFeature[usage.feature].cost += usage.estimatedCost || 0;

    // Totals
    totals.requests++;
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cost += usage.estimatedCost || 0;
  }

  return { byModel, byFeature, totals };
}

/**
 * Get recent usage records
 */
export async function getRecentUsage(limit = 50): Promise<Array<{
  id: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number | null;
  success: boolean;
  durationMs: number | null;
  createdAt: Date;
}>> {
  return prisma.aIUsage.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      feature: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      estimatedCost: true,
      success: true,
      durationMs: true,
      createdAt: true,
    },
  });
}

/**
 * Get daily usage statistics for charting
 */
export async function getDailyUsage(days = 30): Promise<Array<{
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}>> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const usages = await prisma.aIUsage.findMany({
    where: {
      createdAt: { gte: startDate },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by date
  const dailyMap = new Map<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>();

  for (const usage of usages) {
    const dateKey = usage.createdAt.toISOString().split('T')[0];
    const existing = dailyMap.get(dateKey) || { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    dailyMap.set(dateKey, {
      requests: existing.requests + 1,
      inputTokens: existing.inputTokens + usage.inputTokens,
      outputTokens: existing.outputTokens + usage.outputTokens,
      cost: existing.cost + (usage.estimatedCost || 0),
    });
  }

  return Array.from(dailyMap.entries()).map(([date, stats]) => ({
    date,
    ...stats,
  }));
}
