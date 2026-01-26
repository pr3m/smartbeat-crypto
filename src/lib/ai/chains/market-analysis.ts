/**
 * Market Analysis Chain
 * LangChain-powered market analysis for trade recommendations
 */

import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { getOpenAIClient } from '../client';
import { loadPrompt, interpolatePrompt } from '../prompt-loader';
import { AITradeDataSchema, type AITradeData, type MarketAnalysisResponse } from '../schemas';
import type { MarketSnapshot } from '../types';
import { encodingForModel, type TiktokenModel } from 'js-tiktoken';

interface MarketAnalysisPrompts {
  system_prompt: string;
  user_prompt_template: string;
  response_format: string;
  json_instructions: string;
}

/**
 * Format market data for the AI prompt
 */
function formatMarketData(snapshot: MarketSnapshot): string {
  const formatted: Record<string, unknown> = {
    ts: snapshot.timestamp,
    pair: snapshot.pair,
    price: {
      current: snapshot.currentPrice,
      change: `${snapshot.priceChange24h.toFixed(2)}%`,
      high24h: snapshot.high24h,
      low24h: snapshot.low24h,
      vol24h: snapshot.volume24h,
    },
    btc: {
      trend: snapshot.btc.trend,
      change: `${snapshot.btc.change24h.toFixed(2)}%`,
    },
    tf: {} as Record<string, unknown>,
    systemRec: snapshot.recommendation ? {
      action: snapshot.recommendation.action,
      confidence: `${snapshot.recommendation.confidence}%`,
      reason: snapshot.recommendation.reason,
      scores: `L:${snapshot.recommendation.longScore}/S:${snapshot.recommendation.shortScore} of ${snapshot.recommendation.totalItems}`,
    } : null,
    micro: snapshot.microstructure || null,
    liq: snapshot.liquidation || null,
  };

  // Add timeframe data with complete indicator values
  for (const [tf, data] of Object.entries(snapshot.timeframes)) {
    if (data) {
      const macdHist = data.macdSignal !== undefined ? data.macd - data.macdSignal : null;
      (formatted.tf as Record<string, unknown>)[tf] = {
        bias: data.bias,
        rsi: data.rsi.toFixed(1),
        macd: data.macd.toFixed(6), // Fixed: always use toFixed(6), no special "+" formatting
        macdSignal: data.macdSignal?.toFixed(6) || null,
        macdHist: macdHist?.toFixed(6) || null,
        bb: {
          position: `${(data.bbPosition * 100).toFixed(0)}%`,
          upper: data.bbUpper?.toFixed(4) || null,
          lower: data.bbLower?.toFixed(4) || null,
          bandwidth: data.bbUpper && data.bbLower && snapshot.currentPrice > 0
            ? `${(((data.bbUpper - data.bbLower) / snapshot.currentPrice) * 100).toFixed(2)}%`
            : null,
        },
        atr: `${data.atrPercent.toFixed(2)}%`,
        vol: `${data.volumeRatio.toFixed(2)}x`,
        score: data.score,
      };
    }
  }

  // Add Fear & Greed index if available
  if (snapshot.fearGreed) {
    formatted.fearGreed = {
      value: snapshot.fearGreed.value,
      classification: snapshot.fearGreed.classification,
    };
  }

  // Add open position data if available
  if (snapshot.openPosition?.isOpen) {
    formatted.position = {
      side: snapshot.openPosition.side,
      entry: snapshot.openPosition.entryPrice?.toFixed(4),
      volume: snapshot.openPosition.volume,
      pnl: snapshot.openPosition.unrealizedPnl?.toFixed(2),
      pnlPct: snapshot.openPosition.unrealizedPnlPercent !== undefined
        ? `${snapshot.openPosition.unrealizedPnlPercent.toFixed(2)}%`
        : null,
      leverage: snapshot.openPosition.leverage
        ? `${snapshot.openPosition.leverage}x`
        : null,
      liqPrice: snapshot.openPosition.liquidationPrice?.toFixed(4) || null,
    };
  }

  // Add trading session context if available
  if (snapshot.tradingSession) {
    formatted.session = {
      phase: snapshot.tradingSession.phase,
      hours: snapshot.tradingSession.marketHours,
      note: snapshot.tradingSession.description,
      weekend: snapshot.tradingSession.isWeekend,
    };
  }

  // Build complete output with chart context if available
  let output = JSON.stringify(formatted, null, 2);

  if (snapshot.chartContext) {
    output += '\n\n' + snapshot.chartContext;
  }

  return output;
}

/**
 * Parse JSON trade data from the AI response
 */
function parseTradeData(analysis: string): AITradeData | null {
  try {
    // Look for JSON code block in the response
    const jsonMatch = analysis.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      console.warn('No JSON code block found in AI response');
      return null;
    }

    const jsonStr = jsonMatch[1].trim();
    const parsed = JSON.parse(jsonStr);

    // Validate with Zod schema
    const result = AITradeDataSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('AI trade data validation failed:', result.error.errors);
      // Return parsed data anyway (backward compatibility)
      return parsed as AITradeData;
    }

    return result.data;
  } catch (error) {
    console.error('Failed to parse AI trade data:', error);
    return null;
  }
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
 * Run market analysis chain
 */
