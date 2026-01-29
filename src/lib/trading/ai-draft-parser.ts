/**
 * AI Draft Parser
 *
 * Parses AI conditionalSetups into draft orders that users can review and submit.
 * Creates entry order, stop-loss, and take-profit orders from each setup.
 */

import type { ConditionalSetup } from '@/lib/ai/schemas/market-analysis';

export interface DraftOrderInput {
  pair: string;
  side: 'buy' | 'sell';
  orderType: string;
  price?: number;
  price2?: number;
  volume: number;
  displayVolume?: number;
  leverage: number;
  trailingOffset?: number;
  trailingOffsetType?: 'percent' | 'absolute';
  source: 'manual' | 'ai';
  aiSetupType?: string;
  aiAnalysisId?: string;
  activationCriteria?: string[];
  invalidation?: string[];
  positionSizePct?: number;
}

interface ParseOptions {
  aiAnalysisId?: string;
  availableMargin: number;
  currentPrice: number;
  leverage?: number;
  pair?: string;
}

/**
 * Parse setup type to determine side
 * SHORT_ -> sell, LONG_ -> buy
 */
function parseSide(setupType: string): 'buy' | 'sell' {
  const upper = setupType.toUpperCase();
  if (upper.startsWith('SHORT') || upper.includes('_SHORT')) {
    return 'sell';
  }
  return 'buy';
}

/**
 * Parse a string price to number
 */
function parsePrice(priceStr: string): number {
  const cleaned = priceStr.replace(/[^\d.]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Calculate volume from position size percentage and available margin
 */
function calculateVolume(
  positionSizePct: number,
  availableMargin: number,
  leverage: number,
  entryPrice: number
): number {
  if (entryPrice <= 0) return 0;
  const marginToUse = (availableMargin * positionSizePct) / 100;
  const positionValue = marginToUse * leverage;
  return positionValue / entryPrice;
}

/**
 * Parse a single conditional setup into draft orders
 * Returns array of draft orders: [entry, stopLoss, ...takeProfit]
 */
export function parseConditionalSetup(
  setup: ConditionalSetup,
  options: ParseOptions
): DraftOrderInput[] {
  const {
    aiAnalysisId,
    availableMargin,
    currentPrice,
    leverage = 10,
    pair = 'XRPEUR',
  } = options;

  const drafts: DraftOrderInput[] = [];
  const side = parseSide(setup.type);

  // Parse entry zone - use midpoint
  const entryLow = parsePrice(setup.entryZone[0]);
  const entryHigh = parsePrice(setup.entryZone[1]);
  const entryPrice = (entryLow + entryHigh) / 2;

  if (entryPrice <= 0) {
    console.warn('Invalid entry price for setup:', setup.type);
    return drafts;
  }

  // Calculate volume
  const positionSizePct = setup.positionSizePct || 1;
  const volume = calculateVolume(positionSizePct, availableMargin, leverage, entryPrice);

  if (volume <= 0) {
    console.warn('Calculated volume is 0 for setup:', setup.type);
    return drafts;
  }

  // 1. Entry Order (limit at entry price)
  drafts.push({
    pair,
    side,
    orderType: 'limit',
    price: entryPrice,
    volume,
    leverage,
    source: 'ai',
    aiSetupType: setup.type,
    aiAnalysisId,
    activationCriteria: setup.activationCriteria,
    invalidation: setup.invalidation,
    positionSizePct,
  });

  // 2. Stop Loss Order
  const stopLossPrice = parsePrice(setup.stopLoss);
  if (stopLossPrice > 0) {
    // Stop loss is opposite side: if entry is buy, stop is sell and vice versa
    const stopSide = side === 'buy' ? 'sell' : 'buy';
    drafts.push({
      pair,
      side: stopSide,
      orderType: 'stop-loss',
      price: stopLossPrice,
      volume,
      leverage,
      source: 'ai',
      aiSetupType: `${setup.type}_SL`,
      aiAnalysisId,
    });
  }

  // 3. Take Profit Orders (one per target, scaled by probability)
  if (setup.targets && setup.targets.length > 0) {
    let remainingVolume = volume;
    const targetSide = side === 'buy' ? 'sell' : 'buy';

    for (let i = 0; i < setup.targets.length; i++) {
      const target = setup.targets[i];
      const targetPrice = parsePrice(target.price);

      if (targetPrice <= 0) continue;

      // Scale volume by probability, ensuring at least some volume for each target
      // Last target gets all remaining volume
      let targetVolume: number;
      if (i === setup.targets.length - 1) {
        targetVolume = remainingVolume;
      } else {
        // Proportional allocation based on probability
        const probability = target.probability || 50;
        targetVolume = Math.max(volume * 0.1, volume * (probability / 100) * 0.5);
        targetVolume = Math.min(targetVolume, remainingVolume * 0.8); // Keep some for later targets
        remainingVolume -= targetVolume;
      }

      drafts.push({
        pair,
        side: targetSide,
        orderType: 'take-profit',
        price: targetPrice,
        volume: targetVolume,
        leverage,
        source: 'ai',
        aiSetupType: `${setup.type}_TP${i + 1}`,
        aiAnalysisId,
      });
    }
  }

  return drafts;
}

/**
 * Parse all conditional setups from AI analysis into draft orders
 */
export function parseAllConditionalSetups(
  setups: ConditionalSetup[],
  options: ParseOptions
): DraftOrderInput[] {
  const allDrafts: DraftOrderInput[] = [];

  for (const setup of setups) {
    const setupDrafts = parseConditionalSetup(setup, options);
    allDrafts.push(...setupDrafts);
  }

  return allDrafts;
}

/**
 * Format draft order for display
 */
export function formatDraftForDisplay(draft: DraftOrderInput): string {
  const direction = draft.side === 'buy' ? 'LONG' : 'SHORT';
  const orderType = draft.orderType.toUpperCase().replace(/-/g, ' ');
  const price = draft.price ? `@ ${draft.price.toFixed(5)}` : '';

  return `${direction} ${orderType} ${draft.volume.toFixed(2)} XRP ${price} (${draft.leverage}x)`;
}
