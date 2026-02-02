/**
 * AI Trading Analysis Types
 * Shared between client and server
 */

// Import for local use
import type { AITradeData as AITradeDataType } from './schemas';

// Re-export Zod schema types
export type {
  AITradeTarget,
  AIIndicators,
  AITradeData,
  MarketAnalysisResponse,
  RiskAssessment,
  PositionEvaluation,
  PositionHealthMetrics,
  PositionEvaluationResponse,
  TradeAnalysisResult,
  BatchAnalysisResult,
  TradeForAnalysis,
  TradeReviewResponse,
} from './schemas';

// Legacy prompt interface (for backward compatibility)
export interface AIPrompts {
  system_prompt: string;
  user_prompt_template: string;
  response_format: string;
}

export interface FearGreedData {
  value: number;
  classification: string;
  timestamp: string;
}

export interface OpenPositionData {
  isOpen: boolean;
  side?: 'long' | 'short';
  entryPrice?: number;
  volume?: number;
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
  leverage?: number;
  liquidationPrice?: number;
  openTime?: string;
}

export interface TradingSessionData {
  phase: string;
  marketHours: string;
  description: string;
  isWeekend: boolean;
}

export interface MarketSnapshot {
  timestamp: string;
  pair: string;
  currentPrice: number;
  priceChange24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  btc: {
    trend: 'bull' | 'bear' | 'neut';
    change24h: number;
  };
  timeframes: {
    '5m': TimeframeSnapshot | null;
    '15m': TimeframeSnapshot | null;
    '1h': TimeframeSnapshot | null;
    '4h': TimeframeSnapshot | null;
    '1d': TimeframeSnapshot | null; // Daily timeframe for primary trend (NEW)
  };
  recommendation: {
    action: string;
    confidence: number;
    reason: string;
    longScore: number;
    shortScore: number;
    totalItems: number;
    // NEW: Strength-based recommendations for both directions
    long?: {
      grade: string;
      strength: number;
      reasons: string[];
      warnings: string[];
    };
    short?: {
      grade: string;
      strength: number;
      reasons: string[];
      warnings: string[];
    };
    warnings?: string[];
    momentumAlert?: {
      direction: string;
      strength: string;
      reason: string;
    } | null;
  } | null;
  microstructure?: {
    imbalance: number;
    cvdTrend: string;
    spreadPercent: number;
    whaleActivity: string;
  } | null;
  liquidation?: {
    bias: string;
    biasStrength: number;
    fundingRate: number | null;
  } | null;
  // Chart context with OHLC data for visual analysis
  chartContext?: string;
  // Fear & Greed index data
  fearGreed?: FearGreedData;
  // Open position data (if any)
  openPosition?: OpenPositionData;
  // Trading session context
  tradingSession?: TradingSessionData;
  // Knife detection status (falling/rising knife protection)
  knifeStatus?: {
    isKnife: boolean;
    direction: 'falling' | 'rising' | null;
    phase: 'none' | 'impulse' | 'capitulation' | 'stabilizing' | 'confirming' | 'safe';
    brokenLevel: number | null;
    knifeScore: number;        // 0-100: impulse/capitulation strength
    reversalReadiness: number; // 0-100: stabilization progress
    gateAction: 'block' | 'warn' | 'allow';
    sizeMultiplier: number;
    flipSuggestion: boolean;
    waitFor: string[];
  };
}

export interface TimeframeSnapshot {
  bias: string;
  trendStrength: 'strong' | 'moderate' | 'weak'; // NEW: trend strength indicator
  rsi: number;
  macd: number;
  macdSignal?: number;
  histogram?: number; // NEW: MACD histogram for momentum
  bbPosition: number;
  bbUpper?: number;
  bbLower?: number;
  atr: number;
  atrPercent: number;
  volumeRatio: number;
  score: number;
}

export interface AIAnalysisRequest {
  marketData: MarketSnapshot;
}

// AITradeTarget, AIIndicators, AITradeData are re-exported from schemas above

export interface AIAnalysisResponse {
  analysis: string;
  tradeData: AITradeDataType | null; // Parsed JSON from the response
  model: string;
  timestamp: string;
  inputData: string; // The JSON that was sent to the AI
  tokens: {
    input: number;
    output: number;
    total: number;
  };
}
