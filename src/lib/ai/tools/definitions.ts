/**
 * AI Tool Definitions
 * OpenAI function calling tool definitions for the assistant
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const assistantTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_transactions',
      description:
        'Query historical transactions from the database. Can filter by year, type, asset, and date range. Returns transaction data including P&L for margin trades.',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'number',
            description: 'Tax year to filter (e.g., 2024)',
          },
          type: {
            type: 'string',
            enum: ['TRADE', 'MARGIN_TRADE', 'STAKING_REWARD', 'EARN_REWARD', 'AIRDROP', 'DEPOSIT', 'WITHDRAWAL'],
            description: 'Transaction type filter',
          },
          asset: {
            type: 'string',
            description: 'Asset symbol filter (e.g., XRP, BTC, ETH)',
          },
          startDate: {
            type: 'string',
            description: 'Start date in ISO format (e.g., 2024-01-01)',
          },
          endDate: {
            type: 'string',
            description: 'End date in ISO format (e.g., 2024-12-31)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of records to return (default 50, max 200)',
          },
          aggregation: {
            type: 'string',
            enum: ['none', 'daily', 'monthly', 'by_type'],
            description: 'How to aggregate results',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_positions',
      description:
        'Get current open positions (both simulated and Kraken). Returns position details including entry price, current value, and unrealized P&L.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['all', 'simulated', 'kraken'],
            description: 'Type of positions to retrieve',
          },
          includeHistory: {
            type: 'boolean',
            description: 'Include recently closed positions',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_data',
      description:
        'Get current market data for a trading pair including price, 24h stats, and optionally OHLC candles with technical indicators and candlestick pattern detection.',
      parameters: {
        type: 'object',
        properties: {
          pair: {
            type: 'string',
            description: 'Trading pair (e.g., XRPEUR, BTCEUR, ETHEUR). Default: XRPEUR',
          },
          includeIndicators: {
            type: 'boolean',
            description: 'Include technical indicators (RSI, MACD, BB, ATR, volume ratio)',
          },
          timeframe: {
            type: 'string',
            enum: ['5m', '15m', '1h', '4h'],
            description: 'Timeframe for indicators (default: 15m)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trading_recommendation',
      description:
        'Get the full multi-timeframe trading recommendation for XRP/EUR. Analyzes 4H, 1H, 15m, and 5m timeframes using the same algorithm as the Trading dashboard. Returns action (LONG/SHORT/WAIT), confidence, checklist with all conditions, reasoning, reversal detection, rejection detection (composite S/R rejection), and candlestick patterns.',
      parameters: {
        type: 'object',
        properties: {
          includeBTC: {
            type: 'boolean',
            description: 'Include BTC correlation check (default: true)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ohlc_data',
      description:
        'Get OHLC (candlestick) data for a trading pair with calculated technical indicators. Use this for detailed chart analysis.',
      parameters: {
        type: 'object',
        properties: {
          pair: {
            type: 'string',
            description: 'Trading pair (e.g., XRPEUR, BTCEUR). Default: XRPEUR',
          },
          interval: {
            type: 'number',
            enum: [1, 5, 15, 30, 60, 240, 1440],
            description: 'Candle interval in minutes. 1=1m, 5=5m, 15=15m, 30=30m, 60=1h, 240=4h, 1440=1d',
          },
          limit: {
            type: 'number',
            description: 'Number of candles to return (default: 50, max: 200)',
          },
          since: {
            type: 'string',
            description: 'ISO date string (e.g. "2026-02-13T00:00:00Z") to fetch candles from a specific time. Kraken returns up to 720 candles after this timestamp.',
          },
          includeIndicators: {
            type: 'boolean',
            description: 'Calculate and include technical indicators',
          },
        },
        required: ['interval'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kraken_api',
      description:
        'Make a GET request to Kraken API. Use this for live account data like balances, open orders, positions, trade history, etc.',
      parameters: {
        type: 'object',
        properties: {
          endpoint: {
            type: 'string',
            enum: ['balance', 'trade-balance', 'positions', 'orders', 'trades', 'ledgers'],
            description: 'The Kraken API endpoint to call',
          },
          params: {
            type: 'object',
            description: 'Optional query parameters (e.g., { asset: "XRP" } for filtering)',
          },
        },
        required: ['endpoint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_tax',
      description:
        'Calculate Estonian tax liability for a given year. Returns breakdown by transaction type and total tax due.',
      parameters: {
        type: 'object',
        properties: {
          year: {
            type: 'number',
            description: 'Tax year to calculate (required)',
          },
          includeDetails: {
            type: 'boolean',
            description: 'Include detailed breakdown by asset and month',
          },
        },
        required: ['year'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_trades',
      description:
        'Analyze trading performance. Returns win rate, average P&L, best/worst trades, and patterns.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['week', 'month', 'quarter', 'year', 'all'],
            description: 'Time period to analyze',
          },
          type: {
            type: 'string',
            enum: ['all', 'margin', 'spot'],
            description: 'Type of trades to analyze',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ledger',
      description:
        'Query ledger entries for fees, deposits, withdrawals, and other account activity.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['all', 'trade', 'deposit', 'withdrawal', 'transfer', 'margin', 'rollover', 'staking'],
            description: 'Ledger entry type filter',
          },
          asset: {
            type: 'string',
            description: 'Asset to filter by',
          },
          startDate: {
            type: 'string',
            description: 'Start date in ISO format',
          },
          endDate: {
            type: 'string',
            description: 'End date in ISO format',
          },
          limit: {
            type: 'number',
            description: 'Maximum entries to return',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_balance',
      description: 'Get current account balance including EUR, crypto holdings, margin, and equity.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['simulated', 'kraken'],
            description: 'Account type to query',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_ai_report',
      description:
        'Generate a comprehensive AI trade analysis report. This performs the same analysis as clicking "Run AI Analysis" in the Trading dashboard. The report is automatically saved to the Reports tab. Returns detailed entry/exit levels, targets, stop loss, and reasoning.',
      parameters: {
        type: 'object',
        properties: {
          pair: {
            type: 'string',
            description: 'Trading pair to analyze (default: XRPEUR)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reports',
      description:
        'Query saved AI analysis reports from the Reports tab. Can filter by action type and limit results.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['LONG', 'SHORT', 'WAIT'],
            description: 'Filter by recommendation type',
          },
          limit: {
            type: 'number',
            description: 'Number of reports to return (default: 10)',
          },
          reportId: {
            type: 'string',
            description: 'Get a specific report by ID for detailed analysis',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_setup',
      description:
        'Get the current trading setup/entry checklist. Shows which conditions are passing for LONG and SHORT setups, including 4H trend, 1H setup, 15m entry, volume, BTC alignment, RSI extreme, and liquidation bias. Use this to discuss whether the current setup is valid for entry.',
      parameters: {
        type: 'object',
        properties: {
          detailed: {
            type: 'boolean',
            description: 'Include detailed indicator values for each timeframe',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_position',
      description:
        'Get detailed analysis of a specific open position including current P&L, risk metrics, and AI-generated insights about whether to hold, add, or close.',
      parameters: {
        type: 'object',
        properties: {
          positionId: {
            type: 'string',
            description: 'Position ID to analyze (if not provided, analyzes the first open position)',
          },
          type: {
            type: 'string',
            enum: ['simulated', 'kraken'],
            description: 'Position type (default: simulated)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_strategy_config',
      description:
        'Get the current trading strategy configuration. Returns weights, thresholds, DCA rules, exit rules, timebox, risk settings, and position sizing rules. Use this to answer questions about the trading strategy.',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: ['all', 'meta', 'weights', 'signals', 'positionSizing', 'dca', 'exit', 'timebox', 'antiGreed', 'risk'],
            description: 'Specific section to return (default: all)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_chart_analysis',
      description:
        'Get detailed chart structure analysis including support/resistance levels, Fibonacci levels, swing points, trend structure, and multi-timeframe alignment. Use this when discussing price levels, chart patterns, or market structure.',
      parameters: {
        type: 'object',
        properties: {
          pair: {
            type: 'string',
            description: 'Trading pair (default: XRPEUR)',
          },
          timeframes: {
            type: 'array',
            items: { type: 'number', enum: [5, 15, 60, 240, 1440] },
            description: 'Timeframe intervals in minutes to analyze (default: [15, 60, 240, 1440])',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_v2_engine_state',
      description:
        'Get the v2 trading engine state for the current position. Returns DCA signal (momentum exhaustion analysis with 5 signals), exit signal (pressure breakdown from 8 sources including reversal detection), reversal signal (candlestick pattern-based reversal phase, confidence, patterns), timebox status (hours elapsed/remaining, current step, pressure), anti-greed status (HWM, drawdown), and position sizing recommendation. Use this when the user asks about DCA, exit, or position management.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['simulated', 'kraken'],
            description: 'Position type to analyze (default: simulated)',
          },
        },
      },
    },
  },
];

export type ToolName =
  | 'query_transactions'
  | 'get_positions'
  | 'get_market_data'
  | 'get_trading_recommendation'
  | 'get_ohlc_data'
  | 'kraken_api'
  | 'calculate_tax'
  | 'analyze_trades'
  | 'get_ledger'
  | 'get_balance'
  | 'generate_ai_report'
  | 'get_reports'
  | 'get_current_setup'
  | 'analyze_position'
  | 'get_strategy_config'
  | 'get_chart_analysis'
  | 'get_v2_engine_state';
