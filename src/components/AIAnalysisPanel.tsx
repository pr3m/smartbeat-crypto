'use client';

import { useState, useMemo } from 'react';
import type { AIAnalysisResponse } from '@/lib/ai/types';
import { useToast } from './Toast';
import { useTradingData } from './TradingDataProvider';

interface AIAnalysisPanelProps {
  analysis: AIAnalysisResponse;
  onClose: () => void;
  onCopyInput: () => void;
  onCopyAnalysis: () => void;
  /** When true, renders in a more compact style without outer card wrapper */
  embedded?: boolean;
  /** Callback after draft orders are created */
  onDraftsCreated?: () => void;
  /** Current trading mode - drafts created here will be mode-specific */
  testMode?: boolean;
}

interface ParsedSection {
  title: string;
  content: string;
  type: 'assessment' | 'recommendation' | 'trade' | 'risk' | 'timeframe' | 'other';
}

/**
 * Parse the AI analysis text into structured sections
 */
function parseAnalysisSections(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];

  // Remove JSON code blocks (```json ... ```) from the text for display
  let textWithoutJson = text.replace(/```json[\s\S]*?```/g, '').trim();

  // Remove trailing raw JSON object only if it's clearly at the end and starts on its own line
  // Be careful not to remove too much - only match if it looks like a standalone JSON object
  const trailingJsonMatch = textWithoutJson.match(/\n\s*(\{[^{}]*"action"\s*:\s*"[^"]+?"[^{}]*(\{[^{}]*\}[^{}]*)*\})\s*$/);
  if (trailingJsonMatch) {
    textWithoutJson = textWithoutJson.slice(0, trailingJsonMatch.index).trim();
  }

  // If still empty after removing JSON, keep original (minus code blocks only)
  if (!textWithoutJson) {
    textWithoutJson = text.replace(/```json[\s\S]*?```/g, '').trim();
  }

  // Try multiple parsing strategies

  // Strategy 1: Look for numbered sections like "1)" or "1."
  const numberedPattern = /(?:^|\n)\s*(\d+)\s*[\.\)]\s*\*?\*?([^\n\*]+)\*?\*?\s*\n/g;
  let matches = [...textWithoutJson.matchAll(numberedPattern)];

  // Strategy 2: Look for markdown headers ## or ###
  if (matches.length === 0) {
    const headerPattern = /(?:^|\n)\s*(#{1,3})\s*([^\n]+)\n/g;
    matches = [...textWithoutJson.matchAll(headerPattern)];
  }

  // Strategy 3: Look for bold headers like **Header**
  if (matches.length === 0) {
    const boldPattern = /(?:^|\n)\s*\*\*([^\*\n]+)\*\*\s*:?\s*\n/g;
    matches = [...textWithoutJson.matchAll(boldPattern)];
  }

  if (matches.length > 0) {
    // Extract sections based on found headers
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const headerEnd = match.index! + match[0].length;
      const nextStart = i < matches.length - 1 ? matches[i + 1].index! : textWithoutJson.length;

      const title = match[2]?.trim() || match[1]?.trim() || 'Section';
      const content = textWithoutJson.slice(headerEnd, nextStart).trim();

      if (content) {
        // Determine section type from title
        const titleLower = title.toLowerCase();
        let type: ParsedSection['type'] = 'other';

        if (titleLower.includes('assessment') || titleLower.includes('overview') || titleLower.includes('market')) {
          type = 'assessment';
        } else if (titleLower.includes('recommendation') || titleLower.includes('signal') || titleLower.includes('action')) {
          type = 'recommendation';
        } else if (titleLower.includes('trade') || titleLower.includes('plan') || titleLower.includes('setup') || titleLower.includes('entry')) {
          type = 'trade';
        } else if (titleLower.includes('risk') || titleLower.includes('invalid') || titleLower.includes('warning')) {
          type = 'risk';
        } else if (titleLower.includes('time') || titleLower.includes('horizon') || titleLower.includes('holding')) {
          type = 'timeframe';
        }

        sections.push({ title, content, type });
      }
    }
  }

  // If still no sections found, treat whole text as one section
  if (sections.length === 0 && textWithoutJson.trim()) {
    sections.push({
      title: 'Analysis',
      content: textWithoutJson,
      type: 'other',
    });
  }

  return sections;
}

