/**
 * General Settings Tab
 * Basic app configuration
 */

'use client';

import { useState, useEffect } from 'react';

interface AppInfo {
  version: string;
  nodeEnv: string;
  databaseUrl: string;
  openaiConfigured: boolean;
  krakenConfigured: boolean;
}

export function GeneralSettingsTab() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    // Check configuration status
    const checkConfig = async () => {
      try {
        const statusRes = await fetch('/api/status');
        const status = await statusRes.json();

        setAppInfo({
          version: '0.1.0',
          nodeEnv: process.env.NODE_ENV || 'development',
          databaseUrl: 'SQLite (local)',
          openaiConfigured: status.openai?.configured || false,
          krakenConfigured: status.kraken?.configured || false,
        });
      } catch {
        setAppInfo({
          version: '0.1.0',
          nodeEnv: 'unknown',
          databaseUrl: 'SQLite (local)',
          openaiConfigured: false,
          krakenConfigured: false,
        });
      }
    };

    checkConfig();
  }, []);

  return (
    <div className="space-y-6">
      {/* App Info */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Application Info</h2>
        <div className="space-y-4">
          <InfoRow label="Version" value={appInfo?.version || 'Loading...'} />
          <InfoRow label="Environment" value={appInfo?.nodeEnv || 'Loading...'} />
          <InfoRow label="Database" value={appInfo?.databaseUrl || 'Loading...'} />
        </div>
      </div>

      {/* API Configuration Status */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">API Configuration</h2>
        <div className="space-y-4">
          <ConfigStatus
            label="OpenAI API"
            configured={appInfo?.openaiConfigured || false}
            description="Required for AI assistant and market analysis"
          />
          <ConfigStatus
            label="Kraken API"
            configured={appInfo?.krakenConfigured || false}
            description="Required for live trading and balance data"
          />
        </div>
      </div>

      {/* Environment Variables Guide */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Configuration Guide</h2>
        <p className="text-secondary text-sm mb-4">
          Create a <code className="px-2 py-1 bg-tertiary rounded">.env</code> file in the project root with the following variables:
        </p>
        <pre className="bg-tertiary p-4 rounded-lg text-sm overflow-x-auto">
{`# Database
DATABASE_URL="file:./data/smartbeat-crypto.db"

# OpenAI (for AI features)
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o

# Kraken (for live trading)
KRAKEN_API_KEY=your_kraken_api_key
KRAKEN_PRIVATE_KEY=your_kraken_private_key`}
        </pre>
      </div>

      {/* Data Management */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">Data Management</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">Database</p>
              <p className="text-xs text-tertiary">
                Manage your local SQLite database
              </p>
            </div>
            <button
              onClick={() => window.open('/api/status', '_blank')}
              className="btn btn-secondary text-sm"
            >
              View Status
            </button>
          </div>

          <div className="flex items-center justify-between py-2 border-t border-primary pt-4">
            <div>
              <p className="font-medium">Clear Chat History</p>
              <p className="text-xs text-tertiary">
                Delete all AI assistant conversations
              </p>
            </div>
            <button
              className="btn btn-secondary text-sm text-danger hover:bg-danger hover:text-white"
              onClick={() => {
                if (confirm('Are you sure you want to delete all chat history?')) {
                  // TODO: Implement clear chat history
                  alert('Feature coming soon');
                }
              }}
            >
              Clear History
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-primary last:border-0">
      <span className="text-secondary">{label}</span>
      <span className="font-medium mono text-sm">{value}</span>
    </div>
  );
}

function ConfigStatus({
  label,
  configured,
  description,
}: {
  label: string;
  configured: boolean;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-primary last:border-0">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-tertiary">{description}</p>
      </div>
      <span
        className={`flex items-center gap-2 text-sm ${
          configured ? 'text-success' : 'text-warning'
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            configured ? 'bg-green-500' : 'bg-yellow-500'
          }`}
        />
        {configured ? 'Configured' : 'Not configured'}
      </span>
    </div>
  );
}
