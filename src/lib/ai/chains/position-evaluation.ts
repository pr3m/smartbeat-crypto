/**
 * Position Evaluation Chain
 * LangChain-powered per-position AI analysis
 */

import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';
import { getOpenAIClient } from '../client';
import { loadPrompt, interpolatePrompt } from '../prompt-loader';
import { buildStrategySystemPrompt } from '../strategy-prompt-builder';
import {
  PositionEvaluationSchema,
  type PositionEvaluation,
  type PositionHealthMetrics,
  type PositionEvaluationResponse,
} from '../schemas';
import type { MarketSnapshot } from '../types';
import { encodingForModel, type TiktokenModel } from 'js-tiktoken';

interface PositionEvaluationPrompts {
  system_prompt: string;
  user_prompt_template: string;
  json_format: string;
}

export interface PositionData {
  pair: string;
  side: 'long' | 'short';
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  liquidationPrice: number;
  volume: number;
  unrealizedPnl: number;
  pnlPercent: number;
  marginUsed: number;
  hoursOpen: number;
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
 * Parse position evaluation from AI response
 */
function parseEvaluation(response: string): PositionEvaluation | null {
  try {
    // Try to extract JSON from the response
    let jsonStr = response;

    // Check for JSON code block
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      // Try to find raw JSON object
      const jsonStart = response.indexOf('{');
      const jsonEnd = response.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = response.slice(jsonStart, jsonEnd + 1);
      }
    }

    const parsed = JSON.parse(jsonStr);

    // Validate with Zod schema
    const result = PositionEvaluationSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('Position evaluation validation failed:', result.error.errors);
      // Return parsed data anyway with defaults
      return {
        recommendation: parsed.recommendation || 'HOLD',
        conviction: parsed.conviction || 'medium',
        suggestedStopLoss: parsed.suggestedStopLoss ?? null,
        suggestedTakeProfit: parsed.suggestedTakeProfit ?? null,
        riskAssessment: parsed.riskAssessment || { level: 'medium', factors: [] },
        marketAlignment: parsed.marketAlignment || 'neutral',
        rationale: parsed.rationale || 'Unable to parse full rationale',
        actionItems: parsed.actionItems || [],
        confidence: parsed.confidence ?? 50,
      };
    }

    return result.data;
  } catch (error) {
    console.error('Failed to parse position evaluation:', error);
    return null;
  }
}

/**
 * Format market context for the prompt
 * Provides comprehensive market data for AI analysis
 */
function formatMarketContext(snapshot: MarketSnapshot | null): string {
  if (!snapshot) {
    return '{ "available": false }';
  }

  // Build comprehensive context
  const context: Record<string, unknown> = {
    available: true,
    currentPrice: snapshot.currentPrice,
    priceChange24h: snapshot.priceChange24h?.toFixed(2) + '%',
    range24h: snapshot.high24h && snapshot.low24h ? {
      high: snapshot.high24h,
      low: snapshot.low24h,
      rangePercent: (((snapshot.high24h - snapshot.low24h) / snapshot.low24h) * 100).toFixed(2) + '%',
    } : null,
    volume24h: snapshot.volume24h,
    btc: snapshot.btc ? {
      trend: snapshot.btc.trend,
      change24h: snapshot.btc.change24h?.toFixed(2) + '%',
    } : null,
    timeframes: Object.fromEntries(
      Object.entries(snapshot.timeframes)
        .filter(([, data]) => data !== null)
        .map(([tf, data]) => [tf, {
          bias: data!.bias,
          rsi: data!.rsi.toFixed(1),
          macd: data!.macd?.toFixed(5),
          macdSignal: data!.macdSignal?.toFixed(5),
          bbPosition: data!.bbPosition?.toFixed(0) + '%',
          atrPercent: data!.atrPercent?.toFixed(2) + '%',
          volumeRatio: data!.volumeRatio?.toFixed(2) + 'x',
          score: data!.score,
        }])
    ),
  };

  // Add Fear & Greed if available
  if (snapshot.fearGreed) {
    context.fearGreed = {
      value: snapshot.fearGreed.value,
      classification: snapshot.fearGreed.classification,
    };
  }

  // Add microstructure if available
  if (snapshot.microstructure) {
    context.microstructure = {
      imbalance: snapshot.microstructure.imbalance?.toFixed(2) + '%',
      cvdTrend: snapshot.microstructure.cvdTrend,
      spreadPercent: snapshot.microstructure.spreadPercent?.toFixed(3) + '%',
      whaleActivity: snapshot.microstructure.whaleActivity,
    };
  }

  // Add liquidation data if available
  if (snapshot.liquidation) {
    context.liquidation = {
      bias: snapshot.liquidation.bias,
      biasStrength: snapshot.liquidation.biasStrength,
      fundingRate: snapshot.liquidation.fundingRate,
    };
  }

  // Add reversal status if detected (critical for hold/exit decisions)
  if (snapshot.reversalStatus?.detected) {
    context.reversalStatus = {
      phase: snapshot.reversalStatus.phase,
      direction: snapshot.reversalStatus.direction,
      confidence: snapshot.reversalStatus.confidence + '%',
      exhaustionScore: snapshot.reversalStatus.exhaustionScore,
      urgency: snapshot.reversalStatus.urgency,
      description: snapshot.reversalStatus.description,
      patterns: snapshot.reversalStatus.patterns,
    };
  }

  // Add candlestick patterns per timeframe
  if (snapshot.candlestickPatterns) {
    context.candlestickPatterns = snapshot.candlestickPatterns;
  }

  return JSON.stringify(context, null, 2);
}

