/**
 * Kraken API Type Definitions
 */

// Base API Response
export interface KrakenResponse<T> {
  error: string[];
  result?: T;
}

// Public API Types

export interface TickerInfo {
  a: [string, string, string]; // Ask [price, whole lot volume, lot volume]
  b: [string, string, string]; // Bid
  c: [string, string]; // Last trade [price, lot volume]
  v: [string, string]; // Volume [today, 24h]
  p: [string, string]; // VWAP
  t: [number, number]; // Number of trades
  l: [string, string]; // Low
  h: [string, string]; // High
  o: string; // Open
}

export interface OHLCData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  volume: number;
  count: number;
}

export interface AssetPairInfo {
  altname: string;
  wsname: string;
  aclass_base: string;
  base: string;
  aclass_quote: string;
  quote: string;
  lot: string;
  pair_decimals: number;
  lot_decimals: number;
  lot_multiplier: number;
  leverage_buy: number[];
  leverage_sell: number[];
  fees: [number, number][];
  fees_maker: [number, number][];
  fee_volume_currency: string;
  margin_call: number;
  margin_stop: number;
  ordermin: string;
}

// Private API Types

export interface Balance {
  [asset: string]: string;
}

export interface TradeBalance {
  eb: string; // Equivalent balance
  tb: string; // Trade balance
  m: string; // Margin amount
  n: string; // Unrealized net P&L
  c: string; // Cost basis of open positions
  v: string; // Current floating valuation
  e: string; // Equity = trade balance + unrealized P&L
  mf: string; // Free margin
  ml?: string; // Margin level
}

export interface OrderInfo {
  refid?: string;
  userref?: number;
  status: 'pending' | 'open' | 'closed' | 'canceled' | 'expired';
  opentm: number;
  starttm: number;
  expiretm: number;
  descr: {
    pair: string;
    type: 'buy' | 'sell';
    ordertype: string;
    price: string;
    price2: string;
    leverage: string;
    order: string;
    close?: string;
  };
  vol: string;
  vol_exec: string;
  cost: string;
  fee: string;
  price: string;
  stopprice?: string;
  limitprice?: string;
  misc: string;
  oflags: string;
  trades?: string[];
  closetm?: number;
  reason?: string;
}

export interface OpenOrders {
  open: {
    [orderId: string]: OrderInfo;
  };
}

export interface ClosedOrders {
  closed: {
    [orderId: string]: OrderInfo;
  };
  count: number;
}

export interface PositionInfo {
  ordertxid: string;
  posstatus: string;
  pair: string;
  time: number;
  type: 'buy' | 'sell';
  ordertype: string;
  cost: string;
  fee: string;
  vol: string;
  vol_closed: string;
  margin: string;
  value: string;
  net: string;
  terms: string;
  rollovertm: string;
  misc: string;
  oflags: string;
  leverage?: string; // Leverage multiplier (e.g., "10" for 10x)
}

export interface OpenPositions {
  [positionId: string]: PositionInfo;
}

export interface TradeInfo {
  ordertxid: string;
  postxid: string;
  pair: string;
  time: number;
  type: 'buy' | 'sell';
  ordertype: string;
  price: string;
  cost: string;
  fee: string;
  vol: string;
  margin: string;
  misc: string;
  posstatus?: string;
  cprice?: string;
  ccost?: string;
  cfee?: string;
  cvol?: string;
  cmargin?: string;
  net?: string;
  trades?: string[];
}

export interface TradesHistory {
  trades: {
    [tradeId: string]: TradeInfo;
  };
  count: number;
}

export interface LedgerEntry {
  refid: string;
  time: number;
  // Kraken ledger types - includes all known types
  type: 'trade' | 'deposit' | 'withdrawal' | 'transfer' | 'margin' | 'rollover' |
        'spend' | 'receive' | 'settled' | 'adjustment' | 'staking' | 'dividend' |
        'earn' | 'creator' | 'nfttrade' | 'credit' | 'reward' | string; // Allow unknown types
  subtype: string;
  aclass: string;
  asset: string;
  amount: string;
  fee: string;
  balance: string;
}

export interface Ledgers {
  ledger: {
    [ledgerId: string]: LedgerEntry;
  };
  count: number;
}

// Order Types
export type OrderType =
  | 'market'
  | 'limit'
  | 'stop-loss'
  | 'take-profit'
  | 'stop-loss-limit'
  | 'take-profit-limit'
  | 'trailing-stop'
  | 'trailing-stop-limit'
  | 'settle-position';

export interface AddOrderParams {
  pair: string;
  type: 'buy' | 'sell';
  ordertype: OrderType;
  price?: string;
  price2?: string;
  volume: string;
  displayvol?: string; // For iceberg orders - visible amount in order book
  leverage?: string;
  oflags?: string; // e.g., 'fcib' (fee in quote currency), 'fciq' (fee in base currency), 'post' (post-only)
  starttm?: string;
  expiretm?: string;
  userref?: number;
  validate?: boolean;
  close?: {
    ordertype: OrderType;
    price?: string;
    price2?: string;
  };
}

