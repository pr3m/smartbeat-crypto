/**
 * Trading Session Helper
 * Determines current trading session based on UTC time
 */

export interface TradingSession {
  phase: string;
  marketHours: string;
  description: string;
  isWeekend: boolean;
}

/**
 * Get the current trading session based on UTC time
 * Sessions are based on major market open hours:
 * - Asia: 00:00-07:00 UTC (Tokyo, Hong Kong, Singapore)
 * - Europe: 07:00-16:00 UTC (London, Frankfurt)
 * - US: 13:00-21:00 UTC (New York)
 * - Overlaps occur when multiple major markets are open
 */
export function getTradingSession(timestamp?: Date): TradingSession {
  const now = timestamp || new Date();
  const utcHour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 6 = Saturday

  // Check if it's weekend
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Determine session phase based on UTC hour
  let phase: string;
  let marketHours: string;
  let description: string;

  if (utcHour >= 0 && utcHour < 7) {
    // Asia session: 00:00-07:00 UTC
    phase = 'asia';
    marketHours = '00:00-07:00 UTC';
    description = 'Asia session - Lower volume, choppy price action typical';
  } else if (utcHour >= 7 && utcHour < 13) {
    // Europe session (before US opens): 07:00-13:00 UTC
    phase = 'europe';
    marketHours = '07:00-13:00 UTC';
    description = 'Europe session - Moderate volume, trend development';
  } else if (utcHour >= 13 && utcHour < 16) {
    // Europe-US overlap: 13:00-16:00 UTC
    phase = 'overlap_europe_us';
    marketHours = '13:00-16:00 UTC';
    description = 'Europe-US overlap - Highest liquidity and volatility window';
  } else if (utcHour >= 16 && utcHour < 21) {
    // US session (after Europe closes): 16:00-21:00 UTC
    phase = 'us';
    marketHours = '16:00-21:00 UTC';
    description = 'US session - High volume, strong directional moves';
  } else {
    // Late US / early Asia transition: 21:00-00:00 UTC
    phase = 'transition';
    marketHours = '21:00-00:00 UTC';
    description = 'Transition period - Lower volume, range-bound typical';
  }

  // Modify description for weekend
  if (isWeekend) {
    description = `Weekend ${phase} hours - Significantly lower volume, potential for gaps`;
  }

  return {
    phase,
    marketHours,
    description,
    isWeekend,
  };
}
