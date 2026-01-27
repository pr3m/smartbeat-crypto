/**
 * Settings Page
 * Central place for app configuration, settings, and usage statistics
 */

'use client';

import { useState } from 'react';
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
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold mb-4">Tax Settings</h2>
      <p className="text-secondary">Tax configuration options coming soon.</p>
    </div>
  );
}