export interface AddOrderResult {
  descr: {
    order: string;
    close?: string;
  };
  txid: string[];
}

export interface CancelOrderResult {
  count: number;
  pending?: boolean;
}

// Export data types
export interface ExportRequest {
  report: 'trades' | 'ledgers';
  format?: 'CSV' | 'TSV';
  description?: string;
  fields?: string;
  starttm?: number;
  endtm?: number;
}

export interface ExportStatusResult {
  id: string;
  descr: string;
  format: string;
  report: string;
  subtype: string;
  status: string;
  flags: string;
  fields: string;
  createdtm: string;
  expiretm: string;
  starttm: string;
  completedtm: string;
  datastarttm: string;
  dataendtm: string;
  aclass: string;
  asset: string;
}

// Transaction Categories (for tax purposes)
export type TransactionType =
  | 'TRADE'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER'
  | 'MARGIN_TRADE'
  | 'MARGIN_SETTLEMENT'
  | 'ROLLOVER'
  | 'STAKING_REWARD'
  | 'STAKING_DEPOSIT'
  | 'STAKING_WITHDRAWAL'
  | 'EARN_REWARD'     // Kraken Earn rewards (interest on balances)
  | 'EARN_ALLOCATION' // Kraken Earn allocation/lock
  | 'CREDIT'          // Credits/bonuses from Kraken
  | 'AIRDROP'
  | 'FORK'
  | 'FEE'
  | 'ADJUSTMENT'
  | 'NFT_TRADE'       // NFT transactions
  | 'SPEND'           // Spending crypto
  | 'RECEIVE';        // Receiving crypto

export type TransactionCategory =
  | 'TAXABLE_INCOME'
  | 'NON_TAXABLE'
  | 'FEE'
  | 'COST_BASIS_ADJUSTMENT';

export type CostBasisMethod = 'FIFO' | 'WEIGHTED_AVERAGE';

// Processed transaction for our system
export interface ProcessedTransaction {
  id: string;
  krakenRefId?: string;
  krakenOrderId?: string;
  type: TransactionType;
  category: TransactionCategory;
  asset: string;
  amount: number;
  pair?: string;
  side?: 'buy' | 'sell';
  price?: number;
  cost?: number;
  fee?: number;
  feeAsset?: string;
  leverage?: string;
  margin?: number;
  costBasis?: number;
  proceeds?: number;
  gain?: number;
  timestamp: Date;
  notes?: string;
}

// Indicator types (from trading dashboard)
export interface Indicators {
  rsi: number;
  macd: number;
  macdSignal?: number;
  histogram?: number;
  bbPos: number;
  bbUpper?: number;
  bbLower?: number;
  atr: number;
  volRatio: number;
  score: number;
  bias: 'bullish' | 'bearish' | 'neutral';
  trendStrength: 'strong' | 'moderate' | 'weak';
}

export interface TimeframeData {
  ohlc: OHLCData[];
  indicators: Indicators | null;
}

export interface ChecklistItem {
  pass: boolean;
  value: string;
}

// Individual direction recommendation with weighted strength
export interface DirectionRecommendation {
  strength: number; // 0-100 weighted strength score
  confidence: number; // 0-100 confidence in the setup
  grade: 'A' | 'B' | 'C' | 'D' | 'F'; // Letter grade based on strength
  reasons: string[]; // Contributing factors
  warnings: string[]; // Risk factors and cautions
  checklist: {
    trend1d?: ChecklistItem; // Daily trend filter
    trend4h: ChecklistItem;
    setup1h: ChecklistItem;
    entry15m: ChecklistItem;
    volume: ChecklistItem;
    btcAlign: ChecklistItem;
    macdMomentum: ChecklistItem;
    flowConfirm?: ChecklistItem;
    liqBias?: ChecklistItem;
  };
  passedCount: number;
  totalCount: number;
}