export async function analyzeMarket(
  snapshot: MarketSnapshot,
  config?: { apiKey?: string; model?: string }
): Promise<MarketAnalysisResponse> {
  // Load prompts
  const prompts = loadPrompt<MarketAnalysisPrompts>('market-analysis');

  // Get client
  const client = getOpenAIClient({
    apiKey: config?.apiKey,
    model: config?.model,
  });

  // Format market data
  const marketDataJson = formatMarketData(snapshot);

  // Build the user prompt with market data
  const userPrompt = interpolatePrompt(prompts.user_prompt_template, {
    market_data: marketDataJson,
  });

  // Add JSON instructions to system prompt
  const fullSystemPrompt = `${prompts.system_prompt}\n\n${prompts.json_instructions}`;

  // Create prompt template
  const prompt = ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate('{system_prompt}'),
    HumanMessagePromptTemplate.fromTemplate('{user_prompt}'),
  ]);

  // Create chain - get raw AIMessage first to handle GPT-5.2 response format
  const rawChain = prompt.pipe(client);

  // Calculate input tokens
  const inputText = fullSystemPrompt + userPrompt;
  const model = config?.model || process.env.OPENAI_MODEL || 'gpt-5.2';
  const inputTokens = countTokens(inputText, model);

  // Run chain and get raw response
  const rawResponse = await rawChain.invoke({
    system_prompt: fullSystemPrompt,
    user_prompt: userPrompt,
  });

  // Debug: log the raw response structure
  console.log('AI raw response:', {
    type: typeof rawResponse,
    constructor: rawResponse?.constructor?.name,
    keys: rawResponse ? Object.keys(rawResponse) : [],
    content: rawResponse?.content,
    contentType: typeof rawResponse?.content,
    contentIsArray: Array.isArray(rawResponse?.content),
    contentLength: Array.isArray(rawResponse?.content) ? rawResponse.content.length : 'N/A',
    contentBlocks: Array.isArray(rawResponse?.content)
      ? rawResponse.content.map((b: { type?: string }) => b?.type || typeof b).join(', ')
      : 'N/A',
    text: rawResponse?.text,
    reasoning: rawResponse?.additional_kwargs?.reasoning ? 'present' : 'absent',
  });

  // Extract content from AIMessage - handle different response formats
  // Supports: plain string, standard AIMessage, Responses API format (with reasoning blocks)
  let analysis: string;
  if (typeof rawResponse === 'string') {
    analysis = rawResponse;
  } else if (rawResponse && 'content' in rawResponse && rawResponse.content !== undefined) {
    // Standard AIMessage format - check for property existence, not truthiness (empty string is valid)
    if (typeof rawResponse.content === 'string') {
      analysis = rawResponse.content;
    } else if (Array.isArray(rawResponse.content)) {
      // Content blocks format - Responses API returns array with reasoning and text blocks
      // Format: [{ type: 'reasoning', summary: '...' }, { type: 'text', text: '...' }]
      const textParts: string[] = [];
      const reasoningParts: string[] = [];

      for (const block of rawResponse.content) {
        if (typeof block === 'string') {
          textParts.push(block);
        } else if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'reasoning' && block.summary) {
          // Reasoning summary from GPT-5.2 / o1 / o3 models
          reasoningParts.push(block.summary);
        } else if (block.type === 'output_text' && block.text) {
          // Alternative format for output text
          textParts.push(block.text);
        }
      }

      // Prefer text content, but use reasoning summary if no text available
      if (textParts.length > 0) {
        analysis = textParts.join('\n');
      } else if (reasoningParts.length > 0) {
        analysis = '## AI Reasoning Summary\n\n' + reasoningParts.join('\n\n');
      } else {
        analysis = '';
      }
    } else {
      analysis = String(rawResponse.content);
    }
  } else if (rawResponse?.text) {
    // Alternative text property
    analysis = rawResponse.text;
  } else {
    // Fallback: try StringOutputParser
    const parser = new StringOutputParser();
    try {
      analysis = await parser.parse(rawResponse);
    } catch {
      // If StringOutputParser fails, stringify the response
      analysis = typeof rawResponse === 'object'
        ? JSON.stringify(rawResponse, null, 2)
        : String(rawResponse);
    }
  }

  // If analysis is empty (e.g., reasoning model used all tokens for thinking), provide a fallback message
  if (!analysis || analysis.trim() === '') {
    // Check if there's reasoning in additional_kwargs (older format)
    const reasoning = rawResponse?.additional_kwargs?.reasoning;
    if (reasoning && typeof reasoning === 'string') {
      analysis = '## AI Reasoning\n\n' + reasoning;
    } else {
      analysis = 'The AI model did not return a visible response. This may occur when the model uses extended reasoning. Please try again or use a different model.';
    }
  }

  // Debug: log what we extracted
  console.log('AI chain response:', {
    type: typeof analysis,
    length: typeof analysis === 'string' ? analysis.length : 'N/A',
    preview: typeof analysis === 'string' ? analysis.substring(0, 200) : JSON.stringify(analysis).substring(0, 200),
  });

  // Parse the structured trade data
  const tradeData = parseTradeData(analysis);

  // Calculate output tokens
  const outputTokens = countTokens(analysis, model);

  return {
    analysis,
    tradeData: tradeData as AITradeData,
    model,
    timestamp: new Date().toISOString(),
    inputData: marketDataJson,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    },
  };
}

// Re-export for backward compatibility
export { formatMarketData };
