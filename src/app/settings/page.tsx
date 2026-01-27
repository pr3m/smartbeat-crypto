/**
 * Settings Page
 * Central place for app configuration, settings, and usage statistics
 */

'use client';

import { useState, useEffect } from 'react';
import { AIUsageTab } from './AIUsageTab';
import { GeneralSettingsTab } from './GeneralSettingsTab';

type TabId = 'ai-usage' | 'general' | 'trading' | 'tax';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: 'ai-usage', label: 'AI Usage', icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z' },
  { id: 'general', label: 'General', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'trading', label: 'Trading', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
  { id: 'tax', label: 'Tax', icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('ai-usage');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-secondary mt-1">
          Configure your application preferences and view usage statistics
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <nav className="w-full md:w-64 flex-shrink-0">
          <ul className="space-y-1">
            {TABS.map((tab) => (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                    activeTab === tab.id
                      ? 'bg-tertiary text-primary border border-info/30'
                      : 'hover:bg-tertiary text-secondary'
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d={tab.icon}
                    />
                  </svg>
                  <span className="font-medium">{tab.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <main className="flex-1 min-w-0">
          {activeTab === 'ai-usage' && <AIUsageTab />}
          {activeTab === 'general' && <GeneralSettingsTab />}
          {activeTab === 'trading' && <TradingSettingsTab />}
          {activeTab === 'tax' && <TaxSettingsTab />}
        </main>
      </div>
    </div>
  );
}

function TradingSettingsTab() {
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold mb-4">Trading Settings</h2>
      <p className="text-secondary">Trading configuration options coming soon.</p>
    </div>
  );
}

function TaxSettingsTab() {
  const [accountType, setAccountType] = useState<'individual' | 'business'>('individual');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Load current settings on mount
  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setAccountType(data.accountType || 'individual');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleAccountTypeChange = async (newType: 'individual' | 'business') => {
    setAccountType(newType);
    setSaveStatus('saving');

    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType: newType }),
      });
      setSaveStatus('saved');
      // Reset status after 2 seconds
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
    }
  };

  if (loading) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-tertiary rounded w-1/3"></div>
          <div className="h-10 bg-tertiary rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Account Type</h2>
          {saveStatus === 'saving' && (
            <span className="text-xs text-secondary">Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-xs text-success">Saved</span>
          )}
        </div>
        <p className="text-secondary mb-4">
          This affects how your crypto taxes are calculated. Estonian tax rules differ significantly between individual and business accounts.
        </p>

        <div className="space-y-3">
          <label
            className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
              accountType === 'individual'
                ? 'border-info bg-info/10'
                : 'border-primary hover:border-secondary'
            }`}
          >
            <input
              type="radio"
              name="accountType"
              value="individual"
              checked={accountType === 'individual'}
              onChange={() => handleAccountTypeChange('individual')}
              className="mt-1"
            />
            <div>
              <div className="font-medium">Individual (Natural Person)</div>
              <div className="text-sm text-secondary mt-1">
                Personal trading account. Tax rate: 22% (2025) / 24% (2026+) on all gains.
                Losses are NOT deductible. Report on Table 8.3.
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
              accountType === 'business'
                ? 'border-info bg-info/10'
                : 'border-primary hover:border-secondary'
            }`}
          >
            <input
              type="radio"
              name="accountType"
              value="business"
              checked={accountType === 'business'}
              onChange={() => handleAccountTypeChange('business')}
              className="mt-1"
            />
            <div>
              <div className="font-medium">Business (OÜ / Company)</div>
              <div className="text-sm text-secondary mt-1">
                Corporate trading account. <strong className="text-success">0% tax on retained profits</strong>.
                Tax only when distributing (dividends ~28% effective). Losses CAN offset gains.
              </div>
            </div>
          </label>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Estonian Tax Rules Summary</h2>

        {accountType === 'individual' ? (
          <div className="space-y-3 text-sm">
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <strong className="text-yellow-400">Individual Taxation</strong>
              <ul className="mt-2 space-y-1 text-secondary">
                <li>• Crypto gains taxed as regular income (22-24%)</li>
                <li>• <strong className="text-danger">Losses are NOT deductible</strong></li>
                <li>• Tax due when you sell/exchange crypto for profit</li>
                <li>• Report on Table 8.3 (foreign income) since Kraken is US-based</li>
                <li>• Annual declaration deadline: April 30</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <strong className="text-green-400">Business Taxation (OÜ)</strong>
              <ul className="mt-2 space-y-1 text-secondary">
                <li>• <strong className="text-success">0% tax on retained/reinvested profits</strong></li>
                <li>• <strong className="text-success">Losses CAN offset gains</strong></li>
                <li>• Tax only when distributing (dividends, salaries)</li>
                <li>• Distribution tax: ~28% effective (22/78 in 2025)</li>
                <li>• Track P&L for accounting, no annual income tax return needed</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
