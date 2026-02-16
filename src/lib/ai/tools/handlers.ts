/**
 * AI Tool Handlers
 * Implementations for each tool that query the database/APIs
 */

import { prisma } from '@/lib/db';
import { calculateIndicators, calculateBTCTrend } from '@/lib/trading/indicators';
import { generateRecommendation } from '@/lib/trading/recommendation';
import type { ToolName } from './definitions';
import type { OHLCData, TimeframeData } from '@/lib/kraken/types';
import { getDefaultStrategy } from '@/lib/trading/strategies';
import { buildStrategyContextForTools } from '@/lib/ai/strategy-prompt-builder';
import { calculateEntrySize, calculateLiquidationPrice } from '@/lib/trading/position-sizing';
import { analyzeDCAOpportunity } from '@/lib/trading/dca-signals';
import { analyzeExitConditions, getExitStatusSummary, calculateTimeboxPressure, getTimePhase } from '@/lib/trading/exit-signals';
import { detectReversal5m15m } from '@/lib/trading/reversal-detector';
import { buildChartContext } from '@/lib/trading/chart-context';
import { detectMarketRegime } from '@/lib/trading/market-regime';
import type { PositionState, TradeDirection } from '@/lib/trading/v2-types';
import { EMPTY_POSITION_STATE } from '@/lib/trading/v2-types';

// Base URL for internal API calls
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:4000';

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Execute a tool by name with the given arguments
 */
export async function executeTool(name: ToolName, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'query_transactions':
        return await queryTransactions(args);
      case 'get_positions':
        return await getPositions(args);
      case 'get_market_data':
        return await getMarketData(args);
      case 'get_trading_recommendation':
        return await getTradingRecommendation(args);
      case 'get_ohlc_data':
        return await getOhlcData(args);
      case 'kraken_api':
        return await krakenApi(args);
      case 'calculate_tax':
        return await calculateTax(args);
      case 'analyze_trades':
        return await analyzeTrades(args);
      case 'get_ledger':
        return await getLedger(args);
      case 'get_balance':
        return await getBalance(args);
      case 'generate_ai_report':
        return await generateAIReport(args);
      case 'get_reports':
        return await getReports(args);
      case 'get_current_setup':
        return await getCurrentSetup(args);
      case 'analyze_position':
        return await analyzePosition(args);
      case 'get_strategy_config':
        return await getStrategyConfig(args);
      case 'get_chart_analysis':
        return await getChartAnalysis(args);
      case 'get_v2_engine_state':
        return await getV2EngineState(args);
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    console.error(`Tool ${name} error:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tool execution failed',
    };
  }
}

/**
 * Helper: Fetch with timeout
 */
async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper: Fetch OHLC data from internal API
 */
async function fetchOHLC(pair: string, interval: number, since?: number): Promise<OHLCData[]> {
  let url = `${BASE_URL}/api/kraken/public/ohlc?pair=${pair}&interval=${interval}`;
  if (since) url += `&since=${since}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Failed to fetch OHLC for ${pair} ${interval}m`);
  const json = await res.json();
  return json.data || [];
}

/**
 * Helper: Fetch ticker data from internal API
 */
async function fetchTicker(pair: string): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(`${BASE_URL}/api/kraken/public/ticker?pairs=${pair}`);
  if (!res.ok) throw new Error(`Failed to fetch ticker for ${pair}`);
  return res.json();
}

/**
 * Query transactions from the database
 */
async function queryTransactions(args: Record<string, unknown>): Promise<ToolResult> {
  const { year, type, asset, startDate, endDate, limit = 50, aggregation = 'none' } = args;

  const where: Record<string, unknown> = {};

  // Date filters
  if (year) {
    where.timestamp = {
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${Number(year) + 1}-01-01`),
    };
  } else if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) (where.timestamp as Record<string, Date>).gte = new Date(startDate as string);
    if (endDate) (where.timestamp as Record<string, Date>).lte = new Date(endDate as string);
  }

  if (type) where.type = type;
  if (asset) where.asset = asset;

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(Number(limit), 200),
    select: {
      id: true,
      type: true,
      asset: true,
      amount: true,
      pair: true,
      side: true,
      price: true,
      cost: true,
      fee: true,
      netPnl: true,
      timestamp: true,
      posstatus: true,
    },
  });

  // Aggregate if requested
  if (aggregation === 'monthly' && transactions.length > 0) {
    const monthly = new Map<string, { count: number; totalPnl: number; totalFees: number }>();

    for (const tx of transactions) {
      const monthKey = tx.timestamp.toISOString().slice(0, 7);
      const existing = monthly.get(monthKey) || { count: 0, totalPnl: 0, totalFees: 0 };
      monthly.set(monthKey, {
        count: existing.count + 1,
        totalPnl: existing.totalPnl + (tx.netPnl || 0),
        totalFees: existing.totalFees + (tx.fee || 0),
      });
    }

    return {
      success: true,
      data: {
        aggregation: 'monthly',
        summary: Object.fromEntries(monthly),
        totalRecords: transactions.length,
      },
    };
  }

  if (aggregation === 'by_type' && transactions.length > 0) {
    const byType = new Map<string, { count: number; totalPnl: number }>();

    for (const tx of transactions) {
      const existing = byType.get(tx.type) || { count: 0, totalPnl: 0 };
      byType.set(tx.type, {
        count: existing.count + 1,
        totalPnl: existing.totalPnl + (tx.netPnl || 0),
      });
    }

    return {
      success: true,
      data: {
        aggregation: 'by_type',
        summary: Object.fromEntries(byType),
        totalRecords: transactions.length,
      },
    };
  }

  return {
    success: true,
    data: {
      transactions: transactions.map(tx => ({
        ...tx,
        timestamp: tx.timestamp.toISOString(),
      })),
      count: transactions.length,
    },
  };
}

/**
 * Get current positions
 */
