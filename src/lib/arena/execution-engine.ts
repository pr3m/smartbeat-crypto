/**
 * Arena Execution Engine
 *
 * Virtual trading execution engine for the Arena competition.
 * Handles opening, closing, DCA-ing positions with realistic fee calculations.
 * Mirrors Kraken's fee structure and liquidation logic.
 */

import type { AgentState, ArenaPositionState } from './types';
import { generateId, getHealthZone } from './types';
import { FEE_RATES } from '@/lib/trading/trade-calculations';

export class ArenaExecutionEngine {
  /**
   * Open a new position.
   * Margin is deducted from balance. Fees are charged on the notional value.
   */
  openPosition(
    state: AgentState,
    side: 'long' | 'short',
    currentPrice: number,
    marginPercent: number,
    leverage: number
  ): { state: AgentState; position: ArenaPositionState } {
    // Clamp margin percent to 5-20%
    const clampedMarginPercent = Math.max(5, Math.min(20, marginPercent));
    const marginUsed = state.balance * (clampedMarginPercent / 100);
    const notionalValue = marginUsed * leverage;
    const volume = notionalValue / currentPrice;

    // Calculate fees: taker fee + margin open fee
    const takerFee = notionalValue * FEE_RATES.taker;
    const marginOpenFee = notionalValue * FEE_RATES.marginOpen;
    const totalFees = takerFee + marginOpenFee;

    // Calculate liquidation price
    // Liquidation when margin level < 80%: loss exceeds 20% of margin
    const liquidationMovePercent = 20 / leverage;
    const liquidationPrice = side === 'long'
      ? currentPrice * (1 - liquidationMovePercent / 100)
      : currentPrice * (1 + liquidationMovePercent / 100);

    const position: ArenaPositionState = {
      id: generateId(),
      pair: 'XRPEUR',
      side,
      volume,
      avgEntryPrice: currentPrice,
      leverage,
      marginUsed,
      totalFees,
      dcaCount: 0,
      dcaEntries: [],
      isOpen: true,
      openedAt: Date.now(),
      unrealizedPnl: -totalFees, // Immediately down by fees
      unrealizedPnlPercent: marginUsed > 0 ? (-totalFees / marginUsed) * 100 : 0,
      liquidationPrice: Math.max(0, liquidationPrice),
    };

    const newBalance = state.balance - marginUsed;
    const equity = newBalance + position.unrealizedPnl + marginUsed; // balance + margin + unrealized

    const updatedState: AgentState = {
      ...state,
      balance: newBalance,
      equity,
      hasPosition: true,
      position,
      totalFees: state.totalFees + totalFees,
      tradeCount: state.tradeCount + 1,
      lastTradeAt: Date.now(),
    };

    // Update peak equity and drawdown
    updatedState.peakEquity = Math.max(updatedState.peakEquity, equity);
    updatedState.maxDrawdown = Math.max(
      updatedState.maxDrawdown,
      ((updatedState.peakEquity - equity) / updatedState.peakEquity) * 100
    );

    // Update health
    updatedState.health = this.calculateHealth(updatedState);
    updatedState.healthZone = getHealthZone(updatedState.health);

    return { state: updatedState, position };
  }

