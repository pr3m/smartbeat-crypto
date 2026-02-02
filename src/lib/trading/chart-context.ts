/**
 * Chart Context Analysis
 *
 * Extracts meaningful price structure data from OHLC candles
 * for AI analysis. Provides the "visual" context that allows
 * the AI to understand charts like a human trader would.
 */

import type { OHLCData } from '@/lib/kraken/types';

export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  strength: number; // 1-3, how many candles on each side confirm it
  timestamp: number;
}

export interface CandlePattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  index: number;
  significance: 'major' | 'minor';
}

export interface TrendStructure {
  direction: 'uptrend' | 'downtrend' | 'sideways';
  strength: 'strong' | 'moderate' | 'weak';
  higherHighs: number;
  higherLows: number;
  lowerHighs: number;
  lowerLows: number;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
}

export interface PriceLevel {
  price: number;
  type: 'support' | 'resistance';
  touches: number;
  strength: 'strong' | 'moderate' | 'weak';
  source: string; // e.g., "swing_low", "consolidation", "round_number"
}

export interface CompactCandle {
  t: number;      // timestamp
  o: number;      // open
  h: number;      // high
  l: number;      // low
  c: number;      // close
  v: number;      // volume
  d: 'U' | 'D';   // direction (Up/Down)
  b: number;      // body size as % of range
  w: number;      // upper wick as % of range
  s: number;      // lower wick (shadow) as % of range
}

export interface TimeframeChartContext {
  label: string;
  interval: number;
  candleCount: number;

  // Price summary
  currentPrice: number;
  rangeHigh: number;
  rangeLow: number;
  rangePercent: number;

  // Trend structure
  trend: TrendStructure;

  // Key levels
  keyLevels: PriceLevel[];

  // Swing points (last 5)
  recentSwings: SwingPoint[];

  // Candlestick patterns detected
  patterns: CandlePattern[];

  // Recent candles in compact format (last 20)
  recentCandles: CompactCandle[];

  // Price action summary
  priceActionSummary: string;
}

export interface ChartContext {
  timestamp: string;
  pair: string;
  timeframes: Record<string, TimeframeChartContext>;

  // Multi-timeframe analysis
  mtfAlignment: 'aligned_bullish' | 'aligned_bearish' | 'mixed' | 'neutral';
  mtfSummary: string;

  // Key price levels across all timeframes
  confluentLevels: PriceLevel[];
}

/**
 * Identify swing highs and lows in price data
 */
export function findSwingPoints(ohlc: OHLCData[], lookback: number = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = lookback; i < ohlc.length - lookback; i++) {
    const current = ohlc[i];

    // Check for swing high
    let isSwingHigh = true;
    let highStrength = 0;
    for (let j = 1; j <= lookback; j++) {
      if (ohlc[i - j].high >= current.high || ohlc[i + j].high >= current.high) {
        isSwingHigh = false;
        break;
      }
      highStrength++;
    }

    if (isSwingHigh) {
      swings.push({
        index: i,
        price: current.high,
        type: 'high',
        strength: Math.min(3, highStrength),
        timestamp: current.time,
      });
    }

    // Check for swing low
    let isSwingLow = true;
    let lowStrength = 0;
    for (let j = 1; j <= lookback; j++) {
      if (ohlc[i - j].low <= current.low || ohlc[i + j].low <= current.low) {
        isSwingLow = false;
        break;
      }
      lowStrength++;
    }

    if (isSwingLow) {
      swings.push({
        index: i,
        price: current.low,
        type: 'low',
        strength: Math.min(3, lowStrength),
        timestamp: current.time,
      });
    }
  }

  return swings.sort((a, b) => a.index - b.index);
}

/**
 * Analyze trend structure from swing points
 */
