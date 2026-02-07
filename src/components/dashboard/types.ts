import type { TradeDirection } from '@/lib/trading/v2-types';

/** Parameters for a quick market entry from the dashboard */
export interface QuickEntryParams {
  direction: TradeDirection;
  entryMode: 'full' | 'cautious';
  volume: number;
  marginToUse: number;
  marginPercent: number;
  leverage: number;
  confidence: number;
  /** If set, use limit order at this price instead of market */
  limitPrice?: number;
}

/** Parameters for closing (full or partial) a position */
export interface QuickCloseParams {
  exitPercent: number;       // 25/50/75/100
  volumeToClose: number;     // position.totalVolume * exitPercent/100
  isEngineRecommended: boolean;
}

/** Parameters for a DCA entry */
export interface QuickDCAParams {
  dcaLevel: number;
  direction: TradeDirection;
  volume: number;
  marginToUse: number;
  confidence: number;
}

/** Parameters for placing a trailing stop order */
export interface QuickTrailingStopParams {
  direction: TradeDirection;
  offset: number;
  offsetType: 'percent' | 'absolute';
  volume: number;
}

/** Parameters for placing a take-profit order */
export interface QuickTakeProfitParams {
  direction: TradeDirection;
  price: number;
  volume: number;
}

/** Union type for all action types used in the confirm modal */
export type QuickActionType = 'entry' | 'close' | 'dca' | 'trailing-stop' | 'take-profit';

/** Union of all action params */
export type QuickActionParams =
  | { type: 'entry'; params: QuickEntryParams }
  | { type: 'close'; params: QuickCloseParams }
  | { type: 'dca'; params: QuickDCAParams }
  | { type: 'trailing-stop'; params: QuickTrailingStopParams }
  | { type: 'take-profit'; params: QuickTakeProfitParams };
