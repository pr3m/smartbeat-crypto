/**
 * Trade Review Chain
 * LangChain-powered trade analysis for backtesting insights
 */

import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';
import { getOpenAIClient } from '../client';
import { loadPrompt, interpolatePrompt } from '../prompt-loader';
import {
  TradeAnalysisResultSchema,
  BatchAnalysisResultSchema,
  type TradeAnalysisResult,
  type BatchAnalysisResult,
  type TradeForAnalysis,
  type TradeReviewResponse,
} from '../schemas';
import { encodingForModel, type TiktokenModel } from 'js-tiktoken';

interface TradeReviewPrompts {
  single_trade_system_prompt: string;
  single_trade_user_prompt: string;
  batch_analysis_system_prompt: string;
  batch_analysis_user_prompt: string;
}

/**
 * Count tokens using tiktoken
 */
function countTokens(text: string, model: string): number {
  try {
    const modelMapping: Record<string, TiktokenModel> = {
      'gpt-4': 'gpt-4',
      'gpt-4-turbo': 'gpt-4-turbo',
      'gpt-4o': 'gpt-4o',
      'gpt-4o-mini': 'gpt-4o-mini',
      'gpt-3.5-turbo': 'gpt-3.5-turbo',
    };

    const tiktokenModel = modelMapping[model] || 'gpt-4o';
    const enc = encodingForModel(tiktokenModel);
    const tokens = enc.encode(text);
    return tokens.length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Parse single trade analysis from AI response
 */
function parseSingleTradeAnalysis(response: string): TradeAnalysisResult | null {
  try {
    let jsonStr = response;

    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      const jsonStart = response.indexOf('{');
      const jsonEnd = response.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = response.slice(jsonStart, jsonEnd + 1);
      }
    }

    const parsed = JSON.parse(jsonStr);
    const result = TradeAnalysisResultSchema.safeParse(parsed);

    if (!result.success) {
      console.warn('Trade analysis validation failed:', result.error.errors);
      return parsed as TradeAnalysisResult;
    }

    return result.data;
  } catch (error) {
    console.error('Failed to parse trade analysis:', error);
    return null;
  }
}

/**
 * Extract string content from AI response (handles reasoning models)
 */
function extractResponseContent(rawResponse: unknown): string {
  if (typeof rawResponse === 'string') {
    return rawResponse;
  }

  const resp = rawResponse as { content?: unknown; text?: string };

  if (resp && 'content' in resp && resp.content !== undefined) {
    if (typeof resp.content === 'string') {
      return resp.content;
    }
    if (Array.isArray(resp.content)) {
      const textParts: string[] = [];
      for (const block of resp.content) {
        if (typeof block === 'string') {
          textParts.push(block);
        } else if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'output_text' && block.text) {
          textParts.push(block.text);
        }
      }
      return textParts.join('\n');
    }
    return String(resp.content);
  }

  if (resp?.text) {
    return resp.text;
  }

  return typeof rawResponse === 'object'
    ? JSON.stringify(rawResponse, null, 2)
    : String(rawResponse);
}

/**
 * Parse batch analysis from AI response
 */
function parseBatchAnalysis(response: string): BatchAnalysisResult | null {
  try {
    let jsonStr = response;

    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      const jsonStart = response.indexOf('{');
      const jsonEnd = response.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = response.slice(jsonStart, jsonEnd + 1);
      }
    }

    const parsed = JSON.parse(jsonStr);
    const result = BatchAnalysisResultSchema.safeParse(parsed);

    if (!result.success) {
      console.warn('Batch analysis validation failed:', result.error.errors);
      return parsed as BatchAnalysisResult;
    }

    return result.data;
  } catch (error) {
    console.error('Failed to parse batch analysis:', error);
    return null;
  }
}

/**
 * Analyze a single trade
 */