function analyzeTrendStructure(swings: SwingPoint[], currentPrice: number): TrendStructure {
  const recentSwings = swings.slice(-10);

  let higherHighs = 0;
  let higherLows = 0;
  let lowerHighs = 0;
  let lowerLows = 0;

  const highs = recentSwings.filter(s => s.type === 'high');
  const lows = recentSwings.filter(s => s.type === 'low');

  // Count higher highs / lower highs
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price > highs[i - 1].price) higherHighs++;
    else if (highs[i].price < highs[i - 1].price) lowerHighs++;
  }

  // Count higher lows / lower lows
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price > lows[i - 1].price) higherLows++;
    else if (lows[i].price < lows[i - 1].price) lowerLows++;
  }

  // Determine trend direction
  let direction: TrendStructure['direction'];
  let strength: TrendStructure['strength'];

  const bullishScore = higherHighs + higherLows;
  const bearishScore = lowerHighs + lowerLows;

  if (bullishScore > bearishScore + 1) {
    direction = 'uptrend';
    strength = bullishScore >= 4 ? 'strong' : bullishScore >= 2 ? 'moderate' : 'weak';
  } else if (bearishScore > bullishScore + 1) {
    direction = 'downtrend';
    strength = bearishScore >= 4 ? 'strong' : bearishScore >= 2 ? 'moderate' : 'weak';
  } else {
    direction = 'sideways';
    strength = 'weak';
  }

  return {
    direction,
    strength,
    higherHighs,
    higherLows,
    lowerHighs,
    lowerLows,
    lastSwingHigh: highs.length > 0 ? highs[highs.length - 1].price : null,
    lastSwingLow: lows.length > 0 ? lows[lows.length - 1].price : null,
  };
}

/**
 * Identify key support/resistance levels
 */
function findKeyLevels(ohlc: OHLCData[], swings: SwingPoint[]): PriceLevel[] {
  const levels: PriceLevel[] = [];
  const tolerance = 0.002; // 0.2% tolerance for level clustering

  // Extract swing point prices
  const swingPrices = swings.map(s => ({ price: s.price, type: s.type }));

  // Cluster similar price levels
  const clusters: { price: number; type: 'support' | 'resistance'; touches: number; source: string }[] = [];

  for (const sp of swingPrices) {
    const existing = clusters.find(c =>
      Math.abs(c.price - sp.price) / sp.price < tolerance &&
      c.type === (sp.type === 'low' ? 'support' : 'resistance')
    );

    if (existing) {
      existing.touches++;
      existing.price = (existing.price + sp.price) / 2; // Average the level
    } else {
      clusters.push({
        price: sp.price,
        type: sp.type === 'low' ? 'support' : 'resistance',
        touches: 1,
        source: 'swing_' + sp.type,
      });
    }
  }

  // Add round number levels
  const currentPrice = ohlc[ohlc.length - 1].close;
  const roundBase = currentPrice > 10 ? 1 : currentPrice > 1 ? 0.1 : 0.01;
  const nearestRound = Math.round(currentPrice / roundBase) * roundBase;

  for (let i = -3; i <= 3; i++) {
    const roundLevel = nearestRound + (i * roundBase);
    if (roundLevel > 0) {
      clusters.push({
        price: roundLevel,
        type: roundLevel > currentPrice ? 'resistance' : 'support',
        touches: 1,
        source: 'round_number',
      });
    }
  }

  // Convert to PriceLevel with strength
  for (const cluster of clusters) {
    levels.push({
      price: cluster.price,
      type: cluster.type,
      touches: cluster.touches,
      strength: cluster.touches >= 3 ? 'strong' : cluster.touches >= 2 ? 'moderate' : 'weak',
      source: cluster.source,
    });
  }

  // Sort by proximity to current price and return top levels
  return levels
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 8);
}

/**
 * Detect common candlestick patterns
 */