export interface TradingRecommendation {
  action: 'LONG' | 'SHORT' | 'WAIT' | 'SPIKE ↑' | 'SPIKE ↓';
  confidence: number;
  baseConfidence: number; // Confidence before microstructure adjustments
  reason: string;
  longScore: number;
  shortScore: number;
  totalItems: number; // Total checklist items (7 base + extras)
  // NEW: Separate recommendations for each direction
  long: DirectionRecommendation;
  short: DirectionRecommendation;
  // Warnings for sudden moves/liquidation risks
  warnings: string[];
  // Momentum indicator for sudden move opportunities
  momentumAlert?: {
    direction: 'up' | 'down';
    strength: 'strong' | 'moderate';
    reason: string;
  };
  checklist: {
    trend1d?: ChecklistItem; // Daily trend filter (NEW)
    trend4h: ChecklistItem;
    setup1h: ChecklistItem;
    entry15m: ChecklistItem;
    volume: ChecklistItem;
    btcAlign: ChecklistItem;
    macdMomentum: ChecklistItem; // MACD histogram momentum (replaces rsiExtreme)
    flowConfirm?: ChecklistItem; // Option B: Flow confirmation
    liqBias?: ChecklistItem; // Liquidation bias alignment
  };
  // Option A: Flow analysis
  flowStatus?: {
    status: 'aligned' | 'neutral' | 'opposing';
    imbalance: number;
    cvdTrend: 'rising' | 'falling' | 'neutral';
    hasDivergence: boolean;
    divergenceType?: 'bullish' | 'bearish';
    spreadStatus: 'normal' | 'wide';
    whaleActivity?: 'buying' | 'selling' | 'none';
    adjustments: {
      flowAligned: number;
      whaleActivity: number;
      divergence: number;
      spreadWide: number;
      flowOpposing: number;
      total: number;
    };
  };
  // Liquidation analysis
  liquidationStatus?: {
    bias: 'long_squeeze' | 'short_squeeze' | 'neutral';
    biasStrength: number;
    fundingRate: number | null;
    nearestTarget: number | null;
    aligned: boolean;
    adjustments: {
      liqAligned: number;
      fundingConfirm: number;
      total: number;
    };
  };
}

// Microstructure data for recommendation engine
export interface MicrostructureInput {
  imbalance: number; // -1 to 1
  cvd: number;
  cvdHistory: Array<{ time: number; value: number; price: number }>;
  spreadPercent: number;
  avgSpreadPercent: number;
  recentLargeBuys: number;
  recentLargeSells: number;
}

// Aggregated microstructure snapshot (1-minute periods)
export interface MicrostructureSnapshot {
  timestamp: number; // Start of the period
  // Order book aggregates
  avgImbalance: number; // Average imbalance over period
  endImbalance: number; // Imbalance at end of period
  maxImbalance: number; // Peak imbalance (absolute)
  // CVD
  cvdStart: number;
  cvdEnd: number;
  cvdDelta: number; // Change over period
  cvdTrend: 'rising' | 'falling' | 'neutral';
  // Trade flow
  buyVolume: number; // EUR volume of buys
  sellVolume: number; // EUR volume of sells
  buyCount: number;
  sellCount: number;
  // Spread
  avgSpreadPercent: number;
  maxSpreadPercent: number;
  // Large orders
  largeBuys: number;
  largeSells: number;
  // Price
  openPrice: number;
  closePrice: number;
  highPrice: number;
  lowPrice: number;
}

// Aggregated microstructure for recommendation (uses snapshot history)
export interface AggregatedMicrostructure {
  // Current period (building)
  current: MicrostructureSnapshot | null;
  // Completed periods (last N minutes)
  history: MicrostructureSnapshot[];
  // Derived signals from history
  signals: {
    imbalanceTrend: 'bullish' | 'bearish' | 'neutral'; // 3-period trend
    cvdMomentum: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
    flowDominance: 'buyers' | 'sellers' | 'balanced';
    spreadCondition: 'tight' | 'normal' | 'wide';
    whaleActivity: 'accumulating' | 'distributing' | 'none';
  };
  // Summary for recommendation
  summary: MicrostructureInput;
}

// WebSocket v2 Types for Market Microstructure

export interface WSv2BookLevel {
  price: number;
  qty: number;
}

export interface WSv2Trade {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  ord_type: string;
  trade_id: number;
  timestamp: string;
}

export interface OrderBookData {
  bids: WSv2BookLevel[];
  asks: WSv2BookLevel[];
  imbalance: number; // -1 to 1, positive = bid heavy
  spread: number;
  spreadPercent: number;
  midPrice: number;
  timestamp: number;
}

export interface TradeEntry {
  id: number;
  price: number;
  qty: number;
  side: 'buy' | 'sell';
  ordType: string;
  timestamp: number;
  isLarge: boolean;
  eurValue: number;
}

export interface MicrostructureConfig {
  largeOrderThreshold: number; // EUR value to consider "large"
  bookDepthLevels: number; // number of levels to display
  tradeHistoryLimit: number; // max trades to keep
  imbalanceThreshold: number; // percentage for alerts (0-1)
}

// Liquidation analysis input for recommendation engine
export interface LiquidationInput {
  bias: 'long_squeeze' | 'short_squeeze' | 'neutral';
  biasStrength: number; // 0-1
  nearestUpside: number | null; // Nearest short liquidation (price target going up)
  nearestDownside: number | null; // Nearest long liquidation (price target going down)
  fundingRate: number | null; // Positive = longs pay shorts (crowded long)
  openInterest: number | null;
  marketBias?: {
    direction: 'bullish' | 'bearish' | 'neutral';
    strength: number;
  };
}
