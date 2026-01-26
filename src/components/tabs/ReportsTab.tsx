'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { AIAnalysisPanel } from '@/components/AIAnalysisPanel';
import type { AIAnalysisResponse, AITradeData } from '@/lib/ai/types';

interface AIReport {
  id: string;
  pair: string;
  model: string;
  action: string;
  conviction: string | null;
  confidence: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  targets: Array<{ level?: number; price?: number; probability?: number }> | null;
  riskReward: number | null;
  analysis: string;
  inputData: string;
  tokens: { input: number; output: number; total: number } | null;
  priceAtAnalysis: number | null;
  createdAt: string;
}

interface ReportsTabProps {
  onReportsCountChange?: (count: number) => void;
}

type ActionFilter = 'all' | 'LONG' | 'SHORT' | 'WAIT';

export function ReportsTab({ onReportsCountChange }: ReportsTabProps) {
  const { addToast } = useToast();
  const [reports, setReports] = useState<AIReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<ActionFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const LIMIT = 20;

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(offset),
      });
      if (filter !== 'all') {
        params.set('action', filter);
      }

      const res = await fetch(`/api/ai/reports?${params}`);
      const data = await res.json();

      if (data.success) {
        setReports(data.reports);
        setTotal(data.total);
        onReportsCountChange?.(data.total);
      }
    } catch (error) {
      console.error('Failed to fetch reports:', error);
      addToast({
        title: 'Failed to load reports',
        message: 'Could not fetch AI analysis history',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [offset, filter, addToast, onReportsCountChange]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this analysis report?')) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/ai/reports?id=${id}`, { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        addToast({
          title: 'Report Deleted',
          message: 'Analysis removed from history',
          type: 'success',
        });
        fetchReports();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      addToast({
        title: 'Delete Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleFilterChange = (newFilter: ActionFilter) => {
    setFilter(newFilter);
    setOffset(0);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (days === 1) {
      return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  // Convert report to AIAnalysisResponse format for the panel
  const reportToAnalysisResponse = (report: AIReport): AIAnalysisResponse => {
    const tradeData: AITradeData | null = report.action ? {
      action: report.action as 'LONG' | 'SHORT' | 'WAIT',
      conviction: (report.conviction as 'high' | 'medium' | 'low') || 'medium',
      entry: report.entryLow && report.entryHigh ? { low: report.entryLow, high: report.entryHigh } : null,
      stopLoss: report.stopLoss,
      targets: report.targets,
      riskReward: report.riskReward,
      confidence: report.confidence || 50,
    } : null;

    return {
      analysis: report.analysis,
      tradeData,
      model: report.model,
      timestamp: report.createdAt,
      inputData: report.inputData,
      tokens: report.tokens || { input: 0, output: 0, total: 0 },
    };
  };

  if (loading && reports.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI Analysis History</h2>
          <p className="text-sm text-secondary">
            {total} analysis report{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'LONG', 'SHORT', 'WAIT'] as ActionFilter[]).map(f => (
          <button
            key={f}
            onClick={() => handleFilterChange(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f
                ? f === 'LONG'
                  ? 'bg-green-500 text-white'
                  : f === 'SHORT'
                  ? 'bg-red-500 text-white'
                  : f === 'WAIT'
                  ? 'bg-yellow-500 text-black'
                  : 'bg-blue-500 text-white'
                : 'bg-tertiary text-secondary hover:bg-primary'
            }`}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {/* Reports List */}
      {reports.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-3">📊</div>
          <h3 className="text-lg font-semibold mb-1">No Reports Yet</h3>
          <p className="text-secondary text-sm">
            {filter === 'all'
              ? 'AI analysis reports will appear here after you run analyses.'
              : `No ${filter} analyses found.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(report => {
            const isExpanded = expandedId === report.id;
            const isDeleting = deletingId === report.id;

            return (
              <div key={report.id} className="card overflow-hidden">
                {/* Report Card Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-primary/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : report.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          report.action === 'LONG'
                            ? 'bg-green-500/20 text-green-400'
                            : report.action === 'SHORT'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {report.action}
                        </span>
                        {report.conviction && (
                          <span className={`text-xs ${
                            report.conviction === 'high'
                              ? 'text-green-400'
                              : report.conviction === 'medium'
                              ? 'text-yellow-400'
                              : 'text-gray-400'
                          }`}>
                            {report.conviction} conviction
                          </span>
                        )}
                        <span className="text-xs text-tertiary">{report.model}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        <div>
                          <span className="text-tertiary">Price: </span>
                          <span className="mono">€{report.priceAtAnalysis?.toFixed(4) || '-'}</span>
                        </div>
                        {report.confidence !== null && (
                          <div>
                            <span className="text-tertiary">Confidence: </span>
                            <span className={`${
                              report.confidence > 60 ? 'text-green-400' :
                              report.confidence > 40 ? 'text-yellow-400' : 'text-red-400'
                            }`}>{report.confidence}%</span>
                          </div>
                        )}
                        {report.riskReward && (
                          <div>
                            <span className="text-tertiary">R:R </span>
                            <span className="mono">{report.riskReward.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right flex flex-col items-end gap-2">
                      <div className="text-sm text-secondary">{formatDate(report.createdAt)}</div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(report.id);
                          }}
                          disabled={isDeleting}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                        >
                          {isDeleting ? '...' : 'Delete'}
                        </button>
                        <span className="text-tertiary">
                          {isExpanded ? '▲' : '▼'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Preview of analysis */}
                  {!isExpanded && (
                    <p className="text-sm text-secondary mt-2 line-clamp-2">
                      {report.analysis.split('\n')[0]?.substring(0, 150)}...
                    </p>
                  )}
                </div>

                {/* Expanded Analysis Panel */}
                {isExpanded && (
                  <div className="border-t border-primary">
                    <AIAnalysisPanel
                      analysis={reportToAnalysisResponse(report)}
                      onClose={() => setExpandedId(null)}
                      onCopyInput={() => {
                        navigator.clipboard.writeText(report.inputData);
                        addToast({ title: 'Copied', message: 'Input data copied', type: 'success', duration: 2000 });
                      }}
                      onCopyAnalysis={() => {
                        navigator.clipboard.writeText(report.analysis);
                        addToast({ title: 'Copied', message: 'Analysis copied', type: 'success', duration: 2000 });
                      }}
                      embedded
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-4">
          <button
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            disabled={offset === 0}
            className="px-4 py-2 rounded-lg bg-tertiary text-secondary hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-secondary">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + LIMIT)}
            disabled={currentPage >= totalPages}
            className="px-4 py-2 rounded-lg bg-tertiary text-secondary hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