function detectCandlePatterns(ohlc: OHLCData[]): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  const recent = ohlc.slice(-10);

  for (let i = 1; i < recent.length; i++) {
    const curr = recent[i];
    const prev = recent[i - 1];
    const idx = ohlc.length - (recent.length - i);

    const currBody = Math.abs(curr.close - curr.open);
    const currRange = curr.high - curr.low;
    const currBodyRatio = currRange > 0 ? currBody / currRange : 0;
    const currIsBullish = curr.close > curr.open;

    const prevBody = Math.abs(prev.close - prev.open);
    const prevRange = prev.high - prev.low;
    const prevIsBullish = prev.close > prev.open;

    // Doji (small body, large wicks)
    if (currBodyRatio < 0.1 && currRange > 0) {
      patterns.push({
        name: 'Doji',
        type: 'neutral',
        index: idx,
        significance: 'minor',
      });
    }

    // Hammer (bullish reversal at lows)
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    if (lowerWick > currBody * 2 && upperWick < currBody * 0.5 && currRange > 0) {
      patterns.push({
        name: 'Hammer',
        type: 'bullish',
        index: idx,
        significance: 'minor',
      });
    }

    // Shooting Star (bearish reversal at highs)
    if (upperWick > currBody * 2 && lowerWick < currBody * 0.5 && currRange > 0) {
      patterns.push({
        name: 'Shooting Star',
        type: 'bearish',
        index: idx,
        significance: 'minor',
      });
    }

    // Bullish Engulfing
    if (currIsBullish && !prevIsBullish &&
        curr.open < prev.close && curr.close > prev.open &&
        currBody > prevBody * 1.2) {
      patterns.push({
        name: 'Bullish Engulfing',
        type: 'bullish',
        index: idx,
        significance: 'major',
      });
    }

    // Bearish Engulfing
    if (!currIsBullish && prevIsBullish &&
        curr.open > prev.close && curr.close < prev.open &&
        currBody > prevBody * 1.2) {
      patterns.push({
        name: 'Bearish Engulfing',
        type: 'bearish',
        index: idx,
        significance: 'major',
      });
    }

    // Morning Star (3-candle bullish reversal)
    if (i >= 2) {
      const prevPrev = recent[i - 2];
      const prevPrevIsBullish = prevPrev.close > prevPrev.open;
      const prevPrevBody = Math.abs(prevPrev.close - prevPrev.open);

      if (!prevPrevIsBullish && prevPrevBody > prevBody * 2 &&
          currIsBullish && currBody > prevBody * 2 &&
          curr.close > (prevPrev.open + prevPrev.close) / 2) {
        patterns.push({
          name: 'Morning Star',
          type: 'bullish',
          index: idx,
          significance: 'major',
        });
      }
    }

    // Evening Star (3-candle bearish reversal)
    if (i >= 2) {
      const prevPrev = recent[i - 2];
      const prevPrevIsBullish = prevPrev.close > prevPrev.open;
      const prevPrevBody = Math.abs(prevPrev.close - prevPrev.open);

      if (prevPrevIsBullish && prevPrevBody > prevBody * 2 &&
          !currIsBullish && currBody > prevBody * 2 &&
          curr.close < (prevPrev.open + prevPrev.close) / 2) {
        patterns.push({
          name: 'Evening Star',
          type: 'bearish',
          index: idx,
          significance: 'major',
        });
      }
    }
  }

  return patterns;
}

/**
 * Convert candles to compact format for token efficiency
 */
function compactCandles(ohlc: OHLCData[], count: number = 20): CompactCandle[] {
  const recent = ohlc.slice(-count);

  return recent.map(candle => {
    const range = candle.high - candle.low;
    const body = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;

    return {
      t: candle.time,
      o: Number(candle.open.toFixed(5)),
      h: Number(candle.high.toFixed(5)),
      l: Number(candle.low.toFixed(5)),
      c: Number(candle.close.toFixed(5)),
      v: Math.round(candle.volume),
      d: candle.close >= candle.open ? 'U' : 'D',
      b: range > 0 ? Math.round((body / range) * 100) : 0,
      w: range > 0 ? Math.round((upperWick / range) * 100) : 0,
      s: range > 0 ? Math.round((lowerWick / range) * 100) : 0,
    };
  });
}

/**
 * Generate a text summary of price action
 */
