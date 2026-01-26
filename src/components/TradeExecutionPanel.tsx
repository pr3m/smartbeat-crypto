'use client';

import { useState, useMemo, useEffect } from 'react';
import { Tooltip, HelpIcon } from './Tooltip';
import { ConfirmOrderModal } from './ConfirmOrderModal';
import { useToast } from './Toast';
import { useTradingData } from '@/components/TradingDataProvider';
import {
  generateOrderPreview,
  formatKrakenPrice,
  formatKrakenVolume,
  FEE_RATES,
  type OrderPreview,
} from '@/lib/trading/trade-calculations';

// Order type configuration
interface OrderTypeConfig {
  value: string;
  label: string;
  hasPrice: boolean;
  hasPrice2: boolean;
  priceLabel?: string;
  price2Label?: string;
  isOffset?: boolean;
  hasDisplayVol?: boolean;
}

// All 9 Kraken order types
const ORDER_TYPES: OrderTypeConfig[] = [
  { value: 'market', label: 'Market', hasPrice: false, hasPrice2: false },
  { value: 'limit', label: 'Limit', hasPrice: true, hasPrice2: false },
  { value: 'stop-loss', label: 'Stop Loss', hasPrice: true, hasPrice2: false, priceLabel: 'Trigger Price' },
  { value: 'stop-loss-limit', label: 'Stop Loss Limit', hasPrice: true, hasPrice2: true, priceLabel: 'Trigger Price', price2Label: 'Limit Price' },
  { value: 'take-profit', label: 'Take Profit', hasPrice: true, hasPrice2: false, priceLabel: 'Trigger Price' },
  { value: 'take-profit-limit', label: 'Take Profit Limit', hasPrice: true, hasPrice2: true, priceLabel: 'Trigger Price', price2Label: 'Limit Price' },
  { value: 'trailing-stop', label: 'Trailing Stop', hasPrice: true, hasPrice2: false, priceLabel: 'Offset', isOffset: true },
  { value: 'trailing-stop-limit', label: 'Trailing Stop Limit', hasPrice: true, hasPrice2: true, priceLabel: 'Offset', price2Label: 'Limit Offset', isOffset: true },
  { value: 'iceberg', label: 'Iceberg', hasPrice: true, hasPrice2: false, hasDisplayVol: true },
];

type OrderTypeValue = OrderTypeConfig['value'];

interface EntryConditionsSnapshot {
  timestamp: string;
  price: number;
  side: 'buy' | 'sell';
  orderType: string;
  volume: number;
  leverage: number;
}

export interface EditingOrderData {
  id: string;
  type: 'buy' | 'sell';
  orderType: string;
  price: number;
  volume: number;
  leverage: number;
}

interface TradeExecutionPanelProps {
  currentPrice: number;
  bestBid: number;
  bestAsk: number;
  testMode?: boolean;
  entryConditions?: EntryConditionsSnapshot | null;
  editingOrder?: EditingOrderData | null;
  onOrderExecuted?: () => void;
  onCancelEdit?: () => void;
}