  /**
   * Close an existing position.
   * Returns margin to balance, plus/minus realized P&L.
   */
  closePosition(
    state: AgentState,
    currentPrice: number
  ): { state: AgentState; realizedPnl: number; fees: number } {
    if (!state.position || !state.hasPosition) {
      return { state, realizedPnl: 0, fees: 0 };
    }

    const pos = state.position;

    // Calculate closing fee (taker fee on notional at current price)
    const closingNotional = pos.volume * currentPrice;
    const closingFee = closingNotional * FEE_RATES.taker;

    // Calculate rollover fees
    const hoursOpen = (Date.now() - pos.openedAt) / (1000 * 60 * 60);
    const rolloverPeriods = Math.floor(hoursOpen / 4);
    const openNotional = pos.volume * pos.avgEntryPrice;
    const rolloverFee = openNotional * FEE_RATES.marginRollover * rolloverPeriods;

    const totalClosingFees = closingFee + rolloverFee;
    const totalAllFees = pos.totalFees + totalClosingFees;

    // Calculate raw P&L
    let rawPnl: number;
    if (pos.side === 'long') {
      rawPnl = (currentPrice - pos.avgEntryPrice) * pos.volume;
    } else {
      rawPnl = (pos.avgEntryPrice - currentPrice) * pos.volume;
    }

    // Net realized P&L after all fees
    const realizedPnl = rawPnl - totalAllFees;

    // Return margin + P&L to balance
    const newBalance = state.balance + pos.marginUsed + realizedPnl;
    const equity = newBalance;

    const isWin = realizedPnl > 0;

    const updatedState: AgentState = {
      ...state,
      balance: newBalance,
      equity,
      hasPosition: false,
      position: null,
      totalPnl: state.totalPnl + realizedPnl,
      totalFees: state.totalFees + totalClosingFees,
      winCount: state.winCount + (isWin ? 1 : 0),
      lossCount: state.lossCount + (isWin ? 0 : 1),
      tradeCount: state.tradeCount + 1,
      lastTradeAt: Date.now(),
    };

    // Update peak equity and drawdown
    updatedState.peakEquity = Math.max(updatedState.peakEquity, equity);
    updatedState.maxDrawdown = Math.max(
      updatedState.maxDrawdown,
      ((updatedState.peakEquity - equity) / updatedState.peakEquity) * 100
    );

    // Check for bankruptcy
    if (newBalance <= 0) {
      updatedState.isDead = true;
      updatedState.status = 'bankrupt';
      updatedState.deathTick = Date.now();
      updatedState.deathReason = 'Balance depleted';
      updatedState.health = 0;
    } else {
      updatedState.health = this.calculateHealth(updatedState);
    }
    updatedState.healthZone = getHealthZone(updatedState.health);

    return { state: updatedState, realizedPnl, fees: totalAllFees };
  }

  /**
   * DCA into an existing position.
   * Adds margin and volume, recalculates average entry price.
   */
  dcaPosition(
    state: AgentState,
    currentPrice: number,
    additionalMarginPercent: number
  ): { state: AgentState; position: ArenaPositionState } {
    if (!state.position || !state.hasPosition) {
      throw new Error('No open position to DCA into');
    }

    const pos = state.position;
    const clampedPercent = Math.max(5, Math.min(20, additionalMarginPercent));
    const additionalMargin = state.balance * (clampedPercent / 100);
    const additionalNotional = additionalMargin * pos.leverage;
    const additionalVolume = additionalNotional / currentPrice;

    // Calculate fees for DCA
    const takerFee = additionalNotional * FEE_RATES.taker;
    const marginOpenFee = additionalNotional * FEE_RATES.marginOpen;
    const dcaFees = takerFee + marginOpenFee;

    // Calculate new average entry price (volume-weighted)
    const totalCostBasis = (pos.avgEntryPrice * pos.volume) + (currentPrice * additionalVolume);
    const newVolume = pos.volume + additionalVolume;
    const newAvgEntry = totalCostBasis / newVolume;
    const newMarginUsed = pos.marginUsed + additionalMargin;

    // Recalculate liquidation price with new average entry
    const liquidationMovePercent = 20 / pos.leverage;
    const newLiquidationPrice = pos.side === 'long'
      ? newAvgEntry * (1 - liquidationMovePercent / 100)
      : newAvgEntry * (1 + liquidationMovePercent / 100);

    // Calculate unrealized P&L with new position
    let rawPnl: number;
    if (pos.side === 'long') {
      rawPnl = (currentPrice - newAvgEntry) * newVolume;
    } else {
      rawPnl = (newAvgEntry - currentPrice) * newVolume;
    }
    const totalFees = pos.totalFees + dcaFees;
    const unrealizedPnl = rawPnl - totalFees;
    const unrealizedPnlPercent = newMarginUsed > 0 ? (unrealizedPnl / newMarginUsed) * 100 : 0;

    const dcaEntry = {
      price: currentPrice,
      volume: additionalVolume,
      marginUsed: additionalMargin,
      timestamp: Date.now(),
      reason: 'DCA',
    };

    const updatedPosition: ArenaPositionState = {
      ...pos,
      volume: newVolume,
      avgEntryPrice: newAvgEntry,
      marginUsed: newMarginUsed,
      totalFees,
      dcaCount: pos.dcaCount + 1,
      dcaEntries: [...pos.dcaEntries, dcaEntry],
      unrealizedPnl,
      unrealizedPnlPercent,
      liquidationPrice: Math.max(0, newLiquidationPrice),
    };

    const newBalance = state.balance - additionalMargin;
    const equity = newBalance + unrealizedPnl + newMarginUsed;

    const updatedState: AgentState = {
      ...state,
      balance: newBalance,
      equity,
      position: updatedPosition,
      totalFees: state.totalFees + dcaFees,
    };

    // Update peak equity and drawdown
    updatedState.peakEquity = Math.max(updatedState.peakEquity, equity);
    updatedState.maxDrawdown = Math.max(
      updatedState.maxDrawdown,
      ((updatedState.peakEquity - equity) / updatedState.peakEquity) * 100
    );

    // Update health
    updatedState.health = this.calculateHealth(updatedState);
    updatedState.healthZone = getHealthZone(updatedState.health);

    return { state: updatedState, position: updatedPosition };
  }