function generatePriceActionSummary(
  ohlc: OHLCData[],
  trend: TrendStructure,
  patterns: CandlePattern[],
  interval: number
): string {
  const recent = ohlc.slice(-5);
  const last = recent[recent.length - 1];
  const first = recent[0];

  const change = ((last.close - first.close) / first.close) * 100;
  const avgVolume = ohlc.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
  const recentVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
  const volumeRatio = avgVolume > 0 ? recentVolume / avgVolume : 1;

  const tfLabel = interval >= 60 ? `${interval / 60}H` : `${interval}m`;

  let summary = `${tfLabel}: ${trend.direction} (${trend.strength})`;
  summary += `, ${change >= 0 ? '+' : ''}${change.toFixed(2)}% last 5 candles`;
  summary += `, vol ${volumeRatio.toFixed(1)}x avg`;

  if (patterns.length > 0) {
    const majorPatterns = patterns.filter(p => p.significance === 'major');
    if (majorPatterns.length > 0) {
      summary += `. Patterns: ${majorPatterns.map(p => p.name).join(', ')}`;
    }
  }

  return summary;
}

/**
 * Analyze a single timeframe
 */
export function analyzeTimeframe(
  ohlc: OHLCData[],
  interval: number,
  label: string
): TimeframeChartContext | null {
  if (!ohlc || ohlc.length < 20) {
    return null;
  }

  const currentPrice = ohlc[ohlc.length - 1].close;
  const prices = ohlc.map(c => c.close);
  const highs = ohlc.map(c => c.high);
  const lows = ohlc.map(c => c.low);

  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const rangePercent = rangeLow > 0 ? ((rangeHigh - rangeLow) / rangeLow) * 100 : 0;

  // Find swing points
  const swings = findSwingPoints(ohlc, 2);

  // Analyze trend
  const trend = analyzeTrendStructure(swings, currentPrice);

  // Find key levels
  const keyLevels = findKeyLevels(ohlc, swings);

  // Detect patterns
  const patterns = detectCandlePatterns(ohlc);

  // Get compact candles
  const recentCandles = compactCandles(ohlc, 20);

  // Generate summary
  const priceActionSummary = generatePriceActionSummary(ohlc, trend, patterns, interval);

  return {
    label,
    interval,
    candleCount: ohlc.length,
    currentPrice,
    rangeHigh,
    rangeLow,
    rangePercent,
    trend,
    keyLevels,
    recentSwings: swings.slice(-5),
    patterns,
    recentCandles,
    priceActionSummary,
  };
}

/**
 * Build complete chart context from all timeframes
 */
export function buildChartContext(
  timeframeData: Record<number, OHLCData[]>,
  pair: string
): ChartContext {
  const timeframes: Record<string, TimeframeChartContext> = {};
  const tfLabels: Record<number, string> = {
    5: '5m',
    15: '15m',
    60: '1H',
    240: '4H',
  };

  // Analyze each timeframe
  for (const [interval, ohlc] of Object.entries(timeframeData)) {
    const intervalNum = parseInt(interval);
    const label = tfLabels[intervalNum] || `${interval}m`;
    const context = analyzeTimeframe(ohlc, intervalNum, label);
    if (context) {
      timeframes[label] = context;
    }
  }

  // Determine multi-timeframe alignment
  const trends = Object.values(timeframes).map(tf => tf.trend.direction);
  const bullishCount = trends.filter(t => t === 'uptrend').length;
  const bearishCount = trends.filter(t => t === 'downtrend').length;

  let mtfAlignment: ChartContext['mtfAlignment'];
  if (bullishCount >= 3) {
    mtfAlignment = 'aligned_bullish';
  } else if (bearishCount >= 3) {
    mtfAlignment = 'aligned_bearish';
  } else if (bullishCount === bearishCount || (bullishCount < 2 && bearishCount < 2)) {
    mtfAlignment = 'neutral';
  } else {
    mtfAlignment = 'mixed';
  }

  // Generate MTF summary
  const tfSummaries = Object.entries(timeframes)
    .sort(([, a], [, b]) => b.interval - a.interval)
    .map(([, tf]) => tf.priceActionSummary);
  const mtfSummary = tfSummaries.join(' | ');

  // Find confluent levels (levels that appear in multiple timeframes)
  const allLevels: PriceLevel[] = [];
  for (const tf of Object.values(timeframes)) {
    allLevels.push(...tf.keyLevels);
  }

  // Cluster similar levels
  const confluentLevels: PriceLevel[] = [];
  const tolerance = 0.003; // 0.3%

  for (const level of allLevels) {
    const existing = confluentLevels.find(l =>
      Math.abs(l.price - level.price) / level.price < tolerance
    );

    if (existing) {
      existing.touches += level.touches;
      if (level.strength === 'strong') existing.strength = 'strong';
    } else {
      confluentLevels.push({ ...level });
    }
  }

  // Only keep levels with multiple timeframe confluence
  const currentPrice = timeframes['5m']?.currentPrice || timeframes['15m']?.currentPrice || 0;
  const strongConfluentLevels = confluentLevels
    .filter(l => l.touches >= 2)
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 6);

  return {
    timestamp: new Date().toISOString(),
    pair,
    timeframes,
    mtfAlignment,
    mtfSummary,
    confluentLevels: strongConfluentLevels,
  };
}

