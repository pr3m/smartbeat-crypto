'use client';

import { OpenOrders, type OpenOrderData } from '@/components/OpenOrders';
import { DraftTrades, type DraftOrder } from '@/components/DraftTrades';
import { useTradingData } from '@/components/TradingDataProvider';

interface OrdersTabProps {
  testMode: boolean;
  onEditOrder?: (order: OpenOrderData) => void;
  onEditDraft?: (draft: DraftOrder) => void;
  onOrderCancelled?: (orderId: string) => void;
}

export function OrdersTab({
  testMode,
  onEditOrder,
  onEditDraft,
  onOrderCancelled,
}: OrdersTabProps) {
  const {
    openOrders,
    draftOrders,
  } = useTradingData();

  const pendingDrafts = draftOrders.filter(d => d.status === 'pending');
  // Count unique trades (group by base setup type)
  const uniqueTradeTypes = new Set(
    pendingDrafts.map(d => {
      const type = d.aiSetupType || 'manual';
      return type.replace(/_(SL|TP\d+)$/, '') + '-' + d.createdAt.slice(0, 16);
    })
  );
  const draftTradesCount = uniqueTradeTypes.size;
  const totalOrders = openOrders.length + pendingDrafts.length;

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>📋</span>
            Orders Overview
          </h2>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500"></span>
              <span className="text-secondary">{draftTradesCount} Draft Trade{draftTradesCount !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${testMode ? 'bg-orange-500' : 'bg-blue-500'}`}></span>
              <span className="text-secondary">{openOrders.length} Open</span>
            </div>
          </div>
        </div>

        {totalOrders === 0 && (
          <div className="mt-4 text-center py-8 text-secondary">
            <div className="text-4xl mb-2">📭</div>
            <p>No orders yet</p>
            <p className="text-xs text-tertiary mt-1">
              Create orders from the Trade panel or use AI analysis to generate draft trades
            </p>
          </div>
        )}
      </div>

      {/* Draft Trades Section */}
      {pendingDrafts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-secondary mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
            Draft Trades
            <span className="text-xs text-tertiary font-normal">
              - Review and submit orders when ready
            </span>
          </h3>
          <DraftTrades
            testMode={testMode}
            onEditDraft={onEditDraft}
          />
        </div>
      )}

      {/* Open Orders Section */}
      {openOrders.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-secondary mb-3 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${testMode ? 'bg-orange-500' : 'bg-blue-500'} animate-pulse`}></span>
            Open Orders
            <span className={`text-xs font-normal px-2 py-0.5 rounded ${testMode ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'}`}>
              {testMode ? 'TEST' : 'LIVE'}
            </span>
          </h3>
          <OpenOrders testMode={testMode} onEditOrder={onEditOrder} onOrderCancelled={onOrderCancelled} defaultCollapsed />
        </div>
      )}

      {/* Order Types Reference */}
      <div className="card p-4">
        <h3 className="text-xs text-tertiary uppercase tracking-wider mb-3">Supported Order Types</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div className="p-2 bg-tertiary/30 rounded">
            <div className="font-semibold text-primary">Market</div>
            <div className="text-tertiary">Execute at current price</div>
          </div>
          <div className="p-2 bg-tertiary/30 rounded">
            <div className="font-semibold text-primary">Limit</div>
            <div className="text-tertiary">Execute at specific price</div>
          </div>
          <div className="p-2 bg-tertiary/30 rounded">
            <div className="font-semibold text-primary">Stop Loss</div>
            <div className="text-tertiary">Exit when price hits trigger</div>
          </div>
          <div className="p-2 bg-tertiary/30 rounded">
            <div className="font-semibold text-primary">Take Profit</div>
            <div className="text-tertiary">Exit at target price</div>
          </div>
          <div className="p-2 bg-tertiary/30 rounded">
            <div className="font-semibold text-primary">Trailing Stop</div>
            <div className="text-tertiary">Dynamic stop that follows price</div>
          </div>
          <div className="p-2 bg-tertiary/30 rounded">
            <div className="font-semibold text-primary">Iceberg</div>
            <div className="text-tertiary">Large order in small chunks</div>
          </div>
        </div>
      </div>
    </div>
  );
}