/**
 * Format content with better styling - returns JSX
 */
function FormattedContent({ content }: { content: string }) {
  // Process the content into formatted HTML
  const processedHtml = content
    // Bold text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-primary font-semibold">$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-tertiary px-1.5 py-0.5 rounded text-xs font-mono text-purple-300">$1</code>')
    // Price patterns
    .replace(/€(\d+\.\d{3,})/g, '<span class="font-mono text-blue-400 font-medium">€$1</span>')
    .replace(/(\d+\.\d{4,})(?!\d)/g, '<span class="font-mono text-blue-400">$1</span>')
    // Percentages
    .replace(/(\d+(?:\.\d+)?%)/g, '<span class="font-mono text-yellow-400">$1</span>')
    // R:R patterns
    .replace(/R:R\s*[~≈]?\s*(\d+(?:\.\d+)?)/gi, '<span class="font-mono text-green-400 font-medium">R:R $1</span>')
    // Convert bullet points
    .replace(/^[•\-\*·]\s*/gm, '• ')
    // Line breaks
    .replace(/\n/g, '<br/>');

  return (
    <div
      className="text-sm text-secondary leading-relaxed"
      dangerouslySetInnerHTML={{ __html: processedHtml }}
    />
  );
}

/**
 * Get section icon and color
 */
function getSectionStyle(type: ParsedSection['type']) {
  switch (type) {
    case 'assessment':
      return { icon: '📊', borderColor: 'border-blue-500/30', bgColor: 'bg-blue-500/5', headerBg: 'bg-blue-500/10' };
    case 'recommendation':
      return { icon: '🎯', borderColor: 'border-purple-500/30', bgColor: 'bg-purple-500/5', headerBg: 'bg-purple-500/10' };
    case 'trade':
      return { icon: '📈', borderColor: 'border-green-500/30', bgColor: 'bg-green-500/5', headerBg: 'bg-green-500/10' };
    case 'risk':
      return { icon: '⚠️', borderColor: 'border-red-500/30', bgColor: 'bg-red-500/5', headerBg: 'bg-red-500/10' };
    case 'timeframe':
      return { icon: '⏱️', borderColor: 'border-yellow-500/30', bgColor: 'bg-yellow-500/5', headerBg: 'bg-yellow-500/10' };
    default:
      return { icon: '📝', borderColor: 'border-gray-500/30', bgColor: 'bg-gray-500/5', headerBg: 'bg-gray-500/10' };
  }
}

