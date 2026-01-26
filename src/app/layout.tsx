import type { Metadata } from 'next';
import Link from 'next/link';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { Providers } from '@/components/Providers';
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
        </Providers>
      </body>
    </html>
  );
}
