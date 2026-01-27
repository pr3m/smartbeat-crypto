'use client';

import { useState, useMemo } from 'react';
import { useToast } from './Toast';
import { InlineChat } from './chat';
import type { PositionEvaluation, PositionHealthMetrics, MarketSnapshot } from '@/lib/ai/types';

interface PositionAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  positionId: string;
  positionData: {
    pair: string;
    side: 'long' | 'short';
    leverage: number;
    entryPrice: number;
    currentPrice: number;
    liquidationPrice: number;
    volume: number;
    unrealizedPnl: number;
    pnlPercent: number;
    marginUsed: number;
    hoursOpen: number;
  };
  health: PositionHealthMetrics;
  marketSnapshot?: MarketSnapshot;
}

export function PositionAnalysisModal({
  isOpen,
  onClose,
  positionId,
  positionData,
  health,
  marketSnapshot,
}: PositionAnalysisModalProps) {
  const [loading, setLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<PositionEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          positionData,
          health,
          marketSnapshot,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to analyze position');
      }

      setEvaluation(result.evaluation);
      addToast({
        title: 'Analysis Complete',
        message: `Recommendation: ${result.evaluation.recommendation}`,
        type: 'success',
        duration: 5000,
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
      setLoading(false);
    }
  };

  // Build context message for inline chat
  const chatContextMessage = useMemo(() => {
    let context = `Current Position Analysis Context:
- Pair: ${positionData.pair}
- Side: ${positionData.side.toUpperCase()}
- Leverage: ${positionData.leverage}x
- Entry Price: €${positionData.entryPrice.toFixed(4)}
- Current Price: €${positionData.currentPrice.toFixed(4)}
- Liquidation Price: ${positionData.liquidationPrice <= 0 ? 'Very Safe (no liquidation)' : `€${positionData.liquidationPrice.toFixed(4)}`}
- Volume: ${positionData.volume.toFixed(4)}
- Unrealized P&L: €${positionData.unrealizedPnl.toFixed(2)} (${positionData.pnlPercent >= 0 ? '+' : ''}${positionData.pnlPercent.toFixed(2)}%)
- Margin Used: €${positionData.marginUsed.toFixed(2)}
- Hours Open: ${positionData.hoursOpen.toFixed(1)}

Health Metrics:
- Risk Level: ${health.riskLevel}
- Liquidation Distance: ${health.liquidationDistance.toFixed(2)}% (${health.liquidationStatus})
- Margin Level: ${health.marginLevel.toFixed(2)}% (${health.marginStatus})
- Time Status: ${health.timeStatus || 'normal'}
- Risk Factors: ${health.riskFactors.length > 0 ? health.riskFactors.join(', ') : 'None'}`;

    if (evaluation) {
      context += `

AI Evaluation Result:
- Recommendation: ${evaluation.recommendation}
- Conviction: ${evaluation.conviction}
- Confidence: ${evaluation.confidence}%
- Market Alignment: ${evaluation.marketAlignment}
- Risk Level: ${evaluation.riskAssessment.level}
- Risk Factors: ${evaluation.riskAssessment.factors.join(', ') || 'None'}
- Rationale: ${evaluation.rationale}`;

      if (evaluation.suggestedStopLoss) {
        context += `\n- Suggested Stop Loss: €${evaluation.suggestedStopLoss.toFixed(4)}`;
      }
      if (evaluation.suggestedTakeProfit) {
        context += `\n- Suggested Take Profit: €${evaluation.suggestedTakeProfit.toFixed(4)}`;
      }
      if (evaluation.actionItems.length > 0) {
        context += `\n- Action Items: ${evaluation.actionItems.join('; ')}`;
      }
    }

    return context;
  }, [positionData, health, evaluation]);

  if (!isOpen) return null;

  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case 'CLOSE':
        return 'bg-red-500/20 text-red-400 border-red-500';
      case 'REDUCE':
        return 'bg-orange-500/20 text-orange-400 border-orange-500';
      case 'ADD':
        return 'bg-green-500/20 text-green-400 border-green-500';
      default:
        return 'bg-blue-500/20 text-blue-400 border-blue-500';
    }
  };

  const getAlignmentColor = (alignment: string) => {
    switch (alignment) {
      case 'aligned':
        return 'text-green-400';
      case 'opposing':
        return 'text-red-400';
      default:
        return 'text-yellow-400';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-secondary border border-primary rounded-xl max-w-lg w-full max-h-[90vh] overflow-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-secondary border-b border-primary p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Position Analysis</h2>
            <p className="text-xs text-tertiary">
              {positionData.pair} • {positionData.side.toUpperCase()} {positionData.leverage}x
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-tertiary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Position Summary */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-tertiary/30 rounded-lg p-3">
              <div className="text-xs text-tertiary">Entry Price</div>
              <div className="font-semibold mono">€{positionData.entryPrice.toFixed(4)}</div>
            </div>
            <div className="bg-tertiary/30 rounded-lg p-3">
              <div className="text-xs text-tertiary">Current Price</div>
              <div className="font-semibold mono">€{positionData.currentPrice.toFixed(4)}</div>
            </div>
            <div className="bg-tertiary/30 rounded-lg p-3">
              <div className="text-xs text-tertiary">Unrealized P&L</div>
              <div className={`font-semibold mono ${positionData.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {positionData.unrealizedPnl >= 0 ? '+' : ''}€{positionData.unrealizedPnl.toFixed(2)}
              </div>
            </div>
            <div className="bg-tertiary/30 rounded-lg p-3">
              <div className="text-xs text-tertiary">Liquidation</div>
              <div className={`font-semibold mono ${positionData.liquidationPrice <= 0 ? 'text-green-400' : 'text-orange-400'}`}>
                {positionData.liquidationPrice <= 0 ? 'Very Safe' : `€${positionData.liquidationPrice.toFixed(4)}`}
              </div>
            </div>
          </div>

          {/* Analyze Button */}
          {!evaluation && (
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className={`w-full py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                loading
                  ? 'bg-purple-500/20 text-purple-400 cursor-wait'
                  : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white'
              }`}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Analyzing with AI...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Analyze Position
                </>
              )}
            </button>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/20 border border-red-500/50 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Evaluation Result */}
          {evaluation && (
            <div className="space-y-4">
              {/* Recommendation Badge */}
              <div className={`p-4 rounded-lg border-2 text-center ${getRecommendationColor(evaluation.recommendation)}`}>
                <div className="text-2xl font-bold">{evaluation.recommendation}</div>
                <div className="text-sm capitalize mt-1">
                  {evaluation.conviction} conviction • {evaluation.confidence}% confidence
                </div>
              </div>

              {/* Market Alignment */}
              <div className="flex items-center justify-between p-3 bg-tertiary/30 rounded-lg">
                <span className="text-sm text-tertiary">Market Alignment</span>
                <span className={`font-semibold capitalize ${getAlignmentColor(evaluation.marketAlignment)}`}>
                  {evaluation.marketAlignment}
                </span>
              </div>

              {/* Suggested Levels */}
              {(evaluation.suggestedStopLoss || evaluation.suggestedTakeProfit) && (
                <div className="grid grid-cols-2 gap-3">
                  {evaluation.suggestedStopLoss && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                      <div className="text-xs text-tertiary">Suggested Stop Loss</div>
                      <div className="font-semibold mono text-red-400">
                        €{evaluation.suggestedStopLoss.toFixed(4)}
                      </div>
                    </div>
                  )}
                  {evaluation.suggestedTakeProfit && (
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                      <div className="text-xs text-tertiary">Suggested Take Profit</div>
                      <div className="font-semibold mono text-green-400">
                        €{evaluation.suggestedTakeProfit.toFixed(4)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Risk Assessment */}
              <div className="p-3 rounded-lg bg-tertiary/30">
                <div className="text-xs text-tertiary mb-2">Risk Assessment</div>
                <div className={`font-semibold capitalize mb-2 ${
                  evaluation.riskAssessment.level === 'extreme' ? 'text-red-400' :
                  evaluation.riskAssessment.level === 'high' ? 'text-orange-400' :
                  evaluation.riskAssessment.level === 'medium' ? 'text-yellow-400' :
                  'text-green-400'
                }`}>
                  {evaluation.riskAssessment.level} Risk
                </div>
                {evaluation.riskAssessment.factors.length > 0 && (
                  <ul className="text-xs space-y-1 text-secondary">
                    {evaluation.riskAssessment.factors.map((factor, i) => (
                      <li key={i}>• {factor}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Rationale */}
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <div className="text-xs text-purple-400 mb-1">AI Rationale</div>
                <p className="text-sm text-secondary">{evaluation.rationale}</p>
              </div>

              {/* Action Items */}
              {evaluation.actionItems.length > 0 && (
                <div className="p-3 rounded-lg bg-tertiary/30">
                  <div className="text-xs text-tertiary mb-2">Action Items</div>
                  <ul className="text-sm space-y-1">
                    {evaluation.actionItems.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-blue-400 mt-0.5">→</span>
                        <span className="text-secondary">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Re-analyze Button */}
              <button
                onClick={() => {
                  setEvaluation(null);
                  setError(null);
                }}
                className="w-full py-2 text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                Run Analysis Again
              </button>

              {/* Inline Chat for Follow-up Questions */}
              <InlineChat
                contextMessage={chatContextMessage}
                context="trading"
                title="Ask Follow-up Questions"
                placeholder="Ask about this position..."
                maxHeight="200px"
              />
            </div>
          )}

          {/* Show inline chat even without evaluation for general position questions */}
          {!evaluation && !loading && (
            <InlineChat
              contextMessage={chatContextMessage}
              context="trading"
              title="Ask About This Position"
              placeholder="Ask a question about this position..."
              maxHeight="200px"
            />
          )}
        </div>
      </div>
    </div>
  );
}
