import { NextResponse } from 'next/server';

/**
 * Kraken Futures API - Get liquidation-related data
 *
 * Returns:
 * - Open interest for XRP perpetual
 * - Funding rate (positive = longs pay shorts = crowded long)
 * - BTC funding rate as market direction indicator
 */

interface KrakenTicker {
  symbol: string;
  last: number;
  markPrice: number;
  openInterest: number;
  fundingRate: number;
  fundingRatePrediction: number;
  vol24h: number;
  volumeQuote: number;
  high24h: number;
  low24h: number;
  open24h: number;
  change24h: number;
  indexPrice: number;
  bid: number;
  ask: number;
}

interface KrakenTickersResponse {
  result: string;
  tickers: KrakenTicker[];
  serverTime: string;
}

export interface LiquidationApiResponse {
  xrp: {
    symbol: string;
    price: number;
    openInterest: number;
    openInterestUsd: number;
    fundingRate: number;
    fundingRatePrediction: number;
    fundingAnnualized: number;
    vol24h: number;
    change24h: number;
    high24h: number;
    low24h: number;
  };
  btc: {
    symbol: string;
    price: number;
    openInterest: number;
    openInterestUsd: number;
    fundingRate: number;
    fundingAnnualized: number;
    change24h: number;
  };
  eth: {
    symbol: string;
    price: number;
    openInterest: number;
    openInterestUsd: number;
    fundingRate: number;
    fundingAnnualized: number;
    change24h: number;
  };
  marketBias: {
    direction: 'bullish' | 'bearish' | 'neutral';
    strength: number;
    reason: string;
  };
  timestamp: number;
}

export async function GET() {
  try {
    const response = await fetch('https://futures.kraken.com/derivatives/api/v3/tickers', {
      next: { revalidate: 30 }, // Cache for 30 seconds
    });

    if (!response.ok) {
      throw new Error(`Kraken API error: ${response.status}`);
    }

    const data: KrakenTickersResponse = await response.json();

    // Find perpetual contracts
    const xrpTicker = data.tickers.find(t => t.symbol === 'PF_XRPUSD');
    const btcTicker = data.tickers.find(t => t.symbol === 'PF_XBTUSD');
    const ethTicker = data.tickers.find(t => t.symbol === 'PF_ETHUSD');

    if (!xrpTicker || !btcTicker || !ethTicker) {
      throw new Error('Required tickers not found');
    }

    // Annualize funding rate (hourly funding, so × 24 × 365)
    const annualizeFunding = (rate: number) => rate * 24 * 365 * 100;

    // Determine market bias from BTC funding rate
    // Positive funding = crowded long = bearish pressure potential
    // Negative funding = crowded short = bullish pressure potential
    let marketDirection: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let marketStrength = 0;
    let marketReason = 'Funding rates are balanced';

    const btcFundingAnnualized = annualizeFunding(btcTicker.fundingRate);

    // BTC funding > 20% annualized = heavily long = potential correction
    // BTC funding < -10% annualized = heavily short = potential squeeze up
    if (btcFundingAnnualized > 50) {
      marketDirection = 'bearish';
      marketStrength = Math.min(1, (btcFundingAnnualized - 50) / 100);
      marketReason = `BTC extremely crowded long (${btcFundingAnnualized.toFixed(0)}% APR). High long liquidation risk.`;
    } else if (btcFundingAnnualized > 20) {
      marketDirection = 'bearish';
      marketStrength = Math.min(0.6, (btcFundingAnnualized - 20) / 50);
      marketReason = `BTC crowded long (${btcFundingAnnualized.toFixed(0)}% APR). Potential long squeeze.`;
    } else if (btcFundingAnnualized < -20) {
      marketDirection = 'bullish';
      marketStrength = Math.min(1, (Math.abs(btcFundingAnnualized) - 20) / 50);
      marketReason = `BTC crowded short (${btcFundingAnnualized.toFixed(0)}% APR). Short squeeze potential.`;
    } else if (btcFundingAnnualized < -10) {
      marketDirection = 'bullish';
      marketStrength = Math.min(0.5, (Math.abs(btcFundingAnnualized) - 10) / 20);
      marketReason = `BTC slightly short-heavy (${btcFundingAnnualized.toFixed(0)}% APR). Mild bullish bias.`;
    } else if (btcFundingAnnualized > 10) {
      marketDirection = 'bearish';
      marketStrength = Math.min(0.3, (btcFundingAnnualized - 10) / 30);
      marketReason = `BTC slightly long-heavy (${btcFundingAnnualized.toFixed(0)}% APR). Mild bearish bias.`;
    }

    const result: LiquidationApiResponse = {
      xrp: {
        symbol: xrpTicker.symbol,
        price: xrpTicker.markPrice,
        openInterest: xrpTicker.openInterest,
        openInterestUsd: xrpTicker.openInterest * xrpTicker.markPrice,
        fundingRate: xrpTicker.fundingRate,
        fundingRatePrediction: xrpTicker.fundingRatePrediction,
        fundingAnnualized: annualizeFunding(xrpTicker.fundingRate),
        vol24h: xrpTicker.vol24h,
        change24h: xrpTicker.change24h,
        high24h: xrpTicker.high24h,
        low24h: xrpTicker.low24h,
      },
      btc: {
        symbol: btcTicker.symbol,
        price: btcTicker.markPrice,
        openInterest: btcTicker.openInterest,
        openInterestUsd: btcTicker.openInterest * btcTicker.markPrice,
        fundingRate: btcTicker.fundingRate,
        fundingAnnualized: btcFundingAnnualized,
        change24h: btcTicker.change24h,
      },
      eth: {
        symbol: ethTicker.symbol,
        price: ethTicker.markPrice,
        openInterest: ethTicker.openInterest,
        openInterestUsd: ethTicker.openInterest * ethTicker.markPrice,
        fundingRate: ethTicker.fundingRate,
        fundingAnnualized: annualizeFunding(ethTicker.fundingRate),
        change24h: ethTicker.change24h,
      },
      marketBias: {
        direction: marketDirection,
        strength: marketStrength,
        reason: marketReason,
      },
      timestamp: Date.now(),
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Liquidation API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch liquidation data' },
      { status: 500 }
    );
  }
}