export function TradeExecutionPanel({
  currentPrice,
  bestBid,
  bestAsk,
  testMode = false,
  entryConditions,
  editingOrder,
  onOrderExecuted,
  onCancelEdit,
}: TradeExecutionPanelProps) {
  const { addToast } = useToast();

  const {
    tradeBalance,
    tradeBalanceLoading,
    tradeBalanceError,
    refreshTradeBalance,
  } = useTradingData();

  // Order form state
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<OrderTypeValue>('limit');
  const [price, setPrice] = useState<string>('');
  const [price2, setPrice2] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [total, setTotal] = useState<string>('');
  const [displayVol, setDisplayVol] = useState<string>(''); // For iceberg orders
  const [useMargin, setUseMargin] = useState(true);
  // TODO: Allow user to select leverage from Kraken's available options for the pair
  // Kraken supports different leverage options per pair (2x, 3x, 5x, 10x etc.)
  const [leverage] = useState(10);

  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [timeInForce, setTimeInForce] = useState<'gtc' | 'ioc'>('gtc');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [validateOnly, setValidateOnly] = useState(false);

  // Trailing stop offset type
  const [offsetType, setOffsetType] = useState<'percent' | 'absolute'>('percent');

  // Modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Get order type config
  const orderTypeConfig = useMemo(
    () => ORDER_TYPES.find(t => t.value === orderType) || ORDER_TYPES[0],
    [orderType]
  );

  // Auto-fill price when side changes (for non-market orders)
  // BUY/LONG: use Bid (want to buy at best bid price)
  // SELL/SHORT: use Ask (want to sell at best ask price)
  useEffect(() => {
    if (orderType !== 'market' && !orderTypeConfig.isOffset) {
      // Auto-fill optimal price based on side
      if (side === 'buy' && bestBid > 0) {
        setPrice(bestBid.toFixed(5));
      } else if (side === 'sell' && bestAsk > 0) {
        setPrice(bestAsk.toFixed(5));
      }
    }
    // Only run when side changes, not on price/bid/ask updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, orderType]);

  // Populate form when editing an order
  useEffect(() => {
    if (editingOrder) {
      setSide(editingOrder.type);
      setOrderType(editingOrder.orderType);
      setPrice(editingOrder.price.toFixed(5));
      setAmount(editingOrder.volume.toString());
      // Calculate total
      const totalValue = editingOrder.price * editingOrder.volume;
      setTotal(totalValue.toFixed(2));
    }
  }, [editingOrder]);

  // Parse trade balance values
  const parsedBalance = useMemo(() => {
    if (!tradeBalance) return null;
    return {
      tradeBalance: parseFloat(tradeBalance.tb) || 0,
      equity: parseFloat(tradeBalance.e) || 0,
      marginUsed: parseFloat(tradeBalance.m) || 0,
      freeMargin: parseFloat(tradeBalance.mf) || 0,
      marginLevel: tradeBalance.ml ? parseFloat(tradeBalance.ml) : null,
      unrealizedPnL: parseFloat(tradeBalance.n) || 0,
    };
  }, [tradeBalance]);

  // Calculate effective price for order preview
  const effectivePrice = useMemo(() => {
    if (orderType === 'market') {
      return side === 'buy' ? bestAsk : bestBid;
    }
    return parseFloat(price) || 0;
  }, [orderType, side, price, bestAsk, bestBid]);

  // Generate order preview
  const orderPreview = useMemo((): OrderPreview | null => {
    const amountNum = parseFloat(amount) || 0;
    if (amountNum <= 0 || effectivePrice <= 0 || !parsedBalance) return null;

    return generateOrderPreview(
      side,
      amountNum,
      effectivePrice,
      useMargin ? leverage : 0,
      orderType === 'market' ? 'market' : 'limit',
      {
        equity: parsedBalance.equity,
        marginUsed: parsedBalance.marginUsed,
        freeMargin: parsedBalance.freeMargin,
      }
    );
  }, [side, amount, effectivePrice, useMargin, leverage, orderType, parsedBalance]);

  // Handle amount change - update total
  const handleAmountChange = (value: string) => {
    setAmount(value);
    const amountNum = parseFloat(value) || 0;
    if (amountNum > 0 && effectivePrice > 0) {
      setTotal((amountNum * effectivePrice).toFixed(2));
    } else {
      setTotal('');
    }
  };

  // Handle total change - update amount
  const handleTotalChange = (value: string) => {
    setTotal(value);
    const totalNum = parseFloat(value) || 0;
    if (totalNum > 0 && effectivePrice > 0) {
      setAmount((totalNum / effectivePrice).toFixed(4));
    } else {
      setAmount('');
    }
  };

  // Handle percentage slider
  const handlePercentage = (percent: number) => {
    if (!parsedBalance) return;

    const availableMargin = parsedBalance.freeMargin;
    const marginToUse = (availableMargin * percent) / 100;
    const positionSize = marginToUse * (useMargin ? leverage : 1);
    const amountXrp = effectivePrice > 0 ? positionSize / effectivePrice : 0;

    setAmount(amountXrp.toFixed(4));
    setTotal(positionSize.toFixed(2));
  };

  // Calculate current margin percent (derived from amount, not synced to state to avoid loops)
  const calculatedMarginPercent = useMemo(() => {
    if (!parsedBalance || !amount) return 0;
    const amountNum = parseFloat(amount) || 0;
    if (amountNum <= 0 || effectivePrice <= 0) return 0;
    const positionSize = amountNum * effectivePrice;
    const marginUsed = positionSize / (useMargin ? leverage : 1);
    const availableMargin = parsedBalance.freeMargin;
    const percent = availableMargin > 0 ? (marginUsed / availableMargin) * 100 : 0;
    return Math.min(100, Math.max(0, percent));
  }, [amount, effectivePrice, useMargin, leverage, parsedBalance]);

  // Set price to best bid/ask
  const setBestBidPrice = () => setPrice(bestBid.toFixed(5));
  const setBestAskPrice = () => setPrice(bestAsk.toFixed(5));

  // Submit order
  const handleSubmit = () => {
    if (!orderPreview) {
      addToast({
        title: 'Invalid Order',
        message: 'Please fill in all required fields',
        type: 'error',
      });
      return;
    }

    // Show confirmation modal
    setShowConfirmModal(true);
  };

  // Execute order
  const executeOrder = async () => {
    if (!orderPreview) return;

    // Test mode: use simulated API
    if (testMode) {
      const simulatedParams = {
        pair: 'XRPEUR',
        type: side,
        orderType: orderType === 'iceberg' ? 'limit' : orderType,
        price: orderType !== 'market' ? parseFloat(price) : undefined,
        volume: orderPreview.amount,
        leverage: useMargin ? leverage : 0,
        marketPrice: side === 'buy' ? bestAsk : bestBid,
        entryConditions: entryConditions || {
          timestamp: new Date().toISOString(),
          price: currentPrice,
          side,
          orderType,
          volume: orderPreview.amount,
          leverage: useMargin ? leverage : 0,
        },
      };

      const res = await fetch('/api/simulated/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simulatedParams),
      });

      const result = await res.json();

      if (!res.ok || result.error) {
        throw new Error(result.error || 'Test order failed');
      }

      // Success - test order
      addToast({
        title: 'Test Order Filled',
        message: result.message || `${side.toUpperCase()} ${orderPreview.amount} XRP @ €${simulatedParams.marketPrice.toFixed(4)}`,
        type: 'success',
        duration: 10000,
      });

      // Refresh balance and notify parent
      refreshTradeBalance(true);
      onOrderExecuted?.();

      // Reset form
      setAmount('');
      setTotal('');
      setPrice('');
      setPrice2('');
      setDisplayVol('');
      return;
    }

    // Live mode: use Kraken API
    // Build order params
    const params: Record<string, string | number | boolean | undefined> = {
      pair: 'XRPEUR',
      type: side,
      ordertype: orderType === 'iceberg' ? 'limit' : orderType,
      volume: formatKrakenVolume(orderPreview.amount),
    };

    // Add price based on order type
    if (orderTypeConfig.hasPrice && price) {
      if (orderTypeConfig.isOffset) {
        // Trailing stop offset
        params.price = offsetType === 'percent' ? `${price}%` : price;
      } else {
        params.price = formatKrakenPrice(parseFloat(price));
      }
    }

    if (orderTypeConfig.hasPrice2 && price2) {
      if (orderTypeConfig.isOffset) {
        params.price2 = offsetType === 'percent' ? `${price2}%` : price2;
      } else {
        params.price2 = formatKrakenPrice(parseFloat(price2));
      }
    }

    // Add leverage if using margin
    if (useMargin) {
      params.leverage = leverage.toString();
    }

    // Add display volume for iceberg
    if (orderType === 'iceberg' && displayVol) {
      params.displayvol = formatKrakenVolume(parseFloat(displayVol));
    }

    // Add order flags
    const oflags: string[] = [];
    if (postOnly && orderType !== 'market') oflags.push('post');
    if (oflags.length > 0) params.oflags = oflags.join(',');

    // Add validate only flag
    if (validateOnly) {
      params.validate = true;
    }

    // Submit to API
    const res = await fetch('/api/kraken/private/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const result = await res.json();

    if (!res.ok || result.error) {
      throw new Error(result.error || 'Order submission failed');
    }

    // Success
    addToast({
      title: validateOnly ? 'Order Validated' : 'Order Placed',
      message: validateOnly
        ? 'Order validation successful'
        : `${side.toUpperCase()} ${orderPreview.amount} XRP - Order ID: ${result.txid?.[0] || 'N/A'}`,
      type: 'success',
      duration: 10000,
    });

    // Refresh balance
    refreshTradeBalance(true);
    onOrderExecuted?.();

    // Reset form
    setAmount('');
    setTotal('');
    setPrice('');
    setPrice2('');
    setDisplayVol('');
  };

  const isBuy = side === 'buy';

  return (
    <div className="card p-4">
      {/* Editing Order Banner */}
      {editingOrder && (
        <div className="mb-4 p-3 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 text-sm font-semibold">Editing Order</span>
            <span className="text-xs text-blue-300">
              {editingOrder.type.toUpperCase()} {editingOrder.volume} XRP @ €{editingOrder.price.toFixed(4)}
            </span>
          </div>
          {onCancelEdit && (
            <button
              onClick={onCancelEdit}
              className="text-xs px-2 py-1 rounded bg-blue-500/30 text-blue-300 hover:bg-blue-500/40 transition-colors"
            >
              Cancel Edit
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs text-tertiary uppercase tracking-wider flex items-center gap-2">
          {editingOrder ? 'Modify Order' : 'Trade XRP/EUR'}
          <HelpIcon
            tooltip={
              <div>
                <strong>{editingOrder ? 'Modify Existing Order' : 'Trade Execution Panel'}</strong>
                {editingOrder ? (
                  <p className="mt-1">Change the order parameters. The old order will be cancelled and a new one placed.</p>
                ) : testMode ? (
                  <>
                    <p className="mt-1">Paper trading mode - orders are simulated, no real money.</p>
                    <p className="mt-2 text-orange-400">Test your strategies risk-free!</p>
                  </>
                ) : (
                  <>
                    <p className="mt-1">Place orders directly on Kraken with real-time margin calculations.</p>
                    <p className="mt-2 text-yellow-400">Uses your configured API keys.</p>
                  </>
                )}
              </div>
            }
            position="right"
          />
        </h3>
        <button
          onClick={() => refreshTradeBalance(true)}
          disabled={tradeBalanceLoading}
          className="text-xs text-tertiary hover:text-secondary transition-colors"
        >
          {tradeBalanceLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Account Info */}
      <div className="bg-tertiary rounded-lg p-3 mb-4">
        {tradeBalanceError ? (
          <div className="text-sm text-red-400">{tradeBalanceError}</div>
        ) : tradeBalanceLoading && !parsedBalance ? (
          <div className="text-sm text-secondary animate-pulse">Loading account data...</div>
        ) : parsedBalance ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-tertiary">Available to Trade</div>
              <div className="font-semibold mono text-green-400">
                {parsedBalance.freeMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary">Margin Level</div>
              <div className={`font-semibold mono ${
                parsedBalance.marginLevel === null ? 'text-secondary' :
                parsedBalance.marginLevel < 150 ? 'text-red-500' :
                parsedBalance.marginLevel < 200 ? 'text-yellow-500' :
                'text-green-500'
              }`}>
                {parsedBalance.marginLevel !== null
                  ? `${parsedBalance.marginLevel.toFixed(0)}%`
                  : 'No positions'
                }
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary">Equity</div>
              <div className="font-semibold mono">
                {parsedBalance.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary">Unrealized P&L</div>
              <div className={`font-semibold mono ${
                parsedBalance.unrealizedPnL > 0 ? 'text-green-500' :
                parsedBalance.unrealizedPnL < 0 ? 'text-red-500' :
                'text-secondary'
              }`}>
                {parsedBalance.unrealizedPnL >= 0 ? '+' : ''}{parsedBalance.unrealizedPnL.toFixed(2)} EUR
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Test/Live Mode Banner */}
      {testMode ? (
        <div className="mb-4 p-3 rounded-lg bg-orange-500/20 border-2 border-orange-500 animate-pulse-slow">
          <div className="flex items-center justify-center gap-2">
            <span className="w-3 h-3 bg-orange-500 rounded-full animate-pulse" />
            <span className="font-bold text-orange-400 uppercase tracking-wider">Paper Trading Mode</span>
            <span className="w-3 h-3 bg-orange-500 rounded-full animate-pulse" />
          </div>
          <p className="text-center text-xs text-orange-300/80 mt-1">Orders are simulated. No real money involved.</p>
        </div>
      ) : (
        <div className="mb-4 p-3 rounded-lg bg-red-500/20 border-2 border-red-500">
          <div className="flex items-center justify-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="font-bold text-red-400 uppercase tracking-wider">Live Trading</span>
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          </div>
          <p className="text-center text-xs text-red-300/80 mt-1">Real money orders. Exercise caution.</p>
        </div>
      )}

      {/* Buy/Sell Toggle with LONG/SHORT labels */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setSide('buy')}
          className={`py-3 rounded-lg font-semibold transition-colors ${
            isBuy
              ? 'bg-green-500 text-black'
              : 'bg-tertiary text-secondary hover:bg-green-500/20 hover:text-green-400'
          }`}
        >
          <div className="flex flex-col items-center">
            <span className="text-lg">LONG</span>
            <span className="text-xs opacity-70">(Buy)</span>
          </div>
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`py-3 rounded-lg font-semibold transition-colors ${
            !isBuy
              ? 'bg-red-500 text-white'
              : 'bg-tertiary text-secondary hover:bg-red-500/20 hover:text-red-400'
          }`}
        >
          <div className="flex flex-col items-center">
            <span className="text-lg">SHORT</span>
            <span className="text-xs opacity-70">(Sell)</span>
          </div>
        </button>
      </div>

      {/* Margin Toggle */}
      <div className="flex items-center justify-between mb-4 p-2 bg-tertiary rounded-lg">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUseMargin(!useMargin)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              useMargin ? 'bg-blue-500' : 'bg-gray-600'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              useMargin ? 'left-5' : 'left-0.5'
            }`} />
          </button>
          <span className="text-sm">Margin ({leverage}x)</span>
        </div>
        <Tooltip content="Trading with leverage allows larger positions with less capital, but increases risk. At 10x, you control 10 EUR worth of XRP for every 1 EUR margin." position="left">
          <span className="text-xs text-tertiary cursor-help">?</span>
        </Tooltip>
      </div>

      {/* Order Type */}
      <div className="mb-4">
        <label className="text-xs text-tertiary block mb-1">Order Type</label>
        <select
          value={orderType}
          onChange={(e) => setOrderType(e.target.value as OrderTypeValue)}
          className="input w-full"
        >
          {ORDER_TYPES.map(type => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      {/* Price Inputs */}
      {orderTypeConfig.hasPrice && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-tertiary">
              {orderTypeConfig.priceLabel || 'Price'} {orderTypeConfig.isOffset && `(${offsetType})`}
            </label>
            {!orderTypeConfig.isOffset && (
              <div className="flex gap-2">
                <button
                  onClick={setBestBidPrice}
                  className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors"
                >
                  Bid
                </button>
                <button
                  onClick={setBestAskPrice}
                  className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                >
                  Ask
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={orderTypeConfig.isOffset ? (offsetType === 'percent' ? '5' : '0.05') : bestBid.toFixed(5)}
              className="input flex-1"
            />
            {orderTypeConfig.isOffset && (
              <select
                value={offsetType}
                onChange={(e) => setOffsetType(e.target.value as 'percent' | 'absolute')}
                className="input w-20"
              >
                <option value="percent">%</option>
                <option value="absolute">EUR</option>
              </select>
            )}
          </div>
        </div>
      )}

      {orderTypeConfig.hasPrice2 && (
        <div className="mb-4">
          <label className="text-xs text-tertiary block mb-1">
            {orderTypeConfig.price2Label || 'Limit Price'}
          </label>
          <input
            type="text"
            value={price2}
            onChange={(e) => setPrice2(e.target.value)}
            placeholder={orderTypeConfig.isOffset ? '3' : bestBid.toFixed(5)}
            className="input w-full"
          />
        </div>
      )}

      {/* Display Volume for Iceberg */}
      {orderTypeConfig.hasDisplayVol && (
        <div className="mb-4">
          <label className="text-xs text-tertiary block mb-1">Visible Amount (XRP)</label>
          <input
            type="text"
            value={displayVol}
            onChange={(e) => setDisplayVol(e.target.value)}
            placeholder="500"
            className="input w-full"
          />
          <p className="text-xs text-tertiary mt-1">
            Amount visible in order book (rest hidden)
          </p>
        </div>
      )}

      {/* Amount Input */}
      <div className="mb-3">
        <label className="text-xs text-tertiary block mb-1">Amount (XRP)</label>
        <input
          type="text"
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          placeholder="1000"
          className="input w-full"
        />
      </div>

      {/* Total Input */}
      <div className="mb-3">
        <label className="text-xs text-tertiary block mb-1">Total (EUR)</label>
        <input
          type="text"
          value={total}
          onChange={(e) => handleTotalChange(e.target.value)}
          placeholder={effectivePrice > 0 ? (effectivePrice * 1000).toFixed(2) : '0.00'}
          className="input w-full"
        />
      </div>

      {/* Percentage Slider */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-tertiary mb-2">
          <span>Use available margin</span>
          <span className="font-semibold text-secondary">
            {calculatedMarginPercent.toFixed(0)}%
          </span>
        </div>
        {/* Range Slider */}
        <div className="relative">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={calculatedMarginPercent}
            onChange={(e) => handlePercentage(parseInt(e.target.value))}
            className="w-full h-2 bg-tertiary rounded-lg appearance-none cursor-pointer slider-thumb"
            style={{
              background: `linear-gradient(to right, ${isBuy ? '#22c55e' : '#ef4444'} 0%, ${isBuy ? '#22c55e' : '#ef4444'} ${calculatedMarginPercent}%, #374151 ${calculatedMarginPercent}%, #374151 100%)`,
            }}
          />
          {/* Tick marks */}
          <div className="flex justify-between mt-1 px-1">
            {[0, 25, 50, 75, 100].map(pct => (
              <button
                key={pct}
                onClick={() => handlePercentage(pct)}
                className={`text-xs transition-colors ${
                  Math.abs(calculatedMarginPercent - pct) < 3
                    ? isBuy ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'
                    : 'text-tertiary hover:text-secondary'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Margin Details */}
      {orderPreview && useMargin && (
        <div className="bg-tertiary rounded-lg p-3 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-secondary">Required Margin</span>
            <span className="mono font-semibold">{orderPreview.requiredMargin.toFixed(2)} EUR</span>
          </div>
          <div className="flex justify-between">
            <span className="text-secondary">Projected Margin Level</span>
            <span className={`mono font-semibold ${
              orderPreview.projectedMarginLevel < 150 ? 'text-red-500' :
              orderPreview.projectedMarginLevel < 200 ? 'text-yellow-500' :
              'text-green-500'
            }`}>
              {orderPreview.projectedMarginLevel === Infinity
                ? 'N/A'
                : `${orderPreview.projectedMarginLevel.toFixed(0)}%`
              }
            </span>
          </div>
          <div className="flex justify-between">
            <Tooltip content={`At ${leverage}x leverage, position liquidates ~${(100/leverage).toFixed(1)}% ${isBuy ? 'below' : 'above'} entry`} position="left">
              <span className="text-secondary border-b border-dashed border-current cursor-help">Liquidation Price</span>
            </Tooltip>
            <span className={`mono font-semibold ${isBuy ? 'text-red-400' : 'text-green-400'}`}>
              {orderPreview.liquidationPrice.toFixed(5)} EUR
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-tertiary">Est. Trading Fee ({orderType === 'market' ? 'Taker' : 'Maker'})</span>
            <span className="mono text-tertiary">
              {(orderType === 'market' ? FEE_RATES.taker : FEE_RATES.maker) * 100}% = {orderPreview.fees.tradingFee.toFixed(2)} EUR
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-tertiary">Est. Margin Fee / 4h</span>
            <span className="mono text-tertiary">{orderPreview.fees.rolloverPer4h.toFixed(2)} EUR</span>
          </div>
        </div>
      )}

      {/* Risk Warnings */}
      {orderPreview && orderPreview.risk.messages.length > 0 && (
        <div className={`rounded-lg p-3 mb-4 ${
          orderPreview.risk.isCritical
            ? 'bg-red-500/20 border border-red-500'
            : 'bg-yellow-500/20 border border-yellow-500'
        }`}>
          <ul className="space-y-1">
            {orderPreview.risk.messages.map((msg, i) => (
              <li key={i} className={`text-xs ${
                orderPreview.risk.isCritical ? 'text-red-400' : 'text-yellow-400'
              }`}>
                {msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Advanced Options */}
      <div className="mb-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-tertiary hover:text-secondary transition-colors"
        >
          <svg
            className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Advanced Options
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-3 p-3 bg-tertiary rounded-lg">
            {/* Post Only */}
            {orderType !== 'market' && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={postOnly}
                  onChange={(e) => setPostOnly(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Post Only (maker fee)</span>
              </label>
            )}

            {/* Time in Force */}
            <div>
              <span className="text-xs text-tertiary block mb-1">Time in Force</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setTimeInForce('gtc')}
                  className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                    timeInForce === 'gtc' ? 'bg-blue-500 text-white' : 'bg-primary text-secondary'
                  }`}
                >
                  GTC
                </button>
                <button
                  onClick={() => setTimeInForce('ioc')}
                  className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                    timeInForce === 'ioc' ? 'bg-blue-500 text-white' : 'bg-primary text-secondary'
                  }`}
                >
                  IOC
                </button>
              </div>
            </div>

            {/* Reduce Only */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={reduceOnly}
                onChange={(e) => setReduceOnly(e.target.checked)}
                className="w-4 h-4"
              />
              <span>Reduce Only</span>
            </label>

            {/* Validate Only (Test Mode) */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={validateOnly}
                onChange={(e) => setValidateOnly(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-yellow-400">Validate Only (Test)</span>
            </label>
          </div>
        )}
      </div>

      {/* Execute Button */}
      <button
        onClick={handleSubmit}
        disabled={!orderPreview || orderPreview.risk.isCritical}
        className={`w-full py-4 rounded-lg font-bold text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          testMode
            ? 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-black'
            : isBuy
            ? 'bg-green-500 hover:bg-green-400 text-black'
            : 'bg-red-500 hover:bg-red-400 text-white'
        }`}
      >
        <div className="flex flex-col items-center">
          <span>
            {testMode ? 'TEST ' : ''}{validateOnly ? 'Validate' : isBuy ? 'LONG' : 'SHORT'} XRP {useMargin ? `${leverage}x` : ''}
          </span>
          <span className="text-xs opacity-70">
            {validateOnly ? '(Dry Run)' : isBuy ? '(Buy Order)' : '(Sell Order)'}
          </span>
        </div>
      </button>

      {/* Current Price Reference */}
      <div className="mt-3 flex justify-between text-xs text-tertiary">
        <span>Bid: <span className="mono text-green-400">{bestBid.toFixed(5)}</span></span>
        <span>Ask: <span className="mono text-red-400">{bestAsk.toFixed(5)}</span></span>
      </div>

      {/* Confirmation Modal */}
      {orderPreview && (
        <ConfirmOrderModal
          isOpen={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
          onConfirm={executeOrder}
          preview={orderPreview}
          orderType={orderTypeConfig.label}
          validateOnly={validateOnly}
        />
      )}
    </div>
  );
}
