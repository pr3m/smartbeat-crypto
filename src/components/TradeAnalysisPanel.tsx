'use client';

import { useState } from 'react';
import { useToast } from './Toast';

interface TradeAnalysisResult {
  entryQuality?: string;
  whatWorked?: string[];
  whatDidntWork?: string[];
  lessonsLearned?: string[];
  suggestedImprovements?: string[];
  narrative?: string;
  // Batch analysis fields
  overallGrade?: string;
  winningPatterns?: string[];
  losingPatterns?: string[];
  riskManagement?: string;
  entryTiming?: string;
  topRecommendations?: string[];
}

interface TradeAnalysisPanelProps {
  positionId?: string;
  onClose?: () => void;
}

export function TradeAnalysisPanel({ positionId, onClose }: TradeAnalysisPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [parsed, setParsed] = useState<TradeAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  const runAnalysis = async (batch = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const body = batch ? { batch: true } : { positionId };
      const res = await fetch('/api/simulated/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      setAnalysis(data.analysis);
      setParsed(data.parsed);

      addToast({
        title: 'Analysis Complete',
        message: `Analyzed ${data.tradesAnalyzed} trade(s) using ${data.model}`,
        type: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      setError(message);
      addToast({
        title: 'Analysis Failed',
        message,
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-purple-400 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          AI Trade Analysis
        </h4>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 hover:bg-tertiary rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Action buttons */}
      {!analysis && (
        <div className="space-y-2">
          {positionId ? (
            <button
              onClick={() => runAnalysis(false)}
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold text-sm transition-all disabled:opacity-50"
            >
              {isLoading ? 'Analyzing...' : 'Analyze This Trade'}
            </button>
          ) : (
            <button
              onClick={() => runAnalysis(true)}
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold text-sm transition-all disabled:opacity-50"
            >
              {isLoading ? 'Analyzing...' : 'Analyze All Trades'}
            </button>
          )}
          <p className="text-xs text-tertiary text-center">
            Uses AI to identify patterns and provide actionable feedback
          </p>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-400 hover:text-red-300 mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Analysis results */}
      {parsed && (
        <div className="mt-4 space-y-4">
          {/* Entry Quality / Overall Grade */}
          {(parsed.entryQuality || parsed.overallGrade) && (
            <div className={`p-3 rounded-lg text-center ${
              ['excellent', 'A', 'B'].includes(parsed.entryQuality || parsed.overallGrade || '')
                ? 'bg-green-500/10 border border-green-500/30'
                : ['good', 'C'].includes(parsed.entryQuality || parsed.overallGrade || '')
                ? 'bg-yellow-500/10 border border-yellow-500/30'
                : 'bg-red-500/10 border border-red-500/30'
            }`}>
              <div className="text-xs text-tertiary mb-1">
                {parsed.entryQuality ? 'Entry Quality' : 'Overall Grade'}
              </div>
              <div className={`text-2xl font-bold ${
                ['excellent', 'A', 'B'].includes(parsed.entryQuality || parsed.overallGrade || '')
                  ? 'text-green-500'
                  : ['good', 'C'].includes(parsed.entryQuality || parsed.overallGrade || '')
                  ? 'text-yellow-500'
                  : 'text-red-500'
              }`}>
                {(parsed.entryQuality || parsed.overallGrade || '').toUpperCase()}
              </div>
            </div>
          )}

          {/* What Worked / Winning Patterns */}
          {(parsed.whatWorked?.length || parsed.winningPatterns?.length) && (
            <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
              <h5 className="text-xs text-green-400 uppercase tracking-wider mb-2">
                {parsed.whatWorked ? 'What Worked' : 'Winning Patterns'}
              </h5>
              <ul className="space-y-1">
                {(parsed.whatWorked || parsed.winningPatterns || []).map((item, i) => (
                  <li key={i} className="text-sm text-secondary flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">+</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* What Didn't Work / Losing Patterns */}
          {(parsed.whatDidntWork?.length || parsed.losingPatterns?.length) && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
              <h5 className="text-xs text-red-400 uppercase tracking-wider mb-2">
                {parsed.whatDidntWork ? 'What Didn\'t Work' : 'Losing Patterns'}
              </h5>
              <ul className="space-y-1">
                {(parsed.whatDidntWork || parsed.losingPatterns || []).map((item, i) => (
                  <li key={i} className="text-sm text-secondary flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">-</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Lessons / Recommendations */}
          {(parsed.lessonsLearned?.length || parsed.topRecommendations?.length) && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3">
              <h5 className="text-xs text-purple-400 uppercase tracking-wider mb-2">
                {parsed.lessonsLearned ? 'Lessons Learned' : 'Top Recommendations'}
              </h5>
              <ul className="space-y-1">
                {(parsed.lessonsLearned || parsed.topRecommendations || []).map((item, i) => (
                  <li key={i} className="text-sm text-secondary flex items-start gap-2">
                    <span className="text-purple-400 mt-0.5">{i + 1}.</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Improvements */}
          {parsed.suggestedImprovements?.length && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
              <h5 className="text-xs text-blue-400 uppercase tracking-wider mb-2">
                Suggested Improvements
              </h5>
              <ul className="space-y-1">
                {parsed.suggestedImprovements.map((item, i) => (
                  <li key={i} className="text-sm text-secondary flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">→</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Narrative Summary */}
          {parsed.narrative && (
            <div className="bg-tertiary rounded-lg p-3">
              <h5 className="text-xs text-tertiary uppercase tracking-wider mb-2">Summary</h5>
              <p className="text-sm text-secondary leading-relaxed">{parsed.narrative}</p>
            </div>
          )}

          {/* Run again button */}
          <button
            onClick={() => {
              setAnalysis(null);
              setParsed(null);
            }}
            className="w-full py-2 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            Run Another Analysis
          </button>
        </div>
      )}

      {/* Raw analysis fallback */}
      {analysis && !parsed && (
        <div className="mt-4">
          <div className="bg-tertiary rounded-lg p-3 text-sm text-secondary whitespace-pre-wrap max-h-60 overflow-y-auto">
            {analysis}
          </div>
        </div>
      )}
    </div>
  );
}