export async function analyzeSingleTrade(
  trade: TradeForAnalysis,
  config?: { apiKey?: string; model?: string }
): Promise<TradeReviewResponse> {
  const prompts = loadPrompt<TradeReviewPrompts>('trade-review');

  const client = getOpenAIClient({
    apiKey: config?.apiKey,
    model: config?.model,
    maxTokens: 1000,
  });

  let entryConditions = {};
  try {
    entryConditions = JSON.parse(trade.entrySnapshot || '{}');
  } catch {
    entryConditions = {};
  }

  const holdingPeriod = trade.exitPrice ? 'Position closed' : 'Position still open';

  const userPrompt = interpolatePrompt(prompts.single_trade_user_prompt, {
    trade_type: trade.tradeType.toUpperCase(),
    entry_price: trade.entryPrice.toFixed(4),
    exit_price: trade.exitPrice ? `€${trade.exitPrice.toFixed(4)}` : 'N/A',
    pnl: trade.realizedPnl !== null ? `€${trade.realizedPnl.toFixed(2)}` : 'N/A',
    pnl_percent: trade.pnlPercent !== null ? `${trade.pnlPercent.toFixed(2)}%` : 'N/A',
    outcome: trade.outcome || 'Unknown',
    duration: holdingPeriod,
    entry_conditions: JSON.stringify(entryConditions, null, 2),
  });

  const prompt = ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate('{system_prompt}'),
    HumanMessagePromptTemplate.fromTemplate('{user_prompt}'),
  ]);

  const rawChain = prompt.pipe(client);

  const model = config?.model || process.env.OPENAI_MODEL || 'gpt-4.1';
  const inputText = prompts.single_trade_system_prompt + userPrompt;
  const inputTokens = countTokens(inputText, model);

  const rawResponse = await rawChain.invoke({
    system_prompt: prompts.single_trade_system_prompt,
    user_prompt: userPrompt,
  });

  const response = extractResponseContent(rawResponse);
  const parsed = parseSingleTradeAnalysis(response);
  const outputTokens = countTokens(response, model);

  return {
    success: true,
    analysis: response,
    parsed,
    model,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    },
    tradesAnalyzed: 1,
  };
}

/**
 * Analyze multiple trades in batch
 */
export async function analyzeTrades(
  trades: TradeForAnalysis[],
  config?: { apiKey?: string; model?: string }
): Promise<TradeReviewResponse> {
  const prompts = loadPrompt<TradeReviewPrompts>('trade-review');

  const client = getOpenAIClient({
    apiKey: config?.apiKey,
    model: config?.model,
    maxTokens: 1200,
  });

  const wins = trades.filter(t => t.outcome === 'win');
  const losses = trades.filter(t => t.outcome === 'loss');
  const totalPnl = trades.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);

  const tradeSummaries = trades.slice(0, 20).map(t => ({
    type: t.tradeType,
    entry: t.entryPrice,
    exit: t.exitPrice,
    pnl: t.realizedPnl,
    pnlPct: t.pnlPercent,
    outcome: t.outcome,
    date: t.createdAt,
  }));

  const userPrompt = interpolatePrompt(prompts.batch_analysis_user_prompt, {
    total_trades: trades.length.toString(),
    wins: wins.length.toString(),
    win_rate: ((wins.length / trades.length) * 100).toFixed(1),
    losses: losses.length.toString(),
    loss_rate: ((losses.length / trades.length) * 100).toFixed(1),
    total_pnl: totalPnl.toFixed(2),
    avg_win: wins.length > 0
      ? (wins.reduce((sum, t) => sum + (t.realizedPnl || 0), 0) / wins.length).toFixed(2)
      : '0',
    avg_loss: losses.length > 0
      ? (losses.reduce((sum, t) => sum + (t.realizedPnl || 0), 0) / losses.length).toFixed(2)
      : '0',
    trade_summaries: JSON.stringify(tradeSummaries, null, 2),
  });

  const prompt = ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate('{system_prompt}'),
    HumanMessagePromptTemplate.fromTemplate('{user_prompt}'),
  ]);

  const rawChain = prompt.pipe(client);

  const model = config?.model || process.env.OPENAI_MODEL || 'gpt-4.1';
  const inputText = prompts.batch_analysis_system_prompt + userPrompt;
  const inputTokens = countTokens(inputText, model);

  const rawResponse = await rawChain.invoke({
    system_prompt: prompts.batch_analysis_system_prompt,
    user_prompt: userPrompt,
  });

  const response = extractResponseContent(rawResponse);
  const parsed = parseBatchAnalysis(response);
  const outputTokens = countTokens(response, model);

  return {
    success: true,
    analysis: response,
    parsed,
    model,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    },
    tradesAnalyzed: trades.length,
  };
}
