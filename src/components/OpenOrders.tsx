'use client';

import { useState } from 'react';
import { useToast } from './Toast';
import { Tooltip } from './Tooltip';
import { useTradingData } from './TradingDataProvider';

export interface OpenOrderData {
  id: string;
  pair: string;
  type: 'buy' | 'sell';
  orderType: 'limit' | 'stop-loss' | 'take-profit';
  price: number;
  volume: number;
  leverage: number;
  status: string;
  createdAt: string;
}

type OpenOrder = OpenOrderData;

interface OpenOrdersProps {
  testMode: boolean;
  onEditOrder?: (order: OpenOrder) => void;
}

interface ConfirmCancelState {
  show: boolean;
  orderId: string | null;
  orderDetails: string;
  cancelAll: boolean;
}

export function OpenOrders({ testMode, onEditOrder }: OpenOrdersProps) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<ConfirmCancelState>({
    show: false,
    orderId: null,
    orderDetails: '',
    cancelAll: false,
  });
  const { addToast } = useToast();
  const {
    openOrders: orders,
    openOrdersLoading: loading,
    refreshOpenOrders,
    price: currentPrice,
  } = useTradingData();

  // Calculate distance to fill for limit orders
  const getDistanceToFill = (order: OpenOrder): { percent: number; direction: string; close: boolean } | null => {
    if (order.orderType !== 'limit' || !currentPrice || currentPrice === 0) return null;

    const diff = order.price - currentPrice;
    const percent = (diff / currentPrice) * 100;

    // For BUY orders: fills when price drops to order price (diff should be negative to fill)
    // For SELL orders: fills when price rises to order price (diff should be positive to fill)
    if (order.type === 'buy') {
      if (diff <= 0) return { percent: 0, direction: 'at or below', close: true };
      return { percent, direction: 'above', close: percent < 1 };
    } else {
      if (diff >= 0) return { percent: 0, direction: 'at or above', close: true };
      return { percent: Math.abs(percent), direction: 'below', close: Math.abs(percent) < 1 };
    }
  };

  // Show confirmation for single order cancel
  const showCancelConfirm = (order: OpenOrder) => {
    setConfirmCancel({
      show: true,
      orderId: order.id,
      orderDetails: `${order.type.toUpperCase()} ${order.volume} XRP @ €${order.price.toFixed(4)}`,
      cancelAll: false,
    });
  };

  // Show confirmation for cancel all
  const showCancelAllConfirm = () => {
    if (orders.length === 0) return;
    setConfirmCancel({
      show: true,
      orderId: null,
      orderDetails: `${orders.length} open orders`,
      cancelAll: true,
    });
  };

  // Execute cancel after confirmation
  const executeCancelConfirmed = async () => {
    if (confirmCancel.cancelAll) {
      await handleCancelAll();
    } else if (confirmCancel.orderId) {
      await handleCancel(confirmCancel.orderId);
    }
    setConfirmCancel({ show: false, orderId: null, orderDetails: '', cancelAll: false });
  };

  const handleCancel = async (orderId: string) => {
    setCancellingId(orderId);

    try {
      const endpoint = testMode ? '/api/simulated/orders' : '/api/kraken/private/orders';
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to cancel order');
      }

      addToast({
        title: 'Order Cancelled',
        message: `Order ${orderId.slice(0, 8)}... cancelled`,
        type: 'success',
      });

      refreshOpenOrders(true);
    } catch (err) {
      addToast({
        title: 'Cancel Failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    } finally {
      setCancellingId(null);
    }
  };

  const handleCancelAll = async () => {
    if (orders.length === 0) return;

    setCancellingAll(true);

    try {
      const endpoint = testMode ? '/api/simulated/orders' : '/api/kraken/private/orders';
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelAll: true }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to cancel orders');
      }

      addToast({
        title: 'All Orders Cancelled',
        message: `${result.cancelled || orders.length} orders cancelled`,
        type: 'success',
      });

      refreshOpenOrders(true);
    } catch (err) {
      addToast({
        title: 'Cancel All Failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    } finally {
      setCancellingAll(false);
    }
  };

  // Don't render if no orders
  if (!loading && orders.length === 0) {
    return null;
  }

  const getOrderTypeLabel = (orderType: string) => {
    switch (orderType) {
      case 'limit':
        return 'Limit';
      case 'stop-loss':
        return 'Stop Loss';
      case 'take-profit':
        return 'Take Profit';
      default:
        return orderType;
    }
  };

  const getOrderTypeColor = (orderType: string) => {
    switch (orderType) {
      case 'limit':
        return 'bg-blue-500/20 text-blue-400';
      case 'stop-loss':
        return 'bg-red-500/20 text-red-400';
      case 'take-profit':
        return 'bg-green-500/20 text-green-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className={`card p-4 border-2 ${testMode ? 'border-orange-500/40 bg-orange-500/5' : 'border-blue-500/40 bg-blue-500/5'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${testMode ? 'bg-orange-500' : 'bg-red-500'} animate-pulse`} />
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${testMode ? 'bg-orange-500/30 text-orange-300' : 'bg-red-500/30 text-red-300'}`}>
            {testMode ? 'TEST' : 'LIVE'}
          </span>
          <span className="text-secondary">Open Orders</span>
          <span className="px-2 py-0.5 rounded bg-tertiary text-secondary text-xs">
            {orders.length}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshOpenOrders(true)}
            className="text-xs text-secondary hover:text-primary transition-colors"
          >
            ↻ Refresh
          </button>
          {orders.length > 0 && (
            <Tooltip content="Cancel all open orders" position="left">
              <button
                onClick={showCancelAllConfirm}
                disabled={cancellingAll}
                className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {cancellingAll ? 'Cancelling...' : 'Cancel All'}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-4 text-secondary text-sm">
          Loading orders...
        </div>
      )}

      {/* Orders List */}
      {!loading && orders.length > 0 && (
        <div className="space-y-2">
          {orders.map((order) => (
            <div
              key={order.id}
              className={`p-3 rounded-lg border ${
                order.type === 'buy'
                  ? 'bg-green-500/5 border-green-500/30'
                  : 'bg-red-500/5 border-red-500/30'
              }`}
            >
              {/* Order Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      order.type === 'buy'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {order.type.toUpperCase()}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs ${getOrderTypeColor(order.orderType)}`}>
                    {getOrderTypeLabel(order.orderType)}
                  </span>
                  {order.leverage > 1 && (
                    <span className="text-xs text-tertiary">{order.leverage}x</span>
                  )}
                  {/* Distance Badge */}
                  {(() => {
                    const distance = getDistanceToFill(order);
                    if (!distance) return null;
                    return (
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        distance.percent === 0
                          ? 'bg-green-500/30 text-green-400'
                          : distance.close
                          ? 'bg-yellow-500/30 text-yellow-400 animate-pulse'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {distance.percent === 0 ? 'READY' : `${distance.percent.toFixed(2)}% away`}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-1">
                  {onEditOrder && (
                    <Tooltip content="Edit order in trade panel" position="left">
                      <button
                        onClick={() => onEditOrder(order)}
                        className="px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                      >
                        ✎
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content="Cancel this order" position="left">
                    <button
                      onClick={() => showCancelConfirm(order)}
                      disabled={cancellingId === order.id}
                      className="px-2 py-1 text-xs rounded bg-tertiary hover:bg-red-500/20 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      {cancellingId === order.id ? '...' : '✕'}
                    </button>
                  </Tooltip>
                </div>
              </div>

              {/* Order Details */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-tertiary">Limit Price: </span>
                  <span className="mono font-semibold">€{order.price.toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-tertiary">Volume: </span>
                  <span className="mono">{order.volume.toFixed(2)} XRP</span>
                </div>
                <div>
                  <span className="text-tertiary">Value: </span>
                  <span className="mono">€{(order.price * order.volume).toFixed(2)}</span>
                </div>
              </div>

              {/* Distance to Fill */}
              {(() => {
                const distance = getDistanceToFill(order);
                if (!distance) return null;
                return (
                  <div className={`mt-2 p-2 rounded text-xs ${
                    distance.close
                      ? 'bg-yellow-500/20 border border-yellow-500/30'
                      : 'bg-tertiary/30'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-tertiary">Current: </span>
                        <span className="mono font-semibold">€{currentPrice.toFixed(4)}</span>
                      </div>
                      <div className={distance.close ? 'text-yellow-400 font-semibold' : 'text-secondary'}>
                        {distance.percent === 0 ? (
                          <span className="text-green-400">Ready to fill!</span>
                        ) : (
                          <>
                            {distance.percent.toFixed(2)}% {distance.direction}
                            {distance.close && ' ⚡'}
                          </>
                        )}
                      </div>
                    </div>
                    {distance.percent > 0 && (
                      <div className="mt-1 text-tertiary">
                        {order.type === 'buy'
                          ? `Fills when price drops €${(currentPrice - order.price).toFixed(4)}`
                          : `Fills when price rises €${(order.price - currentPrice).toFixed(4)}`
                        }
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Order Time */}
              <div className="mt-2 text-xs text-tertiary">
                Created: {new Date(order.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {confirmCancel.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setConfirmCancel({ show: false, orderId: null, orderDetails: '', cancelAll: false })}
          />

          {/* Modal */}
          <div className="relative bg-secondary border border-primary rounded-xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="bg-red-500 px-6 py-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Confirm Cancel
              </h2>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="text-secondary mb-4">
                {confirmCancel.cancelAll
                  ? `Are you sure you want to cancel all ${orders.length} open orders?`
                  : `Are you sure you want to cancel this order?`
                }
              </p>
              <div className="bg-tertiary rounded-lg p-4 mb-4">
                <span className="text-sm mono font-semibold">{confirmCancel.orderDetails}</span>
              </div>
              <p className="text-xs text-tertiary">
                {testMode
                  ? 'This is a test order - no real money is involved.'
                  : 'This action cannot be undone.'
                }
              </p>
            </div>

            {/* Actions */}
            <div className="px-6 py-4 bg-tertiary border-t border-primary flex gap-3">
              <button
                onClick={() => setConfirmCancel({ show: false, orderId: null, orderDetails: '', cancelAll: false })}
                className="flex-1 btn btn-secondary py-3 font-semibold"
              >
                Keep Order
              </button>
              <button
                onClick={executeCancelConfirmed}
                disabled={cancellingId !== null || cancellingAll}
                className="flex-1 py-3 rounded-lg font-semibold bg-red-500 hover:bg-red-400 text-white transition-colors disabled:opacity-50"
              >
                {cancellingId !== null || cancellingAll ? 'Cancelling...' : 'Cancel Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