  /**
   * Check if a position would be liquidated at the current price.
   * Uses the same logic as isLiquidated() from simulated-pnl.ts:
   * Liquidation when margin level drops below 80%.
   */
  checkLiquidation(
    state: AgentState,
    currentPrice: number
  ): { isLiquidated: boolean; reason?: string } {
    if (!state.position || !state.hasPosition) {
      return { isLiquidated: false };
    }

    const pos = state.position;
    const movePercent = ((currentPrice - pos.avgEntryPrice) / pos.avgEntryPrice) * 100;
    const liquidationThreshold = 20 / pos.leverage;

    if (pos.side === 'long' && movePercent <= -liquidationThreshold) {
      return {
        isLiquidated: true,
        reason: `Long liquidated: price dropped ${Math.abs(movePercent).toFixed(2)}% (threshold: ${liquidationThreshold.toFixed(2)}%)`,
      };
    }

    if (pos.side === 'short' && movePercent >= liquidationThreshold) {
      return {
        isLiquidated: true,
        reason: `Short liquidated: price rose ${movePercent.toFixed(2)}% (threshold: ${liquidationThreshold.toFixed(2)}%)`,
      };
    }

    return { isLiquidated: false };
  }

  /**
   * Update position P&L without trading.
   * Called each tick to keep unrealized P&L current.
   */
  updatePositionPnL(
    state: AgentState,
    currentPrice: number
  ): AgentState {
    if (!state.position || !state.hasPosition) {
      // No position: equity = balance
      const updatedState = { ...state, equity: state.balance };
      updatedState.peakEquity = Math.max(updatedState.peakEquity, updatedState.equity);
      updatedState.health = this.calculateHealth(updatedState);
      updatedState.healthZone = getHealthZone(updatedState.health);
      return updatedState;
    }

    const pos = state.position;

    // Calculate raw P&L
    let rawPnl: number;
    if (pos.side === 'long') {
      rawPnl = (currentPrice - pos.avgEntryPrice) * pos.volume;
    } else {
      rawPnl = (pos.avgEntryPrice - currentPrice) * pos.volume;
    }

    // Estimate rollover fees
    const hoursOpen = (Date.now() - pos.openedAt) / (1000 * 60 * 60);
    const rolloverPeriods = Math.floor(hoursOpen / 4);
    const openNotional = pos.volume * pos.avgEntryPrice;
    const rolloverFee = openNotional * FEE_RATES.marginRollover * rolloverPeriods;

    const totalFeesIncRollover = pos.totalFees + rolloverFee;
    const unrealizedPnl = rawPnl - totalFeesIncRollover;
    const unrealizedPnlPercent = pos.marginUsed > 0 ? (unrealizedPnl / pos.marginUsed) * 100 : 0;

    // Recalculate liquidation price
    const liquidationMovePercent = 20 / pos.leverage;
    const liquidationPrice = pos.side === 'long'
      ? pos.avgEntryPrice * (1 - liquidationMovePercent / 100)
      : pos.avgEntryPrice * (1 + liquidationMovePercent / 100);

    const updatedPosition: ArenaPositionState = {
      ...pos,
      unrealizedPnl,
      unrealizedPnlPercent,
      liquidationPrice: Math.max(0, liquidationPrice),
    };

    const equity = state.balance + unrealizedPnl + pos.marginUsed;

    const updatedState: AgentState = {
      ...state,
      equity,
      position: updatedPosition,
    };

    // Update peak equity and drawdown
    updatedState.peakEquity = Math.max(updatedState.peakEquity, equity);
    updatedState.maxDrawdown = Math.max(
      updatedState.maxDrawdown,
      ((updatedState.peakEquity - equity) / updatedState.peakEquity) * 100
    );

    // Update health
    updatedState.health = this.calculateHealth(updatedState);
    updatedState.healthZone = getHealthZone(updatedState.health);

    return updatedState;
  }

  /**
   * Calculate health from equity.
   * health = (equity / startingCapital) * 100, clamped 0-100.
   */
  calculateHealth(state: AgentState): number {
    if (state.startingCapital <= 0) return 0;
    const raw = (state.equity / state.startingCapital) * 100;
    return Math.max(0, Math.min(100, raw));
  }
}
