'use client';

import { useState, useCallback, useEffect } from 'react';
import type {
  QuickActionParams,
  QuickEntryParams,
  QuickCloseParams,
  QuickDCAParams,
  QuickTrailingStopParams,
  QuickTakeProfitParams,
} from './types';
import { estimateFees } from '@/lib/trading/trade-calculations';
import { useTradingData } from '@/components/TradingDataProvider';

interface QuickConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (modifiedAction: QuickActionParams) => Promise<void>;
  action: QuickActionParams;
  testMode: boolean;
  currentPrice: number;
}

export function QuickConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  action,
  testMode,
  currentPrice,
}: QuickConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveConfirmed, setLiveConfirmed] = useState(false);

  // Get available margin from context
  const { tradeBalance, simulatedBalance } = useTradingData();
  const availableMargin = testMode
    ? (simulatedBalance?.freeMargin ?? 0)
    : parseFloat(tradeBalance?.mf || '0');

  // Editable overrides for entry actions
  const [entryMarginPct, setEntryMarginPct] = useState(0);
  const [entryPrice, setEntryPrice] = useState(0);
  const [priceEdited, setPriceEdited] = useState(false);

  // Editable overrides for DCA actions
  const [dcaMarginEur, setDcaMarginEur] = useState(0);

  const entryMargin = availableMargin * (entryMarginPct / 100);

  // Reset editable state when modal opens — only on open transition, not on price ticks
  const [wasOpen, setWasOpen] = useState(false);
  useEffect(() => {
    if (isOpen && !wasOpen) {
      if (action.type === 'entry') {
        setEntryMarginPct(action.params.marginPercent);
        setEntryPrice(currentPrice);
        setPriceEdited(false);
      }
      if (action.type === 'dca') {
        setDcaMarginEur(action.params.marginToUse);
      }
    }
    setWasOpen(isOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Build the final action with any user edits applied
  const buildModifiedAction = useCallback((): QuickActionParams => {
    if (action.type === 'entry') {
      const effectivePrice = priceEdited ? entryPrice : currentPrice;
      const margin = availableMargin * (entryMarginPct / 100);
      const volume = effectivePrice > 0
        ? (margin * action.params.leverage) / effectivePrice
        : 0;
      return {
        type: 'entry',
        params: {
          ...action.params,
          marginToUse: margin,
          marginPercent: entryMarginPct,
          volume,
          limitPrice: priceEdited ? entryPrice : undefined,
        },
      };
    }
    if (action.type === 'dca') {
      const leverage = 10; // Same leverage as position
      const volume = currentPrice > 0 ? (dcaMarginEur * leverage) / currentPrice : 0;
      return {
        type: 'dca',
        params: {
          ...action.params,
          marginToUse: dcaMarginEur,
          volume,
        },
      };
    }
    return action;
  }, [action, availableMargin, entryMarginPct, entryPrice, priceEdited, currentPrice, dcaMarginEur]);

  const handleConfirm = useCallback(async () => {
    if (!testMode && !liveConfirmed) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(buildModifiedAction());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [onConfirm, onClose, testMode, liveConfirmed, buildModifiedAction]);

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setError(null);
      setLiveConfirmed(false);
      onClose();
    }
  }, [isSubmitting, onClose]);

  if (!isOpen) return null;

  const canConfirm = testMode || liveConfirmed;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-secondary border border-primary rounded-xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className={`px-5 py-3 flex items-center justify-between ${getHeaderStyle(action)}`}>
          <h2 className="text-base font-bold text-white">{getTitle(action)}</h2>
          <ModeBadge testMode={testMode} />
        </div>

        {/* Content */}
        <div className="p-5 space-y-3">
          <ActionDetails
            action={action}
            currentPrice={currentPrice}
            entryMarginPct={entryMarginPct}
            entryMarginEur={entryMargin}
            availableMargin={availableMargin}
            entryPrice={entryPrice}
            priceEdited={priceEdited}
            onEntryMarginPctChange={setEntryMarginPct}
            onEntryPriceChange={(price) => { setEntryPrice(price); setPriceEdited(true); }}
            onResetPrice={() => { setEntryPrice(currentPrice); setPriceEdited(false); }}
            dcaMarginEur={dcaMarginEur}
            onDcaMarginEurChange={setDcaMarginEur}
          />

          {/* Live mode extra confirmation */}
          {!testMode && (
            <label className="flex items-center gap-3 p-3 rounded-lg border-2 border-red-500/50 bg-red-500/10 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={liveConfirmed}
                onChange={(e) => setLiveConfirmed(e.target.checked)}
                className="w-4 h-4 accent-red-500"
              />
              <span className="text-sm text-red-400 font-semibold">
                I confirm this is a real order
              </span>
            </label>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 border border-red-500">
              <div className="flex items-center gap-2 text-red-400 text-sm font-semibold">
                <span>Order Failed</span>
              </div>
              <p className="text-sm text-red-300 mt-1">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-3 bg-tertiary border-t border-primary flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 btn btn-secondary py-2.5 font-semibold text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || !canConfirm}
            className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${getConfirmStyle(action)}`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Executing...
              </span>
            ) : (
              getConfirmLabel(action)
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function ModeBadge({ testMode }: { testMode: boolean }) {
  if (testMode) {
    return (
      <span className="text-xs font-bold px-2 py-0.5 rounded bg-orange-500 text-black">
        PAPER
      </span>
    );
  }
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-500 text-white animate-pulse">
      LIVE
    </span>
  );
}

function getHeaderStyle(action: QuickActionParams): string {
  switch (action.type) {
    case 'entry':
      return action.params.direction === 'long' ? 'bg-green-600' : 'bg-red-600';
    case 'close':
      return 'bg-gray-600';
    case 'dca':
      return 'bg-blue-600';
    case 'trailing-stop':
      return 'bg-purple-600';
    case 'take-profit':
      return 'bg-emerald-600';
  }
}

function getTitle(action: QuickActionParams): string {
  switch (action.type) {
    case 'entry': {
      const dir = action.params.direction === 'long' ? 'LONG' : 'SHORT';
      const mode = action.params.entryMode === 'full' ? 'Full' : 'Cautious';
      return `${mode} ${dir} Entry`;
    }
    case 'close':
      return `Close ${action.params.exitPercent}% Position`;
    case 'dca':
      return `DCA Level ${action.params.dcaLevel}`;
    case 'trailing-stop':
      return 'Set Trailing Stop';
    case 'take-profit':
      return 'Set Take Profit';
  }
}

function getConfirmLabel(action: QuickActionParams): string {
  switch (action.type) {
    case 'entry': {
      const dir = action.params.direction === 'long' ? 'LONG' : 'SHORT';
      return `Confirm ${dir}`;
    }
    case 'close':
      return `Close ${action.params.exitPercent}%`;
    case 'dca':
      return 'Confirm DCA';
    case 'trailing-stop':
      return 'Place Stop';
    case 'take-profit':
      return 'Place TP';
  }
}

function getConfirmStyle(action: QuickActionParams): string {
  switch (action.type) {
    case 'entry':
      return action.params.direction === 'long'
        ? 'bg-green-500 hover:bg-green-400 text-black'
        : 'bg-red-500 hover:bg-red-400 text-white';
    case 'close':
      return 'bg-gray-500 hover:bg-gray-400 text-white';
    case 'dca':
      return 'bg-blue-500 hover:bg-blue-400 text-white';
    case 'trailing-stop':
      return 'bg-purple-500 hover:bg-purple-400 text-white';
    case 'take-profit':
      return 'bg-emerald-500 hover:bg-emerald-400 text-black';
  }
}

// ============================================================================
// ACTION DETAILS
// ============================================================================

function ActionDetails({
  action,
  currentPrice,
  entryMarginPct,
  entryMarginEur,
  availableMargin,
  entryPrice,
  priceEdited,
  onEntryMarginPctChange,
  onEntryPriceChange,
  onResetPrice,
  dcaMarginEur,
  onDcaMarginEurChange,
}: {
  action: QuickActionParams;
  currentPrice: number;
  entryMarginPct: number;
  entryMarginEur: number;
  availableMargin: number;
  entryPrice: number;
  priceEdited: boolean;
  onEntryMarginPctChange: (v: number) => void;
  onEntryPriceChange: (v: number) => void;
  onResetPrice: () => void;
  dcaMarginEur: number;
  onDcaMarginEurChange: (v: number) => void;
}) {
  switch (action.type) {
    case 'entry':
      return (
        <EntryDetails
          params={action.params}
          currentPrice={currentPrice}
          marginPct={entryMarginPct}
          marginEur={entryMarginEur}
          availableMargin={availableMargin}
          editPrice={entryPrice}
          priceEdited={priceEdited}
          onMarginPctChange={onEntryMarginPctChange}
          onPriceChange={onEntryPriceChange}
          onResetPrice={onResetPrice}
        />
      );
    case 'close':
      return <CloseDetails params={action.params} currentPrice={currentPrice} />;
    case 'dca':
      return (
        <DCADetails
          params={action.params}
          currentPrice={currentPrice}
          availableMargin={availableMargin}
          dcaMarginEur={dcaMarginEur}
          onDcaMarginEurChange={onDcaMarginEurChange}
        />
      );
    case 'trailing-stop':
      return <TrailingStopDetails params={action.params} currentPrice={currentPrice} />;
    case 'take-profit':
      return <TakeProfitDetails params={action.params} currentPrice={currentPrice} />;
  }
}

function EntryDetails({
  params,
  currentPrice,
  marginPct,
  marginEur,
  availableMargin,
  editPrice,
  priceEdited,
  onMarginPctChange,
  onPriceChange,
  onResetPrice,
}: {
  params: QuickEntryParams;
  currentPrice: number;
  marginPct: number;
  marginEur: number;
  availableMargin: number;
  editPrice: number;
  priceEdited: boolean;
  onMarginPctChange: (v: number) => void;
  onPriceChange: (v: number) => void;
  onResetPrice: () => void;
}) {
  const effectivePrice = priceEdited ? editPrice : currentPrice;
  const volume = effectivePrice > 0 ? (marginEur * params.leverage) / effectivePrice : 0;
  const positionValue = volume * effectivePrice;
  const orderType = priceEdited ? 'limit' : 'market';
  const fees = estimateFees(positionValue, orderType, params.leverage);
  const isLong = params.direction === 'long';
  const accentColor = isLong ? '#22c55e' : '#ef4444';

  return (
    <div className="space-y-2">
      <div className="bg-tertiary rounded-lg p-3 space-y-2 text-sm">
        <Row label="Direction" value={isLong ? 'LONG (Buy)' : 'SHORT (Sell)'}
          valueClass={isLong ? 'text-green-400' : 'text-red-400'} />
        <Row label="Entry Mode" value={params.entryMode === 'full' ? 'Full Entry' : 'Cautious Entry'} />
        <Row label="Leverage" value={`${params.leverage}x`} />
        <Row label="Confidence" value={`${params.confidence}%`} />
      </div>

      {/* Margin slider */}
      <div className="bg-tertiary rounded-lg p-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-secondary">Use available margin</span>
          <span className="font-semibold mono" style={{ color: accentColor }}>
            {marginPct.toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={marginPct}
          onChange={(e) => onMarginPctChange(parseInt(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
          style={{
            background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${marginPct}%, #374151 ${marginPct}%, #374151 100%)`,
          }}
        />
        <div className="flex justify-between mt-0.5 px-0.5">
          {[0, 25, 50, 75, 100].map(pct => (
            <button
              key={pct}
              onClick={() => onMarginPctChange(pct)}
              className={`text-xs transition-colors ${
                Math.abs(marginPct - pct) < 3
                  ? 'font-semibold'
                  : 'text-tertiary hover:text-secondary'
              }`}
              style={Math.abs(marginPct - pct) < 3 ? { color: accentColor } : undefined}
            >
              {pct}%
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs pt-1 border-t border-primary/50">
          <span className="text-tertiary">Margin</span>
          <span className="mono font-semibold">{marginEur.toFixed(2)} EUR</span>
        </div>
      </div>

      <div className="bg-tertiary rounded-lg p-3 space-y-2 text-sm">
        {/* Editable price */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-secondary">{priceEdited ? 'Limit Price' : 'Market Price'}</span>
            {priceEdited && (
              <button
                onClick={onResetPrice}
                className="text-[10px] text-blue-400 hover:text-blue-300 underline"
              >
                market
              </button>
            )}
          </div>
          <input
            type="number"
            value={editPrice || ''}
            onChange={(e) => onPriceChange(Math.max(0, parseFloat(e.target.value) || 0))}
            className="w-28 text-right text-sm font-semibold mono bg-primary border border-primary rounded px-2 py-0.5 focus:outline-none focus:border-blue-500"
            step="0.0001"
            min="0"
          />
        </div>

        {priceEdited && (
          <div className="text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded">
            Limit order @ {editPrice.toFixed(4)} EUR
          </div>
        )}

        <Row label="Volume" value={`${volume.toFixed(1)} XRP`} mono />
        <Row label="Position Value" value={`${positionValue.toFixed(2)} EUR`} mono />
        <Row label="Est. Fee" value={`${fees.total.toFixed(2)} EUR`} mono />
        <Row label="Rollover/4h" value={`${fees.rolloverPer4h.toFixed(2)} EUR`} mono />
      </div>
    </div>
  );
}

function CloseDetails({
  params,
  currentPrice,
}: {
  params: QuickCloseParams;
  currentPrice: number;
}) {
  const closeValue = params.volumeToClose * currentPrice;
  const fees = estimateFees(closeValue, 'market', 10);

  return (
    <div className="space-y-2">
      <div className="bg-tertiary rounded-lg p-3 space-y-2 text-sm">
        <Row label="Exit %" value={`${params.exitPercent}%`} />
        <Row label="Volume" value={`${params.volumeToClose.toFixed(1)} XRP`} mono />
        <Row label="Close Value" value={`${closeValue.toFixed(2)} EUR`} mono />
        <Row label="Est. Fee" value={`${fees.tradingFee.toFixed(2)} EUR`} mono />
      </div>
      {params.isEngineRecommended && (
        <div className="flex items-center gap-2 text-xs text-orange-400 bg-orange-500/10 px-3 py-2 rounded-lg">
          <span className="flex-shrink-0">!</span>
          <span>Engine recommends closing this position</span>
        </div>
      )}
    </div>
  );
}

function DCADetails({
  params,
  currentPrice,
  availableMargin,
  dcaMarginEur,
  onDcaMarginEurChange,
}: {
  params: QuickDCAParams;
  currentPrice: number;
  availableMargin: number;
  dcaMarginEur: number;
  onDcaMarginEurChange: (v: number) => void;
}) {
  const leverage = 10;
  const dcaVolume = currentPrice > 0 ? (dcaMarginEur * leverage) / currentPrice : 0;
  const positionValue = dcaVolume * currentPrice;
  const fees = estimateFees(positionValue, 'market', leverage);
  const isLong = params.direction === 'long';
  const accentColor = '#3b82f6'; // blue for DCA
  const marginPct = availableMargin > 0 ? (dcaMarginEur / availableMargin) * 100 : 0;

  // Live new-average calculation
  const currentAvgPrice = params.currentAvgPrice || 0;
  const currentVolume = params.currentVolume || 0;
  const totalCost = (currentAvgPrice * currentVolume) + (currentPrice * dcaVolume);
  const totalVolume = currentVolume + dcaVolume;
  const newAvgPrice = totalVolume > 0 ? totalCost / totalVolume : currentAvgPrice;
  const avgImprovement = currentAvgPrice > 0
    ? ((currentAvgPrice - newAvgPrice) / currentAvgPrice) * 100
    : 0;
  // For longs: lower avg = better. For shorts: higher avg = better.
  const isBetterAvg = isLong ? newAvgPrice < currentAvgPrice : newAvgPrice > currentAvgPrice;

  return (
    <div className="space-y-2">
      <div className="bg-tertiary rounded-lg p-3 space-y-2 text-sm">
        <Row label="DCA Level" value={`${params.dcaLevel}`} />
        <Row label="Direction" value={isLong ? 'LONG (Buy)' : 'SHORT (Sell)'}
          valueClass={isLong ? 'text-green-400' : 'text-red-400'} />
        <Row label="Confidence" value={`${params.confidence}%`} />
      </div>

      {/* Average price preview */}
      {currentAvgPrice > 0 && (
        <div className="bg-tertiary rounded-lg p-3 space-y-2 text-sm">
          <Row label="Current Avg" value={`${currentAvgPrice.toFixed(4)} EUR`} mono />
          <Row label="Market Price" value={`${currentPrice.toFixed(4)} EUR`} mono />
          {dcaVolume > 0 && (
            <>
              <div className="border-t border-primary/50 pt-2">
                <div className="flex justify-between">
                  <span className="text-secondary">New Avg</span>
                  <span className={`font-semibold mono ${isBetterAvg ? 'text-blue-400' : 'text-orange-400'}`}>
                    {newAvgPrice.toFixed(4)} EUR
                  </span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">Improvement</span>
                <span className={`font-semibold mono text-xs ${isBetterAvg ? 'text-blue-400' : 'text-orange-400'}`}>
                  {isBetterAvg ? '' : '+'}{avgImprovement.toFixed(2)}%
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Margin slider */}
      <div className="bg-tertiary rounded-lg p-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-secondary">Use available margin</span>
          <span className="font-semibold mono" style={{ color: accentColor }}>
            {marginPct.toFixed(0)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max={availableMargin}
          step={Math.max(1, Math.round(availableMargin / 100))}
          value={dcaMarginEur}
          onChange={(e) => onDcaMarginEurChange(parseFloat(e.target.value))}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer slider-thumb"
          style={{
            background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${marginPct}%, #374151 ${marginPct}%, #374151 100%)`,
          }}
        />
        <div className="flex justify-between mt-0.5 px-0.5">
          {[0, 25, 50, 75, 100].map(pct => {
            const eurValue = availableMargin * (pct / 100);
            const isActive = Math.abs(marginPct - pct) < 3;
            return (
              <button
                key={pct}
                onClick={() => onDcaMarginEurChange(eurValue)}
                className={`text-xs transition-colors ${
                  isActive
                    ? 'font-semibold'
                    : 'text-tertiary hover:text-secondary'
                }`}
                style={isActive ? { color: accentColor } : undefined}
              >
                {pct}%
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-xs pt-1 border-t border-primary/50">
          <span className="text-tertiary">Margin</span>
          <span className="mono font-semibold">{dcaMarginEur.toFixed(2)} EUR</span>
        </div>
      </div>

      <div className="bg-tertiary rounded-lg p-3 space-y-2 text-sm">
        <Row label="DCA Volume" value={`${dcaVolume.toFixed(1)} XRP`} mono />
        <Row label="Total Volume" value={`${totalVolume.toFixed(1)} XRP`} mono />
        <Row label="Position Value" value={`${positionValue.toFixed(2)} EUR`} mono />
        <Row label="Est. Fee" value={`${fees.total.toFixed(2)} EUR`} mono />
      </div>
    </div>
  );
}

function TrailingStopDetails({
  params,
  currentPrice,
}: {
  params: QuickTrailingStopParams;
  currentPrice: number;
}) {
  const triggerDesc = params.offsetType === 'percent'
    ? `${params.offset}% from peak`
    : `${params.offset.toFixed(4)} EUR from peak`;

  return (
    <div className="space-y-2">
      <div className="bg-tertiary rounded-lg p-3 space-y-2 text-sm">
        <Row label="Direction" value={params.direction === 'long' ? 'LONG position' : 'SHORT position'} />
        <Row label="Offset" value={triggerDesc} />
        <Row label="Volume" value={`${params.volume.toFixed(1)} XRP`} mono />
        <Row label="Current Price" value={`${currentPrice.toFixed(4)} EUR`} mono />
      </div>
      <div className="text-xs text-secondary bg-tertiary/50 rounded-lg p-3">
        {params.direction === 'long'
          ? 'Trailing stop will follow the price up. If price drops by the offset from its peak, a market sell is triggered to close your long.'
          : 'Trailing stop will follow the price down. If price rises by the offset from its low, a market buy is triggered to close your short.'}
      </div>
    </div>
  );
}

function TakeProfitDetails({
  params,
  currentPrice,
}: {
  params: QuickTakeProfitParams;
  currentPrice: number;
}) {
  const distPercent = currentPrice > 0
    ? (Math.abs(params.price - currentPrice) / currentPrice * 100)
    : 0;

  return (
    <div className="bg-tertiary rounded-lg p-3 space-y-2 text-sm">
      <Row label="Direction" value={params.direction === 'long' ? 'LONG position' : 'SHORT position'} />
      <Row label="Target Price" value={`${params.price.toFixed(4)} EUR`} mono />
      <Row label="Current Price" value={`${currentPrice.toFixed(4)} EUR`} mono />
      <Row label="Distance" value={`${distPercent.toFixed(1)}%`} />
      <Row label="Volume" value={`${params.volume.toFixed(1)} XRP`} mono />
    </div>
  );
}

// ============================================================================
// ROW COMPONENT
// ============================================================================

function Row({
  label,
  value,
  mono = false,
  valueClass,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-secondary">{label}</span>
      <span className={`font-semibold ${mono ? 'mono' : ''} ${valueClass || ''}`}>{value}</span>
    </div>
  );
}
