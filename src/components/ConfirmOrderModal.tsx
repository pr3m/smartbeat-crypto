'use client';

import { useState } from 'react';
import type { OrderPreview } from '@/lib/trading/trade-calculations';

interface ConfirmOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  preview: OrderPreview;
  orderType: string;
  validateOnly?: boolean;
}

export function ConfirmOrderModal({
  isOpen,
  onClose,
  onConfirm,
  preview,
  orderType,
  validateOnly = false,
}: ConfirmOrderModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBuy = preview.side === 'buy';
  const sideLabel = isBuy ? 'LONG' : 'SHORT';
  const sideOrderLabel = isBuy ? '(Buy)' : '(Sell)';
  const sideColor = isBuy ? 'text-green-500' : 'text-red-500';
  const sideBg = isBuy ? 'bg-green-500' : 'bg-red-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-secondary border border-primary rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className={`${sideBg} px-6 py-4`}>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            {isBuy ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            )}
            {validateOnly ? 'Validate Order' : 'Confirm Order'}
          </h2>
          <p className="text-white/80 text-sm mt-1">
            {sideLabel} {sideOrderLabel} {preview.amount.toLocaleString()} XRP @ {orderType.toUpperCase()}
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Order Summary */}
          <div className="bg-tertiary rounded-lg p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Side</span>
              <span className={`font-semibold ${sideColor}`}>{sideLabel} {sideOrderLabel}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Amount</span>
              <span className="font-semibold mono">{preview.amount.toLocaleString()} XRP</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Price</span>
              <span className="font-semibold mono">{preview.price.toFixed(5)} EUR</span>
            </div>
            <div className="flex justify-between text-sm border-t border-primary pt-3">
              <span className="text-secondary">Total</span>
              <span className="font-bold mono">{preview.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR</span>
            </div>
          </div>

          {/* Leverage & Margin */}
          <div className="bg-tertiary rounded-lg p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Leverage</span>
              <span className="font-semibold">{preview.leverage}x</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Required Margin</span>
              <span className="font-semibold mono">{preview.requiredMargin.toFixed(2)} EUR</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Projected Margin Level</span>
              <span className={`font-semibold ${
                preview.projectedMarginLevel < 150 ? 'text-red-500' :
                preview.projectedMarginLevel < 200 ? 'text-yellow-500' :
                'text-green-500'
              }`}>
                {preview.projectedMarginLevel === Infinity ? 'N/A' : `${preview.projectedMarginLevel.toFixed(0)}%`}
              </span>
            </div>
          </div>

          {/* Liquidation Price - Prominent */}
          <div className={`rounded-lg p-4 border-2 ${
            isBuy ? 'border-red-500/50 bg-red-500/10' : 'border-green-500/50 bg-green-500/10'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-tertiary uppercase tracking-wider">Liquidation Price</div>
                <div className="text-lg font-bold mono mt-1">
                  {preview.liquidationPrice.toFixed(5)} EUR
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-tertiary">Distance</div>
                <div className={`text-sm font-semibold ${isBuy ? 'text-red-400' : 'text-green-400'}`}>
                  {isBuy ? '-' : '+'}{Math.abs(((preview.liquidationPrice - preview.price) / preview.price) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <p className="text-xs text-secondary mt-2">
              {isBuy
                ? 'Position will be liquidated if price drops to this level'
                : 'Position will be liquidated if price rises to this level'
              }
            </p>
          </div>

          {/* Fee Estimates */}
          <div className="bg-tertiary rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-secondary">Trading Fee (est.)</span>
              <span className="mono text-tertiary">{preview.fees.tradingFee.toFixed(2)} EUR</span>
            </div>
            {preview.leverage > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Margin Open Fee</span>
                  <span className="mono text-tertiary">{preview.fees.marginOpenFee.toFixed(2)} EUR</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Rollover / 4h</span>
                  <span className="mono text-tertiary">{preview.fees.rolloverPer4h.toFixed(2)} EUR</span>
                </div>
              </>
            )}
          </div>

          {/* Risk Warnings */}
          {preview.risk.messages.length > 0 && (
            <div className={`rounded-lg p-4 ${
              preview.risk.isCritical
                ? 'bg-red-500/20 border border-red-500'
                : 'bg-yellow-500/20 border border-yellow-500'
            }`}>
              <div className="flex items-start gap-2">
                <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                  preview.risk.isCritical ? 'text-red-500' : 'text-yellow-500'
                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1">
                  <div className={`font-semibold text-sm ${
                    preview.risk.isCritical ? 'text-red-500' : 'text-yellow-500'
                  }`}>
                    {preview.risk.isCritical ? 'High Risk Warning' : 'Risk Warning'}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {preview.risk.messages.map((msg, i) => (
                      <li key={i} className="text-sm text-secondary">{msg}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-500/20 border border-red-500 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-semibold">Order Failed</span>
              </div>
              <p className="text-sm text-red-300 mt-1">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-tertiary border-t border-primary flex gap-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 btn btn-secondary py-3 font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || preview.risk.isCritical}
            className={`flex-1 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isBuy
                ? 'bg-green-500 hover:bg-green-400 text-black'
                : 'bg-red-500 hover:bg-red-400 text-white'
            }`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Submitting...
              </span>
            ) : validateOnly ? (
              'Validate Order'
            ) : (
              `${sideLabel} XRP ${preview.leverage}x`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