/**
 * Format chart context for AI prompt (token-efficient)
 */
export function formatChartContextForAI(context: ChartContext): string {
  const sections: string[] = [];

  // Header
  sections.push(`## Chart Analysis (${context.pair})`);
  sections.push(`MTF Alignment: ${context.mtfAlignment.toUpperCase()}`);
  sections.push('');

  // Per-timeframe analysis
  for (const [label, tf] of Object.entries(context.timeframes).sort(
    ([, a], [, b]) => b.interval - a.interval
  )) {
    sections.push(`### ${label} Timeframe`);
    sections.push(`Trend: ${tf.trend.direction} (${tf.trend.strength})`);
    sections.push(`Structure: HH=${tf.trend.higherHighs} HL=${tf.trend.higherLows} LH=${tf.trend.lowerHighs} LL=${tf.trend.lowerLows}`);

    if (tf.trend.lastSwingHigh && tf.trend.lastSwingLow) {
      sections.push(`Last Swing High: ${tf.trend.lastSwingHigh.toFixed(5)}, Last Swing Low: ${tf.trend.lastSwingLow.toFixed(5)}`);
    }

    // Key levels
    const resistance = tf.keyLevels.filter(l => l.type === 'resistance').slice(0, 3);
    const support = tf.keyLevels.filter(l => l.type === 'support').slice(0, 3);

    if (resistance.length > 0) {
      sections.push(`Resistance: ${resistance.map(l => `${l.price.toFixed(5)}(${l.strength[0]})`).join(', ')}`);
    }
    if (support.length > 0) {
      sections.push(`Support: ${support.map(l => `${l.price.toFixed(5)}(${l.strength[0]})`).join(', ')}`);
    }

    // Patterns
    if (tf.patterns.length > 0) {
      const majorPatterns = tf.patterns.filter(p => p.significance === 'major');
      if (majorPatterns.length > 0) {
        sections.push(`Patterns: ${majorPatterns.map(p => `${p.name}(${p.type[0]})`).join(', ')}`);
      }
    }

    // Recent candles (compact format)
    sections.push(`Recent ${tf.recentCandles.length} candles (t,o,h,l,c,dir,body%,wick%,shadow%):`);
    const candleLines = tf.recentCandles.map(c =>
      `${new Date(c.t * 1000).toISOString().slice(11, 16)}|${c.o}|${c.h}|${c.l}|${c.c}|${c.d}|${c.b}|${c.w}|${c.s}`
    );
    sections.push(candleLines.join('\n'));
    sections.push('');
  }

  // Confluent levels
  if (context.confluentLevels.length > 0) {
    sections.push('### Multi-TF Confluent Levels');
    for (const level of context.confluentLevels) {
      sections.push(`${level.type.toUpperCase()}: ${level.price.toFixed(5)} (${level.strength}, ${level.touches} touches)`);
    }
    sections.push('');
  }

  // Summary
  sections.push('### Summary');
  sections.push(context.mtfSummary);

  return sections.join('\n');
}