/**
 * Evaluate an open position with AI
 */
export async function evaluatePosition(
  position: PositionData,
  health: PositionHealthMetrics,
  marketSnapshot: MarketSnapshot | null,
  config?: { apiKey?: string; model?: string }
): Promise<PositionEvaluationResponse> {
  // Load prompts
  const prompts = loadPrompt<PositionEvaluationPrompts>('position-evaluation');

  // Get client with faster response (lower max tokens)
  const client = getOpenAIClient({
    apiKey: config?.apiKey,
    model: config?.model,
    maxTokens: 800, // Keep responses concise
  });

  // Calculate position value
  const positionValue = position.volume * position.currentPrice;

  // Build user prompt
  const userPrompt = interpolatePrompt(prompts.user_prompt_template, {
    pair: position.pair,
    side: position.side.toUpperCase(),
    leverage: position.leverage.toString(),
    entry_price: position.entryPrice.toFixed(4),
    current_price: position.currentPrice.toFixed(4),
    liquidation_price: position.liquidationPrice.toFixed(4),
    volume: position.volume.toFixed(2),
    position_value: positionValue.toFixed(2),
    unrealized_pnl: position.unrealizedPnl.toFixed(2),
    pnl_percent: position.pnlPercent.toFixed(2),
    hours_open: position.hoursOpen.toFixed(1),
    margin_used: position.marginUsed.toFixed(2),
    market_context: formatMarketContext(marketSnapshot),
    liquidation_distance: health.liquidationDistance.toFixed(2),
    margin_level: health.marginLevel.toFixed(0),
  });

  // Inject strategy context into system prompt
  const strategySection = buildStrategySystemPrompt();
  const systemPromptWithStrategy = prompts.system_prompt.replace('{strategy_section}', strategySection);

  // Add JSON format to system prompt
  const fullSystemPrompt = `${systemPromptWithStrategy}\n\n${prompts.json_format}`;

  // Create prompt template
  const prompt = ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate('{system_prompt}'),
    HumanMessagePromptTemplate.fromTemplate('{user_prompt}'),
  ]);

  // Create chain - get raw AIMessage first to handle reasoning model response format
  const rawChain = prompt.pipe(client);

  // Calculate tokens
  const model = config?.model || process.env.OPENAI_MODEL || 'gpt-4.1';
  const inputText = fullSystemPrompt + userPrompt;
  const inputTokens = countTokens(inputText, model);

  // Run chain and get raw response
  const rawResponse = await rawChain.invoke({
    system_prompt: fullSystemPrompt,
    user_prompt: userPrompt,
  });

  // Extract content from AIMessage - handle different response formats
  // Supports: plain string, standard AIMessage, Responses API format (with reasoning blocks)
  let response: string;
  if (typeof rawResponse === 'string') {
    response = rawResponse;
  } else if (rawResponse && 'content' in rawResponse && rawResponse.content !== undefined) {
    if (typeof rawResponse.content === 'string') {
      response = rawResponse.content;
    } else if (Array.isArray(rawResponse.content)) {
      // Content blocks format - Responses API returns array with reasoning and text blocks
      // Format: [{ type: 'reasoning', summary: '...' }, { type: 'text', text: '...' }]
      const textParts: string[] = [];

      for (const block of rawResponse.content) {
        if (typeof block === 'string') {
          textParts.push(block);
        } else if (typeof block === 'object' && block !== null) {
          const b = block as { type?: string; text?: string };
          if (b.type === 'text' && b.text) {
            textParts.push(b.text);
          } else if (b.type === 'output_text' && b.text) {
            textParts.push(b.text);
          }
        }
        // Skip reasoning blocks - we only want the actual output
      }

      response = textParts.join('\n');
    } else {
      response = String(rawResponse.content);
    }
  } else if (rawResponse?.text) {
    response = rawResponse.text;
  } else {
    // Fallback: stringify the response
    response = typeof rawResponse === 'object'
      ? JSON.stringify(rawResponse, null, 2)
      : String(rawResponse);
  }

  // If response is empty, throw error
  if (!response || response.trim() === '') {
    throw new Error('AI model returned empty response. Try using a non-reasoning model like gpt-4o.');
  }

  // Parse evaluation
  const evaluation = parseEvaluation(response);

  if (!evaluation) {
    throw new Error('Failed to parse AI evaluation response');
  }

  // Calculate output tokens
  const outputTokens = countTokens(response, model);

  return {
    success: true,
    evaluation,
    health,
    model,
    timestamp: new Date().toISOString(),
    tokens: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    },
  };
}
