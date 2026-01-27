/**
 * AI Usage Tab
 * Displays AI usage statistics, costs, and history
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

interface UsageSummary {
  byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>;
  byFeature: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>;
  totals: { requests: number; inputTokens: number; outputTokens: number; cost: number };
}

interface UsageRecord {
  id: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number | null;
  success: boolean;
  durationMs: number | null;
  createdAt: string;
}

interface DailyUsage {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export function AIUsageTab() {
  const [period, setPeriod] = useState(30);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [recentRecords, setRecentRecords] = useState<UsageRecord[]>([]);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'summary' | 'history'>('summary');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [summaryRes, recentRes, dailyRes] = await Promise.all([
        fetch(`/api/ai/usage?view=summary&days=${period}`),
        fetch('/api/ai/usage?view=recent&limit=50'),
        fetch(`/api/ai/usage?view=daily&days=${period}`),
      ]);

      if (!summaryRes.ok || !recentRes.ok || !dailyRes.ok) {
        throw new Error('Failed to fetch usage data');
      }

      const [summaryData, recentData, dailyData] = await Promise.all([
        summaryRes.json(),
        recentRes.json(),
        dailyRes.json(),
      ]);

      setSummary({
        byModel: summaryData.byModel,
        byFeature: summaryData.byFeature,
        totals: summaryData.totals,
      });
      setRecentRecords(recentData.records || []);
      setDailyUsage(dailyData.daily || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const featureLabels: Record<string, string> = {
    chat: 'Chat Assistant',
    market_analysis: 'Market Analysis',
    position_evaluation: 'Position Evaluation',
    trade_review: 'Trade Review',
  };

  if (loading) {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-secondary">Loading usage data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="flex flex-col items-center justify-center h-64">
          <p className="text-danger mb-4">{error}</p>
          <button onClick={fetchData} className="btn btn-secondary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">AI Usage Statistics</h2>
          <p className="text-secondary text-sm">
            Track API usage, costs, and performance
          </p>
        </div>

        <div className="flex items-center gap-4">
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="input text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>

          <button
            onClick={fetchData}
            className="p-2 hover:bg-tertiary rounded-lg transition-colors"
            title="Refresh"
          >
            <svg
              className="w-5 h-5 text-secondary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            title="Total Requests"
            value={formatNumber(summary.totals.requests)}
            icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
          <SummaryCard
            title="Input Tokens"
            value={formatNumber(summary.totals.inputTokens)}
            icon="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
          />
          <SummaryCard
            title="Output Tokens"
            value={formatNumber(summary.totals.outputTokens)}
            icon="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
          <SummaryCard
            title="Estimated Cost"
            value={formatCost(summary.totals.cost)}
            icon="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            highlight
          />
        </div>
      )}

      {/* View Toggle */}
      <div className="flex gap-2 border-b border-primary pb-4">
        <button
          onClick={() => setActiveView('summary')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === 'summary'
              ? 'bg-tertiary text-primary'
              : 'text-secondary hover:text-primary'
          }`}
        >
          Breakdown
        </button>
        <button
          onClick={() => setActiveView('history')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeView === 'history'
              ? 'bg-tertiary text-primary'
              : 'text-secondary hover:text-primary'
          }`}
        >
          Request History
        </button>
      </div>

      {activeView === 'summary' && summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* By Model */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-4">
              Usage by Model
            </h3>
            {Object.keys(summary.byModel).length === 0 ? (
              <p className="text-tertiary text-sm">No usage data yet</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(summary.byModel)
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([model, stats]) => (
                    <div key={model} className="flex items-center justify-between">
                      <div>
                        <p className="font-medium mono text-sm">{model}</p>
                        <p className="text-xs text-tertiary">
                          {formatNumber(stats.requests)} requests
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium mono text-sm">
                          {formatNumber(stats.inputTokens + stats.outputTokens)} tokens
                        </p>
                        <p className="text-xs text-info">{formatCost(stats.cost)}</p>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* By Feature */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-4">
              Usage by Feature
            </h3>
            {Object.keys(summary.byFeature).length === 0 ? (
              <p className="text-tertiary text-sm">No usage data yet</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(summary.byFeature)
                  .sort((a, b) => b[1].requests - a[1].requests)
                  .map(([feature, stats]) => (
                    <div key={feature} className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">
                          {featureLabels[feature] || feature}
                        </p>
                        <p className="text-xs text-tertiary">
                          {formatNumber(stats.requests)} requests
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium mono text-sm">
                          {formatNumber(stats.inputTokens + stats.outputTokens)} tokens
                        </p>
                        <p className="text-xs text-info">{formatCost(stats.cost)}</p>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Daily Chart (simplified) */}
          <div className="card p-6 lg:col-span-2">
            <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-4">
              Daily Usage (Last {period} Days)
            </h3>
            {dailyUsage.length === 0 ? (
              <p className="text-tertiary text-sm">No usage data yet</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  <div className="flex items-end h-32 gap-1">
                    {dailyUsage.slice(-30).map((day) => {
                      const maxRequests = Math.max(...dailyUsage.map((d) => d.requests));
                      const height = maxRequests > 0 ? (day.requests / maxRequests) * 100 : 0;
                      return (
                        <div
                          key={day.date}
                          className="flex-1 bg-info/20 hover:bg-info/40 transition-colors rounded-t cursor-pointer group relative"
                          style={{ height: `${Math.max(height, 4)}%` }}
                          title={`${day.date}: ${day.requests} requests, ${formatCost(day.cost)}`}
                        >
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-tertiary rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                            {day.date.slice(5)}: {day.requests}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeView === 'history' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Feature</th>
                  <th>Model</th>
                  <th className="text-right">Input</th>
                  <th className="text-right">Output</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRecords.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-tertiary py-8">
                      No usage records yet
                    </td>
                  </tr>
                ) : (
                  recentRecords.map((record) => (
                    <tr key={record.id}>
                      <td className="whitespace-nowrap text-xs">
                        {formatDate(record.createdAt)}
                      </td>
                      <td>{featureLabels[record.feature] || record.feature}</td>
                      <td className="mono text-xs">{record.model}</td>
                      <td className="text-right mono">
                        {formatNumber(record.inputTokens)}
                      </td>
                      <td className="text-right mono">
                        {formatNumber(record.outputTokens)}
                      </td>
                      <td className="text-right mono text-info">
                        {record.estimatedCost !== null
                          ? formatCost(record.estimatedCost)
                          : '-'}
                      </td>
                      <td className="text-right mono">
                        {record.durationMs !== null
                          ? `${(record.durationMs / 1000).toFixed(1)}s`
                          : '-'}
                      </td>
                      <td>
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            record.success ? 'bg-green-500' : 'bg-red-500'
                          }`}
                          title={record.success ? 'Success' : 'Failed'}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface SummaryCardProps {
  title: string;
  value: string;
  icon: string;
  highlight?: boolean;
}

function SummaryCard({ title, value, icon, highlight }: SummaryCardProps) {
  return (
    <div className={`card p-4 ${highlight ? 'border-info/30' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-tertiary uppercase tracking-wide">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${highlight ? 'text-info' : ''}`}>
            {value}
          </p>
        </div>
        <div
          className={`p-3 rounded-lg ${
            highlight ? 'bg-info/10' : 'bg-tertiary'
          }`}
        >
          <svg
            className={`w-6 h-6 ${highlight ? 'text-info' : 'text-secondary'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d={icon}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