export function AIAnalysisPanel({ analysis, onClose, onCopyInput, onCopyAnalysis, embedded = false, onDraftsCreated, testMode = true }: AIAnalysisPanelProps) {
  const [showDebug, setShowDebug] = useState(false);
  const [creatingDrafts, setCreatingDrafts] = useState(false);
  const [conditionalSetupsExpanded, setConditionalSetupsExpanded] = useState(true);
  const { addToast } = useToast();
  const { refreshDraftOrders, simulatedBalance } = useTradingData();

  // Safely get analysis text - handle non-string responses from GPT-5.2
  const analysisText = (() => {
    const raw: unknown = analysis?.analysis;
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      // GPT-5 content blocks format
      return (raw as unknown[]).map((block: unknown) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) return (block as { text: string }).text;
        return '';
      }).join('');
    }
    // Object or other - stringify it
    return JSON.stringify(raw, null, 2);
  })();

  // Parse sections from analysis text
  const sections = useMemo(() => parseAnalysisSections(analysisText), [analysisText]);

  // Extract trade data
  const tradeData = analysis?.tradeData;

  // Check if we have any content to show
  const hasContent = sections.length > 0 || tradeData;

  // Check if we can create draft orders (has actionable trade recommendation)
  const canCreateDrafts = tradeData &&
    tradeData.action !== 'WAIT' &&
    tradeData.entry &&
    tradeData.entry.low != null &&
    tradeData.entry.high != null;

  // Create draft orders from trade data
  const handleCreateDraftOrders = async () => {
    if (!tradeData || !canCreateDrafts) return;

    setCreatingDrafts(true);
    const createdDrafts: string[] = [];

    try {
      // Determine side from action
      const side = tradeData.action === 'LONG' ? 'buy' : 'sell';
      const oppositeSide = side === 'buy' ? 'sell' : 'buy';

      // Calculate entry price (midpoint of zone)
      const entryLow = tradeData.entry!.low;
      const entryHigh = tradeData.entry!.high;
      const entryPrice = (entryLow + entryHigh) / 2;

      // Calculate volume from position size
      const positionSizePct = tradeData.positionSizePct || 1;
      const availableMargin = simulatedBalance?.freeMargin || 1000;
      const leverage = 10;
      const marginToUse = (availableMargin * positionSizePct) / 100;
      const positionValue = marginToUse * leverage;
      const volume = entryPrice > 0 ? positionValue / entryPrice : 100;

      // 1. Create entry order (limit at entry midpoint)
      const entryRes = await fetch('/api/draft-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: 'XRPEUR',
          side,
          orderType: 'limit',
          price: entryPrice,
          volume,
          leverage,
          source: 'ai',
          aiSetupType: `${tradeData.action}_ENTRY`,
          activationCriteria: [`Entry zone: ${entryLow.toFixed(4)} - ${entryHigh.toFixed(4)}`],
          positionSizePct,
          testMode,
        }),
      });
      if (entryRes.ok) {
        const data = await entryRes.json();
        createdDrafts.push(data.draft?.id);
      }

      // 2. Create stop loss order
      if (tradeData.stopLoss != null) {
        const slRes = await fetch('/api/draft-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: 'XRPEUR',
            side: oppositeSide,
            orderType: 'stop-loss',
            price: tradeData.stopLoss,
            volume,
            leverage,
            source: 'ai',
            aiSetupType: `${tradeData.action}_SL`,
            testMode,
          }),
        });
        if (slRes.ok) {
          const data = await slRes.json();
          createdDrafts.push(data.draft?.id);
        }
      }

      // 3. Create take profit orders
      if (tradeData.targets && tradeData.targets.length > 0) {
        let remainingVolume = volume;

        for (let i = 0; i < tradeData.targets.length; i++) {
          const target = tradeData.targets[i];
          const targetPrice = typeof target.price === 'string' ? parseFloat(target.price) : Number(target.price);

          if (!targetPrice || isNaN(targetPrice)) continue;

          // Calculate volume for this target
          let targetVolume: number;
          if (i === tradeData.targets.length - 1) {
            targetVolume = remainingVolume;
          } else {
            const prob = target.probability != null ? Number(target.probability) : 0.33;
            targetVolume = Math.max(volume * 0.1, volume * prob * 0.5);
            targetVolume = Math.min(targetVolume, remainingVolume * 0.8);
            remainingVolume -= targetVolume;
          }

          const tpRes = await fetch('/api/draft-orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pair: 'XRPEUR',
              side: oppositeSide,
              orderType: 'take-profit',
              price: targetPrice,
              volume: targetVolume,
              leverage,
              source: 'ai',
              aiSetupType: `${tradeData.action}_TP${i + 1}`,
              testMode,
            }),
          });
          if (tpRes.ok) {
            const data = await tpRes.json();
            createdDrafts.push(data.draft?.id);
          }
        }
      }

      // Success notification
      addToast({
        title: 'Draft Orders Created',
        message: `Created ${createdDrafts.length} draft orders from AI analysis`,
        type: 'success',
      });

      // Refresh draft orders list
      refreshDraftOrders(true);
      onDraftsCreated?.();

    } catch (error) {
      console.error('Error creating draft orders:', error);
      addToast({
        title: 'Error Creating Drafts',
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
      });
    } finally {
      setCreatingDrafts(false);
    }
  };

  // Track which conditional setup is being created
  const [creatingSetupIndex, setCreatingSetupIndex] = useState<number | null>(null);

  // Create draft orders from a conditional setup
  const handleCreateFromConditionalSetup = async (setup: {
    type: string;
    entryZone: [string, string];
    stopLoss: string;
    targets: Array<{ price: string; probability: number }>;
    positionSizePct?: number;
    activationCriteria?: string[];
    invalidation?: string[];
  }, index: number) => {
    setCreatingSetupIndex(index);
    const createdDrafts: string[] = [];

    try {
      // Determine side from setup type
      const setupType = setup.type.toUpperCase();
      const side = setupType.includes('SHORT') ? 'sell' : 'buy';
      const oppositeSide = side === 'buy' ? 'sell' : 'buy';

      // Parse prices
      const entryLow = parseFloat(setup.entryZone[0]);
      const entryHigh = parseFloat(setup.entryZone[1]);
      const entryPrice = (entryLow + entryHigh) / 2;
      const stopLossPrice = parseFloat(setup.stopLoss);

      // Calculate volume
      const positionSizePct = setup.positionSizePct || 1;
      const availableMargin = simulatedBalance?.freeMargin || 1000;
      const leverage = 10;
      const marginToUse = (availableMargin * positionSizePct) / 100;
      const positionValue = marginToUse * leverage;
      const volume = entryPrice > 0 ? positionValue / entryPrice : 100;

      // 1. Create entry order
      const entryRes = await fetch('/api/draft-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: 'XRPEUR',
          side,
          orderType: 'limit',
          price: entryPrice,
          volume,
          leverage,
          source: 'ai',
          aiSetupType: setup.type,
          activationCriteria: setup.activationCriteria,
          invalidation: setup.invalidation,
          positionSizePct,
          testMode,
        }),
      });
      if (entryRes.ok) {
        const data = await entryRes.json();
        createdDrafts.push(data.draft?.id);
      }

      // 2. Create stop loss order
      if (stopLossPrice > 0) {
        const slRes = await fetch('/api/draft-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: 'XRPEUR',
            side: oppositeSide,
            orderType: 'stop-loss',
            price: stopLossPrice,
            volume,
            leverage,
            source: 'ai',
            aiSetupType: `${setup.type}_SL`,
            testMode,
          }),
        });
        if (slRes.ok) {
          const data = await slRes.json();
          createdDrafts.push(data.draft?.id);
        }
      }

      // 3. Create take profit orders
      if (setup.targets && setup.targets.length > 0) {
        let remainingVolume = volume;

        for (let i = 0; i < setup.targets.length; i++) {
          const target = setup.targets[i];
          const targetPrice = parseFloat(target.price);

          if (!targetPrice || isNaN(targetPrice)) continue;

          let targetVolume: number;
          if (i === setup.targets.length - 1) {
            targetVolume = remainingVolume;
          } else {
            const prob = target.probability || 0.33;
            targetVolume = Math.max(volume * 0.1, volume * prob * 0.5);
            targetVolume = Math.min(targetVolume, remainingVolume * 0.8);
            remainingVolume -= targetVolume;
          }

          const tpRes = await fetch('/api/draft-orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pair: 'XRPEUR',
              side: oppositeSide,
              orderType: 'take-profit',
              price: targetPrice,
              volume: targetVolume,
              leverage,
              source: 'ai',
              aiSetupType: `${setup.type}_TP${i + 1}`,
              testMode,
            }),
          });
          if (tpRes.ok) {
            const data = await tpRes.json();
            createdDrafts.push(data.draft?.id);
          }
        }
      }

      addToast({
        title: 'Draft Orders Created',
        message: `Created ${createdDrafts.length} drafts for ${setup.type}`,
        type: 'success',
      });

      refreshDraftOrders(true);
      onDraftsCreated?.();

    } catch (error) {
      console.error('Error creating draft orders:', error);
      addToast({
        title: 'Error Creating Drafts',
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
      });
    } finally {
      setCreatingSetupIndex(null);
    }
  };

  return (
    <div className={embedded ? '' : 'card border border-purple-500/30 bg-gradient-to-br from-purple-900/20 to-blue-900/20 overflow-hidden'}>
      {/* Header - hide in embedded mode */}
      {!embedded && (
        <div className="px-4 py-3 border-b border-purple-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
            <h3 className="text-sm font-semibold text-purple-400">AI Trade Analysis</h3>
          </div>
          <button
            onClick={onClose}
            className="text-tertiary hover:text-secondary transition-colors p-1 hover:bg-tertiary rounded"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Meta info bar */}
      <div className="px-4 py-2 bg-primary/30 flex items-center justify-between flex-wrap gap-2 text-xs border-b border-purple-500/10">
        <div className="flex items-center gap-3 text-tertiary">
          <span className="px-2 py-0.5 bg-purple-500/20 rounded text-purple-400 font-medium">{analysis.model}</span>
          <span>{new Date(analysis.timestamp).toLocaleTimeString()}</span>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            {(analysis.tokens?.total ?? 0).toLocaleString()} tokens
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onCopyInput}
            className="p-1.5 rounded hover:bg-purple-500/20 text-tertiary hover:text-purple-400 transition-colors"
            title="Copy input data"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
          </button>
          <button
            onClick={onCopyAnalysis}
            className="p-1.5 rounded hover:bg-purple-500/20 text-tertiary hover:text-purple-400 transition-colors"
            title="Copy analysis"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Trade Signal Summary (from tradeData if available) */}
      {tradeData && tradeData.action && (
        <div className="px-4 py-3 border-b border-purple-500/20">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Signal */}
            <div className={`p-3 rounded-lg text-center ${
              tradeData.action === 'LONG' ? 'bg-green-500/10 border border-green-500/30' :
              tradeData.action === 'SHORT' ? 'bg-red-500/10 border border-red-500/30' :
              'bg-yellow-500/10 border border-yellow-500/30'
            }`}>
              <div className="text-[10px] text-tertiary uppercase tracking-wider mb-0.5">Signal</div>
              <div className={`text-xl font-bold ${
                tradeData.action === 'LONG' ? 'text-green-500' :
                tradeData.action === 'SHORT' ? 'text-red-500' :
                'text-yellow-500'
              }`}>{tradeData.action}</div>
              {tradeData.conviction && (
                <div className="text-[10px] text-secondary capitalize">{tradeData.conviction} conviction</div>
              )}
            </div>

            {/* Confidence */}
            {tradeData.confidence != null && (
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-center">
                <div className="text-[10px] text-tertiary uppercase tracking-wider mb-0.5">Confidence</div>
                <div className="text-xl font-bold text-purple-400">{tradeData.confidence}%</div>
                <div className="w-full h-1 bg-primary rounded-full mt-1">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${tradeData.confidence}%` }}
                  />
                </div>
              </div>
            )}

            {/* Entry Zone */}
            {tradeData.entry && tradeData.entry.low != null && tradeData.entry.high != null && (
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                <div className="text-[10px] text-tertiary uppercase tracking-wider mb-0.5">Entry Zone</div>
                <div className="text-sm font-mono text-blue-400">
                  €{tradeData.entry.low.toFixed(4)}
                </div>
                <div className="text-sm font-mono text-blue-400">
                  €{tradeData.entry.high.toFixed(4)}
                </div>
              </div>
            )}

            {/* Stop Loss */}
            {tradeData.stopLoss != null && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-center">
                <div className="text-[10px] text-tertiary uppercase tracking-wider mb-0.5">Stop Loss</div>
                <div className="text-lg font-mono font-bold text-red-400">
                  €{tradeData.stopLoss.toFixed(4)}
                </div>
              </div>
            )}
          </div>

          {/* Targets Row */}
          {tradeData.targets && tradeData.targets.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {tradeData.targets
                .filter((target: { price?: number | string | null }) => target?.price != null)
                .slice(0, 3)
                .map((target: { level?: number; price?: number | string | null; probability?: number | null }, i: number) => {
                  const price = typeof target.price === 'string' ? parseFloat(target.price) : Number(target.price);
                  const prob = target.probability != null ? Number(target.probability) : null;
                  if (isNaN(price)) return null;
                  return (
                    <div key={i} className="p-2 rounded bg-green-500/10 border border-green-500/20 text-center">
                      <div className="text-[10px] text-tertiary">TP{target.level || i + 1}</div>
                      <div className="text-sm font-mono text-green-400">€{price.toFixed(4)}</div>
                      {prob != null && !isNaN(prob) && (
                        <div className="text-[10px] text-green-400/70">{(prob * 100).toFixed(0)}%</div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* Key Levels */}
          {tradeData.keyLevels && (
            <div className="mt-3 flex gap-4 text-xs">
              {tradeData.keyLevels.support && tradeData.keyLevels.support.filter((p: unknown) => p != null).length > 0 && (
                <div className="flex-1">
                  <span className="text-tertiary">Support: </span>
                  <span className="text-green-400 font-mono">
                    {tradeData.keyLevels.support
                      .filter((p: unknown) => p != null)
                      .slice(0, 3)
                      .map((p: unknown) => {
                        // Handle object format {price: number} or direct number/string
                        let num: number;
                        if (typeof p === 'object' && p !== null && 'price' in p) {
                          num = Number((p as { price: unknown }).price);
                        } else if (typeof p === 'string') {
                          num = parseFloat(p);
                        } else {
                          num = Number(p);
                        }
                        return isNaN(num) ? JSON.stringify(p) : `€${num.toFixed(4)}`;
                      })
                      .join(', ')}
                  </span>
                </div>
              )}
              {tradeData.keyLevels.resistance && tradeData.keyLevels.resistance.filter((p: unknown) => p != null).length > 0 && (
                <div className="flex-1">
                  <span className="text-tertiary">Resistance: </span>
                  <span className="text-red-400 font-mono">
                    {tradeData.keyLevels.resistance
                      .filter((p: unknown) => p != null)
                      .slice(0, 3)
                      .map((p: unknown) => {
                        // Handle object format {price: number} or direct number/string
                        let num: number;
                        if (typeof p === 'object' && p !== null && 'price' in p) {
                          num = Number((p as { price: unknown }).price);
                        } else if (typeof p === 'string') {
                          num = parseFloat(p);
                        } else {
                          num = Number(p);
                        }
                        return isNaN(num) ? JSON.stringify(p) : `€${num.toFixed(4)}`;
                      })
                      .join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Create Draft Orders Button */}
          {canCreateDrafts && (
            <div className="mt-4 pt-3 border-t border-purple-500/20">
              <button
                onClick={handleCreateDraftOrders}
                disabled={creatingDrafts}
                className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 border-2 border-dashed border-purple-500/50 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingDrafts ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating Drafts...
                  </>
                ) : (
                  <>
                    <span>📋</span>
                    Create Draft Orders
                    <span className="text-xs opacity-70">
                      (Entry + SL{tradeData.targets && tradeData.targets.length > 0 ? ` + ${tradeData.targets.length} TP` : ''})
                    </span>
                  </>
                )}
              </button>
              <p className="text-xs text-tertiary text-center mt-2">
                Creates draft orders from this trade plan. Review before submitting.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Conditional Setups Section */}
      {tradeData?.conditionalSetups && tradeData.conditionalSetups.length > 0 && (
        <div className="px-4 py-3 border-b border-purple-500/20">
          <button
            onClick={() => setConditionalSetupsExpanded(!conditionalSetupsExpanded)}
            className="w-full text-left text-xs text-tertiary uppercase tracking-wider mb-3 flex items-center gap-2 hover:text-secondary transition-colors"
          >
            <span className={`transition-transform ${conditionalSetupsExpanded ? '' : '-rotate-90'}`}>▼</span>
            <span>🎯</span>
            Conditional Trade Setups
            <span className="text-purple-400 font-normal normal-case">
              (activate when conditions are met)
            </span>
            <span className="ml-auto text-tertiary font-normal normal-case">
              {tradeData.conditionalSetups.length} setup{tradeData.conditionalSetups.length !== 1 ? 's' : ''}
            </span>
          </button>

          {conditionalSetupsExpanded && <div className="space-y-3">
            {tradeData.conditionalSetups.map((setup, i) => {
              const isShort = setup.type.toUpperCase().includes('SHORT');
              const entryLow = parseFloat(setup.entryZone[0]);
              const entryHigh = parseFloat(setup.entryZone[1]);
              const entryMid = (entryLow + entryHigh) / 2;
              const stopLoss = parseFloat(setup.stopLoss);

              return (
                <div
                  key={i}
                  className={`rounded-lg border-2 border-dashed p-3 ${
                    isShort
                      ? 'border-red-500/40 bg-red-500/5'
                      : 'border-green-500/40 bg-green-500/5'
                  }`}
                >
                  {/* Setup Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        isShort ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                      }`}>
                        {isShort ? 'SHORT' : 'LONG'}
                      </span>
                      <span className="text-sm font-semibold text-primary">
                        {setup.type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {setup.positionSizePct && (
                      <span className="text-xs text-tertiary">
                        {setup.positionSizePct}% capital
                      </span>
                    )}
                  </div>

                  {/* Price Levels */}
                  <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                    <div className="p-2 rounded bg-blue-500/10 text-center">
                      <div className="text-tertiary">Entry Zone</div>
                      <div className="font-mono text-blue-400">
                        €{entryLow.toFixed(4)} - €{entryHigh.toFixed(4)}
                      </div>
                    </div>
                    <div className="p-2 rounded bg-red-500/10 text-center">
                      <div className="text-tertiary">Stop Loss</div>
                      <div className="font-mono text-red-400">€{stopLoss.toFixed(4)}</div>
                    </div>
                    <div className="p-2 rounded bg-green-500/10 text-center">
                      <div className="text-tertiary">Targets</div>
                      <div className="font-mono text-green-400">
                        {setup.targets.length} level{setup.targets.length > 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>

                  {/* Targets Detail */}
                  {setup.targets.length > 0 && (
                    <div className="flex gap-1 mb-3">
                      {setup.targets.slice(0, 3).map((t, ti) => (
                        <div key={ti} className="flex-1 p-1.5 rounded bg-green-500/10 text-center text-xs">
                          <span className="text-tertiary">TP{ti + 1}: </span>
                          <span className="font-mono text-green-400">€{parseFloat(t.price).toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Activation Criteria */}
                  {setup.activationCriteria && setup.activationCriteria.length > 0 && (
                    <div className="mb-2 p-2 rounded bg-blue-500/10 border border-blue-500/20">
                      <div className="text-xs text-blue-400 mb-1 font-semibold">
                        Activation Criteria:
                      </div>
                      <ul className="text-xs text-blue-300 space-y-0.5">
                        {setup.activationCriteria.slice(0, 3).map((crit, ci) => (
                          <li key={ci}>• {crit}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Invalidation */}
                  {setup.invalidation && setup.invalidation.length > 0 && (
                    <div className="mb-3 p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
                      <div className="text-xs text-yellow-400 mb-1 font-semibold">
                        Invalid if:
                      </div>
                      <ul className="text-xs text-yellow-300 space-y-0.5">
                        {setup.invalidation.slice(0, 2).map((inv, ii) => (
                          <li key={ii}>• {inv}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Create Draft Button */}
                  <button
                    onClick={() => handleCreateFromConditionalSetup(setup, i)}
                    disabled={creatingSetupIndex !== null}
                    className={`w-full py-2 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 border-2 border-dashed disabled:opacity-50 disabled:cursor-not-allowed ${
                      isShort
                        ? 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500'
                        : 'border-green-500/50 bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:border-green-500'
                    }`}
                  >
                    {creatingSetupIndex === i ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Creating...
                      </>
                    ) : (
                      <>
                        <span>📋</span>
                        Create Draft Orders
                        <span className="text-xs opacity-70">
                          (Entry + SL + {setup.targets.length} TP)
                        </span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>}
        </div>
      )}

      {/* Analysis Sections */}
      <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
        {sections.length > 0 ? (
          // Render parsed sections
          sections.map((section, i) => {
            const style = getSectionStyle(section.type);
            return (
              <div
                key={i}
                className={`rounded-lg border ${style.borderColor} ${style.bgColor} overflow-hidden`}
              >
                <div className={`px-3 py-2 ${style.headerBg} border-b border-primary/20 flex items-center gap-2`}>
                  <span>{style.icon}</span>
                  <span className="text-sm font-semibold text-primary">{section.title}</span>
                </div>
                <div className="px-3 py-3">
                  <FormattedContent content={section.content} />
                </div>
              </div>
            );
          })
        ) : (
          // Fallback: show raw analysis content
          (() => {
            // Try to get content, being careful not to strip too much
            let content = analysisText
              .replace(/```json[\s\S]*?```/g, '') // Remove code blocks
              .replace(/^\s*\{[\s\S]*\}\s*$/, '') // Remove if entire response is just JSON
              .trim();

            // If we stripped everything but have tradeData, show a generated summary
            if (!content && tradeData?.action) {
              content = `**Recommendation: ${tradeData.action}**\n\n`;
              content += `Conviction: ${tradeData.conviction || 'medium'}\n`;
              if (tradeData.confidence) content += `Confidence: ${tradeData.confidence}%\n`;
              if (tradeData.entry) content += `\nEntry zone: €${tradeData.entry.low?.toFixed(4)} - €${tradeData.entry.high?.toFixed(4)}`;
              if (tradeData.stopLoss) content += `\nStop loss: €${tradeData.stopLoss.toFixed(4)}`;
              if (tradeData.targets?.length) {
                content += '\n\nTargets:\n';
                tradeData.targets.forEach((t: { level?: number; price?: number | null; probability?: number | null }, i: number) => {
                  if (t.price) content += `• TP${t.level || i + 1}: €${Number(t.price).toFixed(4)}\n`;
                });
              }
              content += '\n\n*See structured data above for full details. Expand Debug section to see raw AI response.*';
            }

            // Last resort: show the raw analysis (including JSON if that's all there is)
            if (!content) {
              content = analysisText || 'No analysis content available.';
            }

            return (
              <div className="rounded-lg border border-gray-500/30 bg-gray-500/5 overflow-hidden">
                <div className="px-3 py-2 bg-gray-500/10 border-b border-primary/20 flex items-center gap-2">
                  <span>📝</span>
                  <span className="text-sm font-semibold text-primary">Analysis</span>
                </div>
                <div className="px-3 py-3">
                  <FormattedContent content={content} />
                </div>
              </div>
            );
          })()
        )}
      </div>

      {/* Debug Section */}
      <div className="border-t border-purple-500/20">
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="w-full px-4 py-2 text-xs text-tertiary hover:text-purple-400 transition-colors flex items-center justify-center gap-1 hover:bg-primary/20"
        >
          <span>{showDebug ? '▼' : '▶'}</span>
          <span>Debug: Raw Data</span>
        </button>
        {showDebug && (
          <div className="px-4 pb-4 space-y-3">
            <div>
              <div className="text-xs text-tertiary mb-1">Raw Analysis (length: {analysisText.length}):</div>
              <div className="bg-primary rounded-lg p-3 overflow-auto max-h-40">
                <pre className="text-xs font-mono text-tertiary whitespace-pre-wrap">
                  {analysisText || '(empty)'}
                </pre>
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary mb-1">Input Data:</div>
              <div className="bg-primary rounded-lg p-3 overflow-auto max-h-40">
                <pre className="text-xs font-mono text-tertiary whitespace-pre-wrap">
                  {analysis?.inputData || '(empty)'}
                </pre>
              </div>
            </div>
            <div>
              <div className="text-xs text-tertiary mb-1">Parsed Trade Data:</div>
              <div className="bg-primary rounded-lg p-3 overflow-auto max-h-40">
                <pre className="text-xs font-mono text-tertiary whitespace-pre-wrap">
                  {tradeData ? JSON.stringify(tradeData, null, 2) : '(null)'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
