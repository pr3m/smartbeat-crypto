import type { Metadata } from 'next';
import Link from 'next/link';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { Providers } from '@/components/Providers';
import { ChatFAB, ChatPanel } from '@/components/chat';
import './globals.css';

export const metadata: Metadata = {
  title: 'SmartBeatCrypto - Trading Assistant & Tax Reporting',
  description: 'Real-time Kraken trading with multi-timeframe analysis and Estonian tax compliance',
};

function Navigation() {
  return (
    <header className="bg-secondary border-b border-primary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-lg font-semibold">
              SmartBeatCrypto
            </Link>
            <nav className="hidden md:flex items-center gap-6">
              <Link
                href="/trading"
                className="text-secondary hover:text-primary transition-colors"
              >
                Trading
              </Link>
              <Link
                href="/tax"
                className="text-secondary hover:text-primary transition-colors"
              >
                Tax Reports
              </Link>
              <Link
                href="/tax/transactions"
                className="text-secondary hover:text-primary transition-colors"
              >
                Transactions
              </Link>
              <Link
                href="/tax/import"
                className="text-secondary hover:text-primary transition-colors"
              >
                Import
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionStatus />
            <Link
              href="/settings"
              className="p-2 text-secondary hover:text-primary hover:bg-tertiary rounded-lg transition-colors"
              title="Settings"
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
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-primary">
        <Providers>
          <Navigation />
          <main>{children}</main>
          <ChatFAB />
          <ChatPanel />
        </Providers>
      </body>
    </html>
  );
}