async function getPositions(args: Record<string, unknown>): Promise<ToolResult> {
  const { type = 'all', includeHistory = false } = args;

  const results: Record<string, unknown> = {};

  // Simulated positions
  if (type === 'all' || type === 'simulated') {
    const simPositions = await prisma.simulatedPosition.findMany({
      where: includeHistory ? {} : { isOpen: true },
      orderBy: { openedAt: 'desc' },
      take: 20,
    });

    results.simulatedPositions = simPositions.map(p => ({
      id: p.id,
      pair: p.pair,
      side: p.side,
      volume: p.volume,
      avgEntryPrice: p.avgEntryPrice,
      leverage: p.leverage,
      totalCost: p.totalCost,
      totalFees: p.totalFees,
      isOpen: p.isOpen,
      realizedPnl: p.realizedPnl,
      openedAt: p.openedAt.toISOString(),
      closedAt: p.closedAt?.toISOString(),
    }));
  }

  // Kraken positions - fetch LIVE from Kraken API (not from stale database)
  if (type === 'all' || type === 'kraken') {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/api/kraken/private/positions`);
      if (res.ok) {
        const data = await res.json();
        // Kraken returns an object keyed by position ID
        if (data && typeof data === 'object' && !data.error) {
          const positions = Object.entries(data).map(([id, pos]: [string, unknown]) => {
            const p = pos as Record<string, unknown>;
            const cost = parseFloat(String(p.cost ?? 0));
            const margin = parseFloat(String(p.margin ?? 0));
            const rawLeverage = p.leverage ? parseFloat(String(p.leverage)) : NaN;
            const leverage = Number.isFinite(rawLeverage)
              ? rawLeverage
              : margin > 0
                ? Math.round(cost / margin)
                : 1;
            const rawTime = p.time ? parseFloat(String(p.time)) : NaN;
            const openTime = Number.isFinite(rawTime) ? rawTime * 1000 : Date.now();

            return {
              id,
              pair: String(p.pair ?? ''),
              type: (p.type as 'buy' | 'sell') ?? 'buy',
              cost,
              fee: parseFloat(String(p.fee ?? 0)),
              volume: parseFloat(String(p.vol ?? 0)),
              margin,
              value: parseFloat(String(p.value ?? 0)),
              net: parseFloat(String(p.net ?? 0)),
              leverage,
              openTime,
              rollovertm: p.rollovertm ? parseFloat(String(p.rollovertm)) * 1000 : 0,
              actualRolloverCost: 0,
            };
          });
          results.krakenPositions = positions;
        } else {
          results.krakenPositions = [];
        }
      } else {
        // Fall back to database if API fails
        const krakenPositions = await prisma.position.findMany({
          where: includeHistory ? {} : { isOpen: true },
          orderBy: { openedAt: 'desc' },
          take: 20,
        });
        results.krakenPositions = krakenPositions.map(p => ({
          id: p.id,
          pair: p.pair,
          side: p.side,
          volume: p.volume,
          entryPrice: p.entryPrice,
          leverage: p.leverage,
          margin: p.margin,
          isOpen: p.isOpen,
          unrealizedPnl: p.unrealizedPnl,
          openedAt: p.openedAt.toISOString(),
          closedAt: p.closedAt?.toISOString(),
        }));
        results.krakenPositionsNote = 'Fetched from database (API unavailable)';
      }
    } catch {
      // Fall back to database on error
      const krakenPositions = await prisma.position.findMany({
        where: includeHistory ? {} : { isOpen: true },
        orderBy: { openedAt: 'desc' },
        take: 20,
      });
      results.krakenPositions = krakenPositions.map(p => ({
        id: p.id,
        pair: p.pair,
        side: p.side,
        volume: p.volume,
        entryPrice: p.entryPrice,
        leverage: p.leverage,
        margin: p.margin,
        isOpen: p.isOpen,
        unrealizedPnl: p.unrealizedPnl,
        openedAt: p.openedAt.toISOString(),
        closedAt: p.closedAt?.toISOString(),
      }));
      results.krakenPositionsNote = 'Fetched from database (API error)';
    }
  }

  return { success: true, data: results };
}

/**
 * Get current market data with optional indicators
 */
async function getMarketData(args: Record<string, unknown>): Promise<ToolResult> {
  const { pair = 'XRPEUR', includeIndicators = false, timeframe = '15m' } = args;
  const pairStr = String(pair).toUpperCase();

  try {
    // Fetch ticker data
    const tickerData = await fetchTicker(pairStr);

    const data: Record<string, unknown> = {
      pair: pairStr,
      price: tickerData.price || (tickerData as any).c?.[0],
      bid: tickerData.bid || (tickerData as any).b?.[0],
      ask: tickerData.ask || (tickerData as any).a?.[0],
      volume24h: tickerData.volume || (tickerData as any).v?.[1],
      high24h: tickerData.high || (tickerData as any).h?.[1],
      low24h: tickerData.low || (tickerData as any).l?.[1],
      open24h: tickerData.open || (tickerData as any).o,
      timestamp: new Date().toISOString(),
    };

    // Calculate 24h change
    const price = parseFloat(String(data.price));
    const open = parseFloat(String(data.open24h));
    if (price && open) {
      data.change24h = ((price - open) / open * 100).toFixed(2) + '%';
    }

    // Add indicators if requested
    if (includeIndicators) {
      const intervalMap: Record<string, number> = { '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
      const interval = intervalMap[String(timeframe)] || 15;

      const ohlc = await fetchOHLC(pairStr, interval);
      if (ohlc.length >= 50) {
        const indicators = calculateIndicators(ohlc);
        if (indicators) {
          data.indicators = {
            timeframe,
            rsi: indicators.rsi.toFixed(1),
            macd: indicators.macd.toFixed(6),
            macdSignal: (indicators.macdSignal ?? 0).toFixed(6),
            histogram: (indicators.histogram ?? 0).toFixed(6),
            bbPosition: (indicators.bbPos * 100).toFixed(0) + '%',
            bbUpper: (indicators.bbUpper ?? 0).toFixed(5),
            bbLower: (indicators.bbLower ?? 0).toFixed(5),
            atr: indicators.atr.toFixed(5),
            volumeRatio: indicators.volRatio.toFixed(2) + 'x',
            bias: indicators.bias,
            score: indicators.score,
          };
          // Include top candlestick patterns if detected
          if (indicators.extendedPatterns && indicators.extendedPatterns.length > 0) {
            data.candlestickPatterns = [...indicators.extendedPatterns]
              .sort((a, b) => (b.reliability * b.strength) - (a.reliability * a.strength))
              .slice(0, 3)
              .map(p => ({ name: p.name, type: p.type, reliability: p.reliability, strength: p.strength, candlesUsed: p.candlesUsed }));
          }
        }
      } else {
        data.indicators = { error: 'Insufficient OHLC data for indicators' };
      }
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Failed to fetch market data: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get full multi-timeframe trading recommendation
 */
async function getTradingRecommendation(args: Record<string, unknown>): Promise<ToolResult> {
  const { includeBTC = true } = args;
  const pair = 'XRPEUR';

  try {
    // Fetch OHLC data for all 5 timeframes (including daily)
    const [ohlc4h, ohlc1h, ohlc15m, ohlc5m, ohlc1d] = await Promise.all([
      fetchOHLC(pair, 240),
      fetchOHLC(pair, 60),
      fetchOHLC(pair, 15),
      fetchOHLC(pair, 5),
      fetchOHLC(pair, 1440), // Daily
    ]);

    // Calculate indicators for each timeframe
    const ind4h = calculateIndicators(ohlc4h);
    const ind1h = calculateIndicators(ohlc1h);
    const ind15m = calculateIndicators(ohlc15m);
    const ind5m = calculateIndicators(ohlc5m);
    const ind1d = calculateIndicators(ohlc1d);

    if (!ind4h || !ind1h || !ind15m || !ind5m) {
      return {
        success: false,
        error: 'Insufficient data to generate recommendation. Need at least 50 candles per timeframe.',
      };
    }

    // Build timeframe data objects
    const tf4h: TimeframeData = { ohlc: ohlc4h, indicators: ind4h };
    const tf1h: TimeframeData = { ohlc: ohlc1h, indicators: ind1h };
    const tf15m: TimeframeData = { ohlc: ohlc15m, indicators: ind15m };
    const tf5m: TimeframeData = { ohlc: ohlc5m, indicators: ind5m };
    const tf1d: TimeframeData | null = ind1d ? { ohlc: ohlc1d, indicators: ind1d } : null;

    // Get BTC correlation if requested
    let btcTrend: 'bull' | 'bear' | 'neut' = 'neut';
    let btcChange = 0;

    if (includeBTC) {
      try {
        const btcTicker = await fetchTicker('BTCEUR');
        const btcPrice = parseFloat(String(btcTicker.price || (btcTicker as any).c?.[0]));
        const btcOpen = parseFloat(String(btcTicker.open || (btcTicker as any).o));
        if (btcPrice && btcOpen) {
          btcChange = ((btcPrice - btcOpen) / btcOpen) * 100;
          const trendResult = calculateBTCTrend(btcChange);
          btcTrend = trendResult.trend;
        }
      } catch {
        // BTC fetch failed, continue with neutral
      }
    }

    // Get current price for ATR volatility calculation
    const currentPrice = ohlc15m[ohlc15m.length - 1]?.close || 0;

    // Generate recommendation
    const recommendation = generateRecommendation(
      tf4h, tf1h, tf15m, tf5m,
      btcTrend, btcChange,
      null, // microstructure (not available via API)
      null, // liquidation data (not available via API)
      tf1d, // Daily timeframe for trend filter
      currentPrice // For ATR volatility calculation
    );

    if (!recommendation) {
      return { success: false, error: 'Failed to generate recommendation' };
    }

    // Build chart context for confluent levels
    const strategy = getDefaultStrategy();
    const ohlcMap: Record<number, OHLCData[]> = {};
    if (ohlc1d.length > 0) ohlcMap[1440] = ohlc1d;
    if (ohlc4h.length > 0) ohlcMap[240] = ohlc4h;
    if (ohlc1h.length > 0) ohlcMap[60] = ohlc1h;
    if (ohlc15m.length > 0) ohlcMap[15] = ohlc15m;
    if (ohlc5m.length > 0) ohlcMap[5] = ohlc5m;

    const regimeAnalysis = detectMarketRegime(ind4h, ind1h);
    const chartCtx = buildChartContext(ohlcMap, pair, strategy.fibonacci, regimeAnalysis.regime);

    return {
      success: true,
      data: {
        pair,
        currentPrice: currentPrice.toFixed(5),
        action: recommendation.action,
        confidence: recommendation.confidence + '%',
        reason: recommendation.reason,
        scores: {
          long: `${recommendation.longScore}/${recommendation.totalItems}`,
          short: `${recommendation.shortScore}/${recommendation.totalItems}`,
        },
        checklist: recommendation.checklist,
        strategyContext: buildStrategyContextForTools(),
        btc: includeBTC ? {
          trend: btcTrend,
          change24h: btcChange.toFixed(2) + '%',
        } : undefined,
        reversalStatus: recommendation.reversalStatus || undefined,
        rejectionStatus: recommendation.rejectionStatus || undefined,
        candlestickPatterns: (() => {
          const patterns: Record<string, Array<{ name: string; type: string; reliability: number; strength: number }>> = {};
          const tfIndicators: Record<string, typeof ind5m> = { '5m': ind5m, '15m': ind15m };
          for (const [label, ind] of Object.entries(tfIndicators)) {
            if (ind?.extendedPatterns && ind.extendedPatterns.length > 0) {
              patterns[label] = [...ind.extendedPatterns]
                .sort((a, b) => (b.reliability * b.strength) - (a.reliability * a.strength))
                .slice(0, 3)
                .map(p => ({ name: p.name, type: p.type, reliability: p.reliability, strength: p.strength }));
            }
          }
          return Object.keys(patterns).length > 0 ? patterns : undefined;
        })(),
        confluentLevels: chartCtx.confluentLevels.map(l => ({
          price: l.price.toFixed(5),
          type: l.type,
          touches: l.touches,
          strength: l.strength,
          sources: l.sources,
        })),
        mtfAlignment: chartCtx.mtfAlignment,
        timeframeIndicators: {
          '4h': {
            rsi: ind4h.rsi.toFixed(1),
            macd: ind4h.macd > 0 ? 'bullish' : 'bearish',
            bias: ind4h.bias,
          },
          '1h': {
            rsi: ind1h.rsi.toFixed(1),
            macd: ind1h.macd > 0 ? 'bullish' : 'bearish',
            bias: ind1h.bias,
          },
          '15m': {
            rsi: ind15m.rsi.toFixed(1),
            macd: ind15m.macd > 0 ? 'bullish' : 'bearish',
            volumeRatio: ind15m.volRatio.toFixed(2) + 'x',
            bias: ind15m.bias,
          },
          '5m': {
            rsi: ind5m.rsi.toFixed(1),
            volumeRatio: ind5m.volRatio.toFixed(2) + 'x',
          },
        },
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to generate recommendation: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get OHLC data with optional indicators
 */
async function getOhlcData(args: Record<string, unknown>): Promise<ToolResult> {
  const { pair = 'XRPEUR', interval, limit = 50, since, includeIndicators = true } = args;

  if (!interval) {
    return { success: false, error: 'interval is required' };
  }

  const pairStr = String(pair).toUpperCase();
  const intervalNum = Number(interval);
  const limitNum = Math.min(Number(limit), 200);

  // Parse since parameter (ISO date string -> Unix timestamp in seconds)
  let sinceTs: number | undefined;
  if (since) {
    const parsed = new Date(String(since));
    if (!isNaN(parsed.getTime())) {
      sinceTs = Math.floor(parsed.getTime() / 1000);
    }
  }

  try {
    const ohlc = await fetchOHLC(pairStr, intervalNum, sinceTs);

    // Limit results
    const limitedOhlc = ohlc.slice(-limitNum);

    const data: Record<string, unknown> = {
      pair: pairStr,
      interval: intervalNum,
      intervalLabel: {
        1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d'
      }[intervalNum] || `${intervalNum}m`,
      candles: limitedOhlc.map(c => ({
        time: new Date(c.time * 1000).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      count: limitedOhlc.length,
    };

    // Add indicators if requested
    if (includeIndicators && ohlc.length >= 50) {
      const indicators = calculateIndicators(ohlc);
      if (indicators) {
        data.indicators = {
          rsi: indicators.rsi.toFixed(1),
          macd: indicators.macd.toFixed(6),
          macdSignal: (indicators.macdSignal ?? 0).toFixed(6),
          histogram: (indicators.histogram ?? 0).toFixed(6),
          bbPosition: (indicators.bbPos * 100).toFixed(0) + '%',
          bbUpper: (indicators.bbUpper ?? 0).toFixed(5),
          bbLower: (indicators.bbLower ?? 0).toFixed(5),
          atr: indicators.atr.toFixed(5),
          volumeRatio: indicators.volRatio.toFixed(2) + 'x',
          bias: indicators.bias,
          score: indicators.score,
        };
      }
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Failed to fetch OHLC: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Make Kraken API calls
 */
async function krakenApi(args: Record<string, unknown>): Promise<ToolResult> {
  const { endpoint, params } = args;

  if (!endpoint) {
    return { success: false, error: 'endpoint is required' };
  }

  const endpointStr = String(endpoint);
  const validEndpoints = ['balance', 'trade-balance', 'positions', 'orders', 'trades', 'ledgers'];

  if (!validEndpoints.includes(endpointStr)) {
    return { success: false, error: `Invalid endpoint. Valid: ${validEndpoints.join(', ')}` };
  }

  try {
    // Build URL with params
    let url = `${BASE_URL}/api/kraken/private/${endpointStr}`;
    if (params && typeof params === 'object') {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        searchParams.set(key, String(value));
      }
      const paramStr = searchParams.toString();
      if (paramStr) url += `?${paramStr}`;
    }

    const res = await fetch(url);
    if (!res.ok) {
      const errorText = await res.text();
      return { success: false, error: `Kraken API error: ${errorText}` };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Kraken API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Calculate tax for a given year
 */
async function calculateTax(args: Record<string, unknown>): Promise<ToolResult> {
  const { year, includeDetails = false } = args;

  if (!year) {
    return { success: false, error: 'Year is required' };
  }

  const yearNum = Number(year);
  const startDate = new Date(`${yearNum}-01-01`);
  const endDate = new Date(`${yearNum + 1}-01-01`);

  // Get all taxable transactions for the year
  const transactions = await prisma.transaction.findMany({
    where: {
      timestamp: { gte: startDate, lt: endDate },
      type: { in: ['MARGIN_TRADE', 'TRADE', 'STAKING_REWARD', 'EARN_REWARD', 'AIRDROP'] },
    },
    orderBy: { timestamp: 'asc' },
  });

  // Group margin trades by krakenOrderId to avoid double-counting fills
  const marginTradesByOrder = new Map<string, typeof transactions[0][]>();
  const otherTransactions: typeof transactions[0][] = [];

  for (const tx of transactions) {
    if (tx.type === 'MARGIN_TRADE' && tx.krakenOrderId) {
      const existing = marginTradesByOrder.get(tx.krakenOrderId) || [];
      existing.push(tx);
      marginTradesByOrder.set(tx.krakenOrderId, existing);
    } else {
      otherTransactions.push(tx);
    }
  }

  // Calculate margin P&L (only from closed positions)
  let marginGains = 0;
  let marginLosses = 0;
  let marginTradeCount = 0;

  for (const [, trades] of marginTradesByOrder) {
    // Use only the first trade's netPnl (Kraken aggregates there)
    const closedTrade = trades.find(t => t.posstatus === 'closed' && t.netPnl !== null);
    if (closedTrade && closedTrade.netPnl !== null) {
      if (closedTrade.netPnl >= 0) {
        marginGains += closedTrade.netPnl;
      } else {
        marginLosses += Math.abs(closedTrade.netPnl);
      }
      marginTradeCount++;
    }
  }

  // Calculate other income
  let stakingRewards = 0;
  let earnRewards = 0;
  let airdrops = 0;
  let spotGains = 0;
  let spotLosses = 0;

  for (const tx of otherTransactions) {
    switch (tx.type) {
      case 'STAKING_REWARD':
        stakingRewards += tx.cost || 0;
        break;
      case 'EARN_REWARD':
        earnRewards += tx.cost || 0;
        break;
      case 'AIRDROP':
        airdrops += tx.cost || 0;
        break;
      case 'TRADE':
        if (tx.gain) {
          if (tx.gain >= 0) {
            spotGains += tx.gain;
          } else {
            spotLosses += Math.abs(tx.gain);
          }
        }
        break;
    }
  }

  // Estonian tax rules: 22% on gains, losses NOT deductible
  const taxRate = yearNum >= 2025 ? 0.22 : 0.22;
  const totalGains = marginGains + spotGains + stakingRewards + earnRewards + airdrops;
  const taxDue = totalGains * taxRate;

  const result: Record<string, unknown> = {
    year: yearNum,
    taxRate,
    breakdown: {
      marginTrading: {
        gains: marginGains,
        losses: marginLosses,
        net: marginGains - marginLosses,
        tradeCount: marginTradeCount,
        note: 'Losses not deductible under Estonian tax law',
      },
      spotTrading: {
        gains: spotGains,
        losses: spotLosses,
        net: spotGains - spotLosses,
      },
      passiveIncome: {
        stakingRewards,
        earnRewards,
        airdrops,
        total: stakingRewards + earnRewards + airdrops,
      },
    },
    summary: {
      totalTaxableGains: totalGains,
      totalLosses: marginLosses + spotLosses,
      taxDue,
      effectiveRate: totalGains > 0 ? (taxDue / totalGains * 100).toFixed(1) + '%' : '0%',
    },
    note: 'Estonian tax: Only gains are taxable at ' + (taxRate * 100) + '%. Losses cannot offset gains.',
  };

  if (includeDetails) {
    result.transactionCount = transactions.length;
  }

  return { success: true, data: result };
}

/**
 * Analyze trading performance
 */
async function analyzeTrades(args: Record<string, unknown>): Promise<ToolResult> {
  const { period = 'month', type = 'all' } = args;

  // Calculate date range
  const now = new Date();
  let startDate: Date;

  switch (period) {
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      break;
    case 'quarter':
      startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      break;
    case 'year':
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      break;
    default:
      startDate = new Date(0);
  }

  const where: Record<string, unknown> = {
    timestamp: { gte: startDate },
  };

  if (type === 'margin') {
    where.type = 'MARGIN_TRADE';
  } else if (type === 'spot') {
    where.type = 'TRADE';
  } else {
    where.type = { in: ['MARGIN_TRADE', 'TRADE'] };
  }

  // Get closed positions for analysis
  where.posstatus = 'closed';

  const trades = await prisma.transaction.findMany({
    where,
    orderBy: { timestamp: 'desc' },
  });

  // Analyze performance
  const wins = trades.filter(t => (t.netPnl || 0) > 0);
  const losses = trades.filter(t => (t.netPnl || 0) < 0);
  const breakeven = trades.filter(t => (t.netPnl || 0) === 0);

  const totalPnl = trades.reduce((sum, t) => sum + (t.netPnl || 0), 0);
  const totalFees = trades.reduce((sum, t) => sum + (t.fee || 0), 0);

  const avgWin = wins.length > 0
    ? wins.reduce((sum, t) => sum + (t.netPnl || 0), 0) / wins.length
    : 0;

  const avgLoss = losses.length > 0
    ? losses.reduce((sum, t) => sum + (t.netPnl || 0), 0) / losses.length
    : 0;

  // Find best and worst trades
  const sortedByPnl = [...trades].sort((a, b) => (b.netPnl || 0) - (a.netPnl || 0));
  const bestTrade = sortedByPnl[0];
  const worstTrade = sortedByPnl[sortedByPnl.length - 1];

  return {
    success: true,
    data: {
      period,
      type,
      summary: {
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        breakeven: breakeven.length,
        winRate: trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(1) + '%' : 'N/A',
      },
      pnl: {
        total: totalPnl,
        avgWin,
        avgLoss,
        avgTrade: trades.length > 0 ? totalPnl / trades.length : 0,
        profitFactor: Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : 0,
      },
      fees: {
        total: totalFees,
        avgPerTrade: trades.length > 0 ? totalFees / trades.length : 0,
      },
      bestTrade: bestTrade ? {
        pair: bestTrade.pair,
        pnl: bestTrade.netPnl,
        date: bestTrade.timestamp.toISOString(),
      } : null,
      worstTrade: worstTrade ? {
        pair: worstTrade.pair,
        pnl: worstTrade.netPnl,
        date: worstTrade.timestamp.toISOString(),
      } : null,
    },
  };
}

/**
 * Get ledger entries
 */
async function getLedger(args: Record<string, unknown>): Promise<ToolResult> {
  const { type, asset, startDate, endDate, limit } = args;

  // Try to fetch from Kraken API
  try {
    const params: Record<string, string> = {};
    if (type && type !== 'all') params.type = String(type);
    if (asset) params.asset = String(asset);
    if (startDate) params.start = String(new Date(startDate as string).getTime() / 1000);
    if (endDate) params.end = String(new Date(endDate as string).getTime() / 1000);

    const res = await fetch(`${BASE_URL}/api/kraken/private/ledgers`);
    if (res.ok) {
      const data = await res.json();
      // Limit results if specified
      if (data.ledger && typeof limit === 'number') {
        const entries = Object.entries(data.ledger).slice(0, limit);
        data.ledger = Object.fromEntries(entries);
      }
      return { success: true, data };
    }
  } catch {
    // Fall through to message below
  }

  return {
    success: true,
    data: {
      note: 'Kraken ledger API not available. Use query_transactions for stored transaction data or kraken_api tool for live data.',
    },
  };
}

/**
 * Get account balance
 */
async function getBalance(args: Record<string, unknown>): Promise<ToolResult> {
  const { type = 'simulated' } = args;

  if (type === 'simulated') {
    const balance = await prisma.simulatedBalance.findUnique({
      where: { id: 'default' },
    });

    if (!balance) {
      return {
        success: true,
        data: {
          type: 'simulated',
          eurBalance: 2000,
          equity: 2000,
          marginUsed: 0,
          freeMargin: 20000,
          note: 'Default simulated balance (not initialized)',
        },
      };
    }

    return {
      success: true,
      data: {
        type: 'simulated',
        eurBalance: balance.eurBalance,
        cryptoValue: balance.cryptoValue,
        equity: balance.equity,
        marginUsed: balance.marginUsed,
        freeMargin: balance.freeMargin,
        marginLevel: balance.marginLevel,
        totalRealizedPnl: balance.totalRealizedPnl,
        totalFeesPaid: balance.totalFeesPaid,
      },
    };
  }

  // Kraken balance - fetch from API
  try {
    const [balanceRes, tradeBalanceRes] = await Promise.all([
      fetch(`${BASE_URL}/api/kraken/private/balance`),
      fetch(`${BASE_URL}/api/kraken/private/trade-balance`),
    ]);

    const result: Record<string, unknown> = { type: 'kraken' };

    if (balanceRes.ok) {
      const balanceData = await balanceRes.json();
      result.balance = balanceData;
    }

    if (tradeBalanceRes.ok) {
      const tradeBalance = await tradeBalanceRes.json();
      result.tradeBalance = {
        equity: tradeBalance.eb,
        tradeBalance: tradeBalance.tb,
        margin: tradeBalance.m,
        freeMargin: tradeBalance.mf,
        unrealizedPnl: tradeBalance.n,
        cost: tradeBalance.c,
        value: tradeBalance.v,
        marginLevel: tradeBalance.ml,
      };
    }

    if (result.balance || result.tradeBalance) {
      return { success: true, data: result };
    }
  } catch {
    // Fall through to error message
  }

  return {
    success: false,
    error: 'Failed to fetch Kraken balance. API authentication may be required.',
  };
}

/**
 * Generate AI trade analysis report (same as clicking "Run AI Analysis" in dashboard)
 */
async function generateAIReport(args: Record<string, unknown>): Promise<ToolResult> {
  const pair = String(args.pair || 'XRPEUR').toUpperCase();

  try {
    // Fetch all required data for the analysis
    const [ohlc4h, ohlc1h, ohlc15m, ohlc5m, tickerData] = await Promise.all([
      fetchOHLC(pair, 240),
      fetchOHLC(pair, 60),
      fetchOHLC(pair, 15),
      fetchOHLC(pair, 5),
      fetchTicker(pair),
    ]);

    // Calculate indicators
    const ind4h = calculateIndicators(ohlc4h);
    const ind1h = calculateIndicators(ohlc1h);
    const ind15m = calculateIndicators(ohlc15m);
    const ind5m = calculateIndicators(ohlc5m);

    if (!ind4h || !ind1h || !ind15m || !ind5m) {
      return { success: false, error: 'Insufficient data for analysis' };
    }

    const currentPrice = parseFloat(String(tickerData.price || (tickerData as any).c?.[0])) || 0;

    // Build market snapshot for AI analysis
    const marketData = {
      pair,
      currentPrice,
      timeframes: {
        '4h': { indicators: ind4h, recentCandles: ohlc4h.slice(-20) },
        '1h': { indicators: ind1h, recentCandles: ohlc1h.slice(-20) },
        '15m': { indicators: ind15m, recentCandles: ohlc15m.slice(-20) },
        '5m': { indicators: ind5m, recentCandles: ohlc5m.slice(-20) },
      },
      volume24h: tickerData.volume || (tickerData as any).v?.[1],
      high24h: tickerData.high || (tickerData as any).h?.[1],
      low24h: tickerData.low || (tickerData as any).l?.[1],
    };

    // Call the AI analyze API
    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketData }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      return { success: false, error: error.error || 'AI analysis failed' };
    }

    const result = await res.json();

    return {
      success: true,
      data: {
        reportSaved: true,
        message: 'AI analysis report generated and saved to Reports tab',
        summary: {
          action: result.tradeData?.action || 'WAIT',
          conviction: result.tradeData?.conviction,
          confidence: result.tradeData?.confidence,
          entry: result.tradeData?.entry,
          stopLoss: result.tradeData?.stopLoss,
          targets: result.tradeData?.targets,
          riskReward: result.tradeData?.riskReward,
        },
        analysis: result.analysis,
        priceAtAnalysis: currentPrice,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to generate report: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get saved AI reports
 */
async function getReports(args: Record<string, unknown>): Promise<ToolResult> {
  const { action, limit = 10, reportId } = args;

  try {
    // Get specific report by ID
    if (reportId) {
      const report = await prisma.aIMarketAnalysis.findUnique({
        where: { id: String(reportId) },
      });

      if (!report) {
        return { success: false, error: 'Report not found' };
      }

      return {
        success: true,
        data: {
          report: {
            id: report.id,
            pair: report.pair,
            action: report.action,
            conviction: report.conviction,
            confidence: report.confidence,
            entry: { low: report.entryLow, high: report.entryHigh },
            stopLoss: report.stopLoss,
            targets: report.targets ? JSON.parse(report.targets) : null,
            riskReward: report.riskReward,
            analysis: report.analysis,
            priceAtAnalysis: report.priceAtAnalysis,
            createdAt: report.createdAt.toISOString(),
            model: report.model,
          },
        },
      };
    }

    // List reports
    const where = action ? { action: String(action) } : {};
    const reports = await prisma.aIMarketAnalysis.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit), 50),
      select: {
        id: true,
        pair: true,
        action: true,
        conviction: true,
        confidence: true,
        entryLow: true,
        entryHigh: true,
        stopLoss: true,
        riskReward: true,
        priceAtAnalysis: true,
        createdAt: true,
        analysis: true,
      },
    });

    return {
      success: true,
      data: {
        reports: reports.map((r) => ({
          id: r.id,
          pair: r.pair,
          action: r.action,
          conviction: r.conviction,
          confidence: r.confidence,
          entry: { low: r.entryLow, high: r.entryHigh },
          stopLoss: r.stopLoss,
          riskReward: r.riskReward,
          priceAtAnalysis: r.priceAtAnalysis,
          createdAt: r.createdAt.toISOString(),
          // Include truncated analysis for context
          analysisSummary: r.analysis.slice(0, 500) + (r.analysis.length > 500 ? '...' : ''),
        })),
        total: reports.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to fetch reports: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get current trading setup/checklist
 */
async function getCurrentSetup(args: Record<string, unknown>): Promise<ToolResult> {
  const { detailed = false } = args;
  const pair = 'XRPEUR';

  try {
    // Fetch OHLC data for all timeframes (including daily)
    const [ohlc4h, ohlc1h, ohlc15m, ohlc5m, ohlc1d] = await Promise.all([
      fetchOHLC(pair, 240),
      fetchOHLC(pair, 60),
      fetchOHLC(pair, 15),
      fetchOHLC(pair, 5),
      fetchOHLC(pair, 1440), // Daily
    ]);

    // Calculate indicators
    const ind4h = calculateIndicators(ohlc4h);
    const ind1h = calculateIndicators(ohlc1h);
    const ind15m = calculateIndicators(ohlc15m);
    const ind5m = calculateIndicators(ohlc5m);
    const ind1d = calculateIndicators(ohlc1d);

    if (!ind4h || !ind1h || !ind15m || !ind5m) {
      return { success: false, error: 'Insufficient data for setup analysis' };
    }

    // Get BTC correlation
    let btcTrend: 'bull' | 'bear' | 'neut' = 'neut';
    let btcChange = 0;
    try {
      const btcTicker = await fetchTicker('BTCEUR');
      const btcPrice = parseFloat(String(btcTicker.price || (btcTicker as any).c?.[0]));
      const btcOpen = parseFloat(String(btcTicker.open || (btcTicker as any).o));
      if (btcPrice && btcOpen) {
        btcChange = ((btcPrice - btcOpen) / btcOpen) * 100;
        const trendResult = calculateBTCTrend(btcChange);
        btcTrend = trendResult.trend;
      }
    } catch {
      // Continue with neutral BTC
    }

    // Build timeframe data
    const tf4h: TimeframeData = { ohlc: ohlc4h, indicators: ind4h };
    const tf1h: TimeframeData = { ohlc: ohlc1h, indicators: ind1h };
    const tf15m: TimeframeData = { ohlc: ohlc15m, indicators: ind15m };
    const tf5m: TimeframeData = { ohlc: ohlc5m, indicators: ind5m };
    const tf1d: TimeframeData | null = ind1d ? { ohlc: ohlc1d, indicators: ind1d } : null;

    const currentPrice = ohlc15m[ohlc15m.length - 1]?.close || 0;

    // Generate recommendation to get checklist
    const recommendation = generateRecommendation(tf4h, tf1h, tf15m, tf5m, btcTrend, btcChange, null, null, tf1d, currentPrice);

    if (!recommendation) {
      return { success: false, error: 'Failed to generate setup analysis' };
    }

    const data: Record<string, unknown> = {
      pair,
      currentPrice: currentPrice.toFixed(5),
      setupStatus: recommendation.action === 'LONG' || recommendation.action === 'SHORT'
        ? `${recommendation.action} setup VALID`
        : recommendation.longScore >= 4 || recommendation.shortScore >= 4
          ? `Setup forming (${recommendation.longScore > recommendation.shortScore ? 'LONG' : 'SHORT'} ${Math.max(recommendation.longScore, recommendation.shortScore)}/${recommendation.totalItems})`
          : 'No clear setup',
      action: recommendation.action,
      confidence: recommendation.confidence + '%',
      scores: {
        long: `${recommendation.longScore}/${recommendation.totalItems}`,
        short: `${recommendation.shortScore}/${recommendation.totalItems}`,
      },
      checklist: {
        '4H_trend': {
          pass: recommendation.checklist.trend4h.pass,
          value: recommendation.checklist.trend4h.value,
          requirement: 'bullish for LONG, bearish for SHORT',
        },
        '1H_setup': {
          pass: recommendation.checklist.setup1h.pass,
          value: recommendation.checklist.setup1h.value,
          requirement: 'bullish for LONG, bearish for SHORT',
        },
        '15m_entry': {
          pass: recommendation.checklist.entry15m.pass,
          value: recommendation.checklist.entry15m.value,
          requirement: 'RSI 20-45 for LONG, RSI 55-80 for SHORT',
        },
        'volume': {
          pass: recommendation.checklist.volume.pass,
          value: recommendation.checklist.volume.value,
          requirement: '>1.3x average',
        },
        'BTC_aligned': {
          pass: recommendation.checklist.btcAlign.pass,
          value: recommendation.checklist.btcAlign.value,
          requirement: 'BTC bull (or neutral + 4H bullish) for LONG',
        },
        'MACD_momentum': {
          pass: recommendation.checklist.macdMomentum.pass,
          value: recommendation.checklist.macdMomentum.value,
          requirement: 'Histogram >0 for LONG, <0 for SHORT',
        },
        ...(recommendation.checklist.trend1d ? {
          '1D_trend': {
            pass: recommendation.checklist.trend1d.pass,
            value: recommendation.checklist.trend1d.value,
            requirement: 'not bearish for LONG, not bullish for SHORT',
          },
        } : {}),
      },
      reason: recommendation.reason,
      btc: {
        trend: btcTrend,
        change24h: btcChange.toFixed(2) + '%',
      },
    };

    // Add liquidation bias if available in checklist
    if (recommendation.checklist.liqBias) {
      (data.checklist as Record<string, unknown>).liq_bias = {
        pass: recommendation.checklist.liqBias.pass,
        value: recommendation.checklist.liqBias.value,
        requirement: 'short squeeze for LONG, long squeeze for SHORT',
      };
    }

    // Add rejection if available in checklist
    if (recommendation.checklist.rejection) {
      (data.checklist as Record<string, unknown>).rejection = {
        pass: recommendation.checklist.rejection.pass,
        value: recommendation.checklist.rejection.value,
        requirement: 'All four conditions: near S/R + reversal candle + MACD confirms + volume',
      };
    }

    // Add detailed indicators if requested
    if (detailed) {
      data.detailedIndicators = {
        '4h': {
          rsi: ind4h.rsi.toFixed(1),
          macd: ind4h.macd.toFixed(6),
          macdSignal: (ind4h.macdSignal ?? 0).toFixed(6),
          bbPosition: (ind4h.bbPos * 100).toFixed(0) + '%',
          atr: ind4h.atr.toFixed(5),
          volumeRatio: ind4h.volRatio.toFixed(2) + 'x',
          bias: ind4h.bias,
          score: ind4h.score,
        },
        '1h': {
          rsi: ind1h.rsi.toFixed(1),
          macd: ind1h.macd.toFixed(6),
          macdSignal: (ind1h.macdSignal ?? 0).toFixed(6),
          bbPosition: (ind1h.bbPos * 100).toFixed(0) + '%',
          atr: ind1h.atr.toFixed(5),
          volumeRatio: ind1h.volRatio.toFixed(2) + 'x',
          bias: ind1h.bias,
          score: ind1h.score,
        },
        '15m': {
          rsi: ind15m.rsi.toFixed(1),
          macd: ind15m.macd.toFixed(6),
          macdSignal: (ind15m.macdSignal ?? 0).toFixed(6),
          bbPosition: (ind15m.bbPos * 100).toFixed(0) + '%',
          atr: ind15m.atr.toFixed(5),
          volumeRatio: ind15m.volRatio.toFixed(2) + 'x',
          bias: ind15m.bias,
          score: ind15m.score,
        },
        '5m': {
          rsi: ind5m.rsi.toFixed(1),
          volumeRatio: ind5m.volRatio.toFixed(2) + 'x',
          bias: ind5m.bias,
        },
      };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get setup: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Analyze a specific position
 */
async function analyzePosition(args: Record<string, unknown>): Promise<ToolResult> {
  const { positionId, type = 'simulated' } = args;

  try {
    let position;

    if (type === 'simulated') {
      if (positionId) {
        position = await prisma.simulatedPosition.findUnique({
          where: { id: String(positionId) },
        });
      } else {
        // Get first open position
        position = await prisma.simulatedPosition.findFirst({
          where: { isOpen: true },
          orderBy: { openedAt: 'desc' },
        });
      }

      if (!position) {
        return { success: false, error: 'No open position found' };
      }

      // Get current price
      const ticker = await fetchTicker(position.pair);
      const currentPrice = parseFloat(String(ticker.price || (ticker as any).c?.[0])) || 0;

      // Calculate P&L
      const direction = position.side === 'buy' ? 1 : -1;
      const priceDiff = (currentPrice - position.avgEntryPrice) * direction;
      const unrealizedPnl = priceDiff * position.volume;
      const pnlPercent = (priceDiff / position.avgEntryPrice) * 100;

      // Get current setup for context
      const setupResult = await getCurrentSetup({ detailed: false });
      const currentSetup = setupResult.success ? setupResult.data : null;

      // Calculate risk metrics
      const positionValue = position.volume * currentPrice;
      const marginUsed = positionValue / position.leverage;
      const liqResult = calculateLiquidationPrice(
        position.avgEntryPrice,
        marginUsed,
        positionValue,
        position.side === 'buy' ? 'long' : 'short',
        position.leverage
      );
      const liquidationDistance = liqResult.distancePercent;

      return {
        success: true,
        data: {
          position: {
            id: position.id,
            pair: position.pair,
            side: position.side === 'buy' ? 'LONG' : 'SHORT',
            volume: position.volume,
            avgEntryPrice: position.avgEntryPrice.toFixed(5),
            leverage: position.leverage + 'x',
            openedAt: position.openedAt.toISOString(),
            totalCost: position.totalCost.toFixed(2),
            totalFees: position.totalFees.toFixed(2),
          },
          currentPrice: currentPrice.toFixed(5),
          pnl: {
            unrealized: unrealizedPnl.toFixed(2),
            percent: pnlPercent.toFixed(2) + '%',
            status: unrealizedPnl >= 0 ? 'PROFIT' : 'LOSS',
          },
          risk: {
            positionValue: positionValue.toFixed(2),
            marginUsed: marginUsed.toFixed(2),
            leverageRisk: position.leverage >= 10 ? 'HIGH' : position.leverage >= 5 ? 'MEDIUM' : 'LOW',
            liquidationDistance: liquidationDistance.toFixed(2) + '%',
          },
          marketContext: currentSetup ? {
            currentSetupAction: (currentSetup as any).action,
            setupConfidence: (currentSetup as any).confidence,
            alignedWithPosition: (position.side === 'buy' && (currentSetup as any).action === 'LONG') ||
                                 (position.side === 'sell' && (currentSetup as any).action === 'SHORT'),
          } : null,
          suggestion: unrealizedPnl > 0 && pnlPercent > 5
            ? 'Consider taking partial profits — check exit pressure via get_v2_engine_state'
            : unrealizedPnl < 0
              ? 'Strategy uses momentum exhaustion DCA and NO stop losses. Check DCA signal via get_v2_engine_state.'
              : 'Monitor position — check timebox and exit pressure via get_v2_engine_state',
        },
      };
    }

    // Kraken positions - fetch live from API
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/api/kraken/private/positions`);
      if (!res.ok) {
        return { success: false, error: 'Failed to fetch Kraken positions' };
      }

      const data = await res.json();
      if (!data || typeof data !== 'object' || data.error) {
        return { success: false, error: 'No Kraken positions found' };
      }

      const entries = Object.entries(data);
      if (entries.length === 0) {
        return { success: false, error: 'No open Kraken positions found' };
      }

      // Find the specific position or use first
      let posEntry: [string, unknown];
      if (positionId) {
        const found = entries.find(([id]) => id === String(positionId));
        if (!found) {
          return { success: false, error: `Kraken position ${positionId} not found` };
        }
        posEntry = found;
      } else {
        posEntry = entries[0];
      }

      const [posId, posData] = posEntry;
      const p = posData as Record<string, unknown>;

      // Get current price for P&L calculation
      const pair = String(p.pair || 'XRPEUR');
      const ticker = await fetchTicker(pair);
      const currentPrice = parseFloat(String(ticker.price || (ticker as any).c?.[0])) || 0;

      const vol = Number(p.vol) || 0;
      const cost = Number(p.cost) || 0;
      const entryPrice = vol > 0 ? cost / vol : 0;
      const fee = Number(p.fee) || 0;
      const net = Number(p.net) || 0;
      const side = String(p.type || 'buy');
      const direction = side === 'buy' ? 1 : -1;
      const priceDiff = (currentPrice - entryPrice) * direction;
      const unrealizedPnl = priceDiff * vol - fee;
      const pnlPercent = entryPrice > 0 ? (priceDiff / entryPrice) * 100 : 0;

      // Get current setup for context
      const setupResult = await getCurrentSetup({ detailed: false });
      const currentSetup = setupResult.success ? setupResult.data : null;

      return {
        success: true,
        data: {
          position: {
            id: posId,
            pair,
            side: side === 'buy' ? 'LONG' : 'SHORT',
            volume: vol,
            entryPrice: entryPrice.toFixed(5),
            cost: cost.toFixed(2),
            fee: fee.toFixed(2),
            leverage: p.leverage,
            margin: p.margin,
            openedAt: p.time ? new Date(Number(p.time) * 1000).toISOString() : null,
          },
          currentPrice: currentPrice.toFixed(5),
          pnl: {
            unrealized: unrealizedPnl.toFixed(2),
            net: net,
            percent: pnlPercent.toFixed(2) + '%',
            status: unrealizedPnl >= 0 ? 'PROFIT' : 'LOSS',
          },
          marketContext: currentSetup ? {
            currentSetupAction: (currentSetup as any).action,
            setupConfidence: (currentSetup as any).confidence,
            alignedWithPosition: (side === 'buy' && (currentSetup as any).action === 'LONG') ||
                                 (side === 'sell' && (currentSetup as any).action === 'SHORT'),
          } : null,
          suggestion: unrealizedPnl > 0 && pnlPercent > 5
            ? 'Consider taking partial profits — check exit pressure via get_v2_engine_state'
            : unrealizedPnl < 0
              ? 'Strategy uses momentum exhaustion DCA and NO stop losses. Check DCA signal via get_v2_engine_state.'
              : 'Monitor position — check timebox and exit pressure via get_v2_engine_state',
          totalKrakenPositions: entries.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch Kraken positions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to analyze position: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get detailed chart structure analysis
 */
async function getChartAnalysis(args: Record<string, unknown>): Promise<ToolResult> {
  const pair = String(args.pair || 'XRPEUR').toUpperCase();
  const requestedTimeframes = (Array.isArray(args.timeframes) ? args.timeframes : [15, 60, 240, 1440]) as number[];

  try {
    // Fetch OHLC for requested timeframes
    const ohlcEntries = await Promise.all(
      requestedTimeframes.map(async (tf) => {
        const ohlc = await fetchOHLC(pair, tf);
        return [tf, ohlc] as [number, OHLCData[]];
      })
    );

    const ohlcMap: Record<number, OHLCData[]> = {};
    for (const [tf, ohlc] of ohlcEntries) {
      if (ohlc.length > 0) ohlcMap[tf] = ohlc;
    }

    if (Object.keys(ohlcMap).length === 0) {
      return { success: false, error: 'No OHLC data available for any requested timeframe' };
    }

    // Get strategy for fibonacci config
    const strategy = getDefaultStrategy();

    // Detect market regime if we have 4H and 1H data
    let regime: import('@/lib/trading/market-regime').MarketRegime | undefined;
    if (ohlcMap[240] && ohlcMap[60]) {
      const ind4h = calculateIndicators(ohlcMap[240]);
      const ind1h = calculateIndicators(ohlcMap[60]);
      if (ind4h && ind1h) {
        const regimeAnalysis = detectMarketRegime(ind4h, ind1h);
        regime = regimeAnalysis.regime;
      }
    }

    // Build chart context
    const chartCtx = buildChartContext(ohlcMap, pair, strategy.fibonacci, regime);

    // Format per-timeframe data for response
    const timeframeAnalysis: Record<string, unknown> = {};
    for (const [label, tf] of Object.entries(chartCtx.timeframes)) {
      timeframeAnalysis[label] = {
        trend: tf.trend,
        keyLevels: tf.keyLevels.map(l => ({
          price: l.price.toFixed(5),
          type: l.type,
          touches: l.touches,
          strength: l.strength,
          sources: l.sources,
        })),
        recentSwings: tf.recentSwings.map(s => ({
          price: s.price.toFixed(5),
          type: s.type,
          strength: s.strength,
          time: new Date(s.timestamp * 1000).toISOString(),
        })),
        patterns: tf.patterns.map(p => ({
          name: p.name,
          type: p.type,
          significance: p.significance,
        })),
        priceActionSummary: tf.priceActionSummary,
        range: {
          high: tf.rangeHigh.toFixed(5),
          low: tf.rangeLow.toFixed(5),
          percent: tf.rangePercent.toFixed(2) + '%',
        },
      };
    }

    return {
      success: true,
      data: {
        pair,
        currentPrice: (chartCtx.timeframes['5m']?.currentPrice || chartCtx.timeframes['15m']?.currentPrice || 0).toFixed(5),
        timeframes: timeframeAnalysis,
        confluentLevels: chartCtx.confluentLevels.map(l => ({
          price: l.price.toFixed(5),
          type: l.type,
          touches: l.touches,
          strength: l.strength,
          sources: l.sources,
        })),
        mtfAlignment: chartCtx.mtfAlignment,
        mtfSummary: chartCtx.mtfSummary,
        regime: regime || 'unknown',
        timestamp: chartCtx.timestamp,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get chart analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get current strategy configuration
 */
async function getStrategyConfig(args: Record<string, unknown>): Promise<ToolResult> {
  const { section = 'all' } = args;

  try {
    const strategy = getDefaultStrategy();

    if (section === 'all') {
      return {
        success: true,
        data: {
          meta: strategy.meta,
          timeframeWeights: strategy.timeframeWeights,
          signals: strategy.signals,
          spike: strategy.spike,
          positionSizing: strategy.positionSizing,
          dca: {
            ...strategy.dca,
            exhaustionSignalDescriptions: {
              rsiDivergence: `RSI dropping below ${strategy.dca.exhaustionThresholds.rsiOversold} (long) or above ${strategy.dca.exhaustionThresholds.rsiOverbought} (short) — momentum exhausting`,
              volumeDryUp: `5m volume ratio dropping below ${strategy.dca.exhaustionThresholds.volumeDecline5m}x (declining) or ${strategy.dca.exhaustionThresholds.volumeFading5m}x (fading) — selling/buying pressure dying`,
              macdContraction: `MACD histogram contracting toward zero (within ${strategy.dca.exhaustionThresholds.macdNearZero}) — momentum stalling`,
              bbMiddleReturn: `BB position returning to middle band (${strategy.dca.exhaustionThresholds.bbMiddleLow}-${strategy.dca.exhaustionThresholds.bbMiddleHigh}) — volatility calming`,
              priceStabilizing: `${strategy.dca.exhaustionThresholds.priceStabilizingMinMatches}+ of last ${strategy.dca.exhaustionThresholds.priceStabilizingLookback} candles showing HL (long) or LH (short) — price stabilizing`,
            },
          },
          exit: strategy.exit,
          antiGreed: strategy.antiGreed,
          timebox: strategy.timebox,
          risk: strategy.risk,
          aiInstructions: strategy.aiInstructions || null,
        },
      };
    }

    // Return specific section
    const sectionMap: Record<string, unknown> = {
      meta: strategy.meta,
      weights: strategy.timeframeWeights,
      signals: strategy.signals,
      positionSizing: strategy.positionSizing,
      dca: strategy.dca,
      exit: strategy.exit,
      timebox: strategy.timebox,
      antiGreed: strategy.antiGreed,
      risk: strategy.risk,
    };

    const data = sectionMap[section as string];
    if (!data) {
      return { success: false, error: `Unknown section: ${section}. Valid: ${Object.keys(sectionMap).join(', ')}` };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get strategy config: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get v2 engine state for the current position.
 * Server-side computation of DCA signals, exit signals, timebox, anti-greed, and sizing.
 */
async function getV2EngineState(args: Record<string, unknown>): Promise<ToolResult> {
  const { type = 'simulated' } = args;
  const pair = 'XRPEUR';
  const strategy = getDefaultStrategy();

  try {
    // Fetch current price
    const ticker = await fetchTicker(pair);
    const currentPrice = parseFloat(String(ticker.price || (ticker as any).c?.[0])) || 0;

    if (currentPrice <= 0) {
      return { success: false, error: 'Failed to get current price' };
    }

    // Fetch OHLC for indicator calculation (with individual error handling)
    let ohlc15m: OHLCData[] = [];
    let ohlc1h: OHLCData[] = [];
    let ohlc5m: OHLCData[] = [];

    try {
      [ohlc15m, ohlc1h, ohlc5m] = await Promise.all([
        fetchOHLC(pair, 15),
        fetchOHLC(pair, 60),
        fetchOHLC(pair, 5),
      ]);
    } catch (ohlcError) {
      return {
        success: false,
        error: `Failed to fetch OHLC data for v2 engine: ${ohlcError instanceof Error ? ohlcError.message : 'Unknown error'}. The Kraken API may be temporarily unavailable.`,
      };
    }

    const ind15m = calculateIndicators(ohlc15m);
    const ind1h = calculateIndicators(ohlc1h);
    const ind5m = calculateIndicators(ohlc5m);

    if (!ind15m || !ind1h || !ind5m) {
      return {
        success: false,
        error: `Insufficient OHLC data for indicator calculation (15m: ${ohlc15m.length}, 1h: ${ohlc1h.length}, 5m: ${ohlc5m.length} candles). Need at least 50 candles per timeframe.`,
      };
    }

    // Get position data
    let positionState: PositionState = EMPTY_POSITION_STATE;
    let hasPosition = false;

    if (type === 'simulated') {
      const simPos = await prisma.simulatedPosition.findFirst({
        where: { isOpen: true },
        orderBy: { openedAt: 'desc' },
      });

      if (simPos) {
        hasPosition = true;
        const direction: TradeDirection = simPos.side === 'sell' ? 'short' : 'long';
        const hoursOpen = (Date.now() - new Date(simPos.openedAt).getTime()) / 3600000;
        const dirMult = direction === 'long' ? 1 : -1;
        const priceDiff = (currentPrice - simPos.avgEntryPrice) * dirMult;
        const unrealizedPnl = priceDiff * simPos.volume;
        const unrealizedPnlPercent = (priceDiff / simPos.avgEntryPrice) * 100;
        const positionValue = simPos.volume * currentPrice;
        const marginUsed = positionValue / simPos.leverage;
        const liqResult = calculateLiquidationPrice(simPos.avgEntryPrice, marginUsed, positionValue, direction, simPos.leverage);

        positionState = {
          isOpen: true,
          direction,
          phase: 'entry',
          entries: [{
            id: simPos.id,
            type: 'initial',
            dcaLevel: 0,
            price: simPos.avgEntryPrice,
            volume: simPos.volume,
            marginUsed,
            marginPercent: 0,
            timestamp: new Date(simPos.openedAt).getTime(),
            confidence: 0,
            entryMode: 'full',
            reason: 'Existing position',
          }],
          avgPrice: simPos.avgEntryPrice,
          totalVolume: simPos.volume,
          totalMarginUsed: marginUsed,
          totalMarginPercent: 0,
          dcaCount: 0,
          unrealizedPnL: unrealizedPnl,
          unrealizedPnLPercent: unrealizedPnlPercent,
          unrealizedPnLLevered: unrealizedPnl,
          unrealizedPnLLeveredPercent: unrealizedPnlPercent * simPos.leverage,
          highWaterMarkPnL: Math.max(unrealizedPnl, 0),
          drawdownFromHWM: 0,
          drawdownFromHWMPercent: 0,
          openedAt: new Date(simPos.openedAt).getTime(),
          timeInTradeMs: hoursOpen * 3600000,
          hoursRemaining: Math.max(0, strategy.timebox.maxHours - hoursOpen),
          timeboxProgress: Math.min(1, hoursOpen / strategy.timebox.maxHours),
          liquidationPrice: liqResult.liquidationPrice,
          liquidationDistancePercent: liqResult.distancePercent,
          leverage: simPos.leverage,
          totalFees: simPos.totalFees,
          rolloverCostPer4h: 0,
        };
      }
    } else {
      // Kraken positions
      try {
        const res = await fetchWithTimeout(`${BASE_URL}/api/kraken/private/positions`);
        if (res.ok) {
          const data = await res.json();
          const allEntries = Object.entries(data);

          // Filter to XRP positions of same type for consolidation
          const xrpEntries = allEntries.filter(([, posData]) => {
            const p = posData as Record<string, unknown>;
            const pairStr = String(p.pair || '');
            return pairStr.includes('XRP') || pairStr.includes('XXRP');
          });

          if (xrpEntries.length > 0) {
            hasPosition = true;

            // Consolidate all XRP positions (same direction)
            let totalVol = 0, totalCost = 0, totalFee = 0, totalMargin = 0;
            let earliestTime = Infinity;
            let firstType = 'buy';
            let firstLeverage = 10;

            // Collect raw entries grouped by ordertxid
            const rawByOrder = new Map<string, { cost: number; vol: number; fee: number; margin: number; time: number }>();

            for (const [, posData] of xrpEntries) {
              const p = posData as Record<string, unknown>;
              const vol = Number(p.vol) || 0;
              const cost = Number(p.cost) || 0;
              const fee = Number(p.fee) || 0;
              const margin = Number(p.margin) || 0;
              const rawTime = p.time ? parseFloat(String(p.time)) : NaN;
              const openTime = Number.isFinite(rawTime) ? rawTime * 1000 : Date.now();
              const ordertxid = String(p.ordertxid || '');
              const rawLev = p.leverage ? parseFloat(String(p.leverage)) : NaN;

              totalVol += vol;
              totalCost += cost;
              totalFee += fee;
              totalMargin += margin;
              if (openTime < earliestTime) {
                earliestTime = openTime;
                firstType = String(p.type || 'buy');
              }
              if (Number.isFinite(rawLev)) firstLeverage = rawLev;

              // Group partial fills by ordertxid
              const key = ordertxid || `anon-${openTime}`;
              const existing = rawByOrder.get(key);
              if (existing) {
                existing.cost += cost;
                existing.vol += vol;
                existing.fee += fee;
                existing.margin += margin;
                existing.time = Math.min(existing.time, openTime);
              } else {
                rawByOrder.set(key, { cost, vol, fee, margin, time: openTime });
              }
            }

            // Sort grouped entries by time
            const sortedGroups = Array.from(rawByOrder.entries())
              .sort((a, b) => a[1].time - b[1].time);

            const direction: TradeDirection = firstType === 'sell' ? 'short' : 'long';
            const entryPrice = totalVol > 0 ? totalCost / totalVol : 0;
            const leverage = firstLeverage > 0 ? firstLeverage : (totalMargin > 0 ? Math.round(totalCost / totalMargin) : 10);
            const openTime = earliestTime < Infinity ? earliestTime : Date.now();
            const hoursOpen = (Date.now() - openTime) / 3600000;
            const dirMult = direction === 'long' ? 1 : -1;
            const priceDiff = (currentPrice - entryPrice) * dirMult;
            const unrealizedPnl = priceDiff * totalVol - totalFee;
            const unrealizedPnlPercent = entryPrice > 0 ? (priceDiff / entryPrice) * 100 : 0;
            const posValue = totalVol * currentPrice;
            const liqResult = calculateLiquidationPrice(entryPrice, totalMargin, posValue, direction, leverage);

            // Build entry records from grouped ordertxid entries
            const entryRecords: Array<import('@/lib/trading/v2-types').EntryRecord> = sortedGroups.map(([, g], idx) => ({
              id: idx === 0 ? 'initial' : `dca-${idx}`,
              type: (idx === 0 ? 'initial' : 'dca') as 'initial' | 'dca',
              dcaLevel: idx,
              price: g.vol > 0 ? g.cost / g.vol : 0,
              volume: g.vol,
              marginUsed: g.margin,
              marginPercent: 0,
              timestamp: g.time,
              confidence: 0,
              entryMode: 'full' as const,
              reason: idx === 0 ? 'Initial entry' : `DCA entry #${idx}`,
            }));

            const dcaCount = Math.min(entryRecords.length - 1, strategy.positionSizing.maxDCACount);

            positionState = {
              isOpen: true,
              direction,
              phase: 'entry',
              entries: entryRecords,
              avgPrice: entryPrice,
              totalVolume: totalVol,
              totalMarginUsed: totalMargin,
              totalMarginPercent: 0,
              dcaCount,
              unrealizedPnL: unrealizedPnl,
              unrealizedPnLPercent: unrealizedPnlPercent,
              unrealizedPnLLevered: unrealizedPnl,
              unrealizedPnLLeveredPercent: unrealizedPnlPercent * leverage,
              highWaterMarkPnL: Math.max(unrealizedPnl, 0),
              drawdownFromHWM: 0,
              drawdownFromHWMPercent: 0,
              openedAt: openTime,
              timeInTradeMs: hoursOpen * 3600000,
              hoursRemaining: Math.max(0, strategy.timebox.maxHours - hoursOpen),
              timeboxProgress: Math.min(1, hoursOpen / strategy.timebox.maxHours),
              liquidationPrice: liqResult.liquidationPrice,
              liquidationDistancePercent: liqResult.distancePercent,
              leverage,
              totalFees: totalFee,
              rolloverCostPer4h: 0,
            };
          }
        }
      } catch {
        // Position fetch failed, continue with no position
      }
    }

    // Build result
    const result: Record<string, unknown> = {
      hasPosition,
      currentPrice: currentPrice.toFixed(5),
      strategyName: strategy.meta.name,
    };

    if (hasPosition) {
      // Position info
      const hoursOpen = positionState.timeInTradeMs / 3600000;
      result.position = {
        direction: positionState.direction,
        avgPrice: positionState.avgPrice.toFixed(5),
        totalVolume: positionState.totalVolume,
        dcaCount: positionState.dcaCount,
        maxDCA: strategy.positionSizing.maxDCACount,
        unrealizedPnl: positionState.unrealizedPnL.toFixed(2),
        unrealizedPnlPercent: positionState.unrealizedPnLPercent.toFixed(2) + '%',
        liquidationPrice: positionState.liquidationPrice.toFixed(5),
        liquidationDistance: positionState.liquidationDistancePercent.toFixed(2) + '%',
      };

      // Timebox status
      const timePhase = getTimePhase(hoursOpen);
      const timeboxPressure = calculateTimeboxPressure(hoursOpen, strategy.timebox);
      const currentStep = strategy.timebox.steps.filter(s => hoursOpen >= s.hours).pop();
      result.timebox = {
        hoursOpen: hoursOpen.toFixed(1),
        hoursRemaining: positionState.hoursRemaining.toFixed(1),
        maxHours: strategy.timebox.maxHours,
        progress: (positionState.timeboxProgress * 100).toFixed(0) + '%',
        phase: timePhase,
        pressure: timeboxPressure,
        currentStep: currentStep?.label || 'Fresh entry',
      };

      // DCA signal analysis
      if (ind15m && ind1h && ind5m) {
        const dcaSignal = analyzeDCAOpportunity(
          positionState,
          ind15m,
          ind1h,
          ind5m,
          ohlc5m,
          currentPrice,
          strategy.dca
        );

        result.dcaSignal = {
          shouldDCA: dcaSignal.shouldDCA,
          confidence: dcaSignal.confidence,
          dcaLevel: dcaSignal.dcaLevel,
          exhaustionType: dcaSignal.exhaustionType,
          drawdownPercent: dcaSignal.drawdownPercent.toFixed(2) + '%',
          reason: dcaSignal.reason,
          signals: dcaSignal.signals.map(sig => ({
            name: sig.name,
            active: sig.active,
            value: sig.value,
            timeframe: sig.timeframe,
          })),
          warnings: dcaSignal.warnings,
        };
      }

      // Reversal detection for exit analysis
      let reversalSignal = null;
      if (ind5m && ind15m) {
        const posDir = positionState.direction === 'long' ? 'long' as const : positionState.direction === 'short' ? 'short' as const : null;
        reversalSignal = detectReversal5m15m(ohlc5m, ohlc15m, ind5m, ind15m, posDir);
      }

      // Exit signal analysis (now includes reversal signal as 8th source)
      if (ind15m && ind1h && ind5m) {
        const exitSignal = analyzeExitConditions(
          positionState,
          ind15m,
          ind1h,
          ind5m,
          currentPrice,
          Date.now(),
          strategy,
          reversalSignal
        );

        const exitSummary = getExitStatusSummary(exitSignal);
        result.exitSignal = {
          shouldExit: exitSignal.shouldExit,
          urgency: exitSignal.urgency,
          reason: exitSignal.reason,
          totalPressure: exitSignal.totalPressure,
          pressureThreshold: strategy.exit.exitPressureThreshold,
          explanation: exitSignal.explanation,
          pressureSources: exitSignal.pressures.map(p => ({
            source: p.source,
            value: p.value,
            detail: p.detail,
          })),
          statusSummary: exitSummary,
        };
      }

      // Reversal signal status (for AI reasoning about position management)
      if (reversalSignal && reversalSignal.detected) {
        result.reversalSignal = {
          detected: true,
          phase: reversalSignal.phase,
          direction: reversalSignal.direction,
          confidence: reversalSignal.confidence + '%',
          exhaustionScore: reversalSignal.exhaustionScore,
          urgency: reversalSignal.urgency,
          description: reversalSignal.description,
          patterns: reversalSignal.patterns
            .filter(p => p.type.startsWith('reversal_'))
            .slice(0, 3)
            .map(p => p.name.replace(/_/g, ' ')),
        };
      }

      // Anti-greed status
      if (strategy.antiGreed.enabled) {
        result.antiGreed = {
          enabled: true,
          highWaterMark: positionState.highWaterMarkPnL.toFixed(2),
          currentPnl: positionState.unrealizedPnL.toFixed(2),
          drawdownFromHWM: positionState.drawdownFromHWMPercent.toFixed(1) + '%',
          threshold: strategy.antiGreed.drawdownThresholdPercent + '%',
          triggered: positionState.drawdownFromHWMPercent >= strategy.antiGreed.drawdownThresholdPercent
            && positionState.highWaterMarkPnL >= strategy.antiGreed.minHWMToTrack,
        };
      }
    } else {
      // No position - show position sizing recommendation
      result.noPosition = true;
      result.note = 'No open position. Use get_trading_recommendation to check if entry conditions are met.';

      // Get available margin for sizing calculation
      let availableMargin = 0;
      if (type === 'simulated') {
        const balance = await prisma.simulatedBalance.findUnique({
          where: { id: 'default' },
        });
        availableMargin = balance?.freeMargin || 20000;
      } else {
        try {
          const tbRes = await fetch(`${BASE_URL}/api/kraken/private/trade-balance`);
          if (tbRes.ok) {
            const tb = await tbRes.json();
            availableMargin = parseFloat(tb.mf) || 0;
          }
        } catch {
          availableMargin = 0;
        }
      }

      if (availableMargin > 0) {
        // Show what sizing would look like at different confidence levels
        const fullEntry = calculateEntrySize(80, currentPrice, availableMargin, strategy.positionSizing);
        const cautiousEntry = calculateEntrySize(70, currentPrice, availableMargin, strategy.positionSizing);

        result.sizing = {
          availableMargin: availableMargin.toFixed(2),
          fullEntry: {
            confidence: '80%+',
            marginToUse: fullEntry.marginToUse.toFixed(2),
            marginPercent: fullEntry.marginPercent.toFixed(1) + '%',
            positionValue: fullEntry.positionValue.toFixed(2),
            volume: fullEntry.volume.toFixed(2),
            dcaCapacity: fullEntry.remainingDCACapacity,
          },
          cautiousEntry: {
            confidence: '65-79%',
            marginToUse: cautiousEntry.marginToUse.toFixed(2),
            marginPercent: cautiousEntry.marginPercent.toFixed(1) + '%',
            positionValue: cautiousEntry.positionValue.toFixed(2),
            volume: cautiousEntry.volume.toFixed(2),
            dcaCapacity: cautiousEntry.remainingDCACapacity,
          },
        };
      }
    }

    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get v2 engine state: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
