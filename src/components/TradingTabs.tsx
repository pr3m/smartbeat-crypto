'use client';

export type TradingTab = 'setup' | 'positions' | 'reports';

interface TradingTabsProps {
  activeTab: TradingTab;
  onTabChange: (tab: TradingTab) => void;
  counts?: {
    positions?: number;
    reports?: number;
  };
}

export function TradingTabs({ activeTab, onTabChange, counts }: TradingTabsProps) {
  const tabs: { id: TradingTab; label: string; icon: string; countKey?: 'positions' | 'reports' }[] = [
    { id: 'setup', label: 'Setup', icon: '📊' },
    { id: 'positions', label: 'Positions', icon: '📈', countKey: 'positions' },
    { id: 'reports', label: 'Reports', icon: '📝', countKey: 'reports' },
  ];

  return (
    <div className="mb-6 border-b border-primary">
      <div className="flex gap-1">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          const count = tab.countKey ? counts?.[tab.countKey] : undefined;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all
                border-b-2 -mb-[2px]
                ${isActive
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-secondary hover:text-primary hover:border-gray-600'
                }
              `}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {count !== undefined && count > 0 && (
                <span className={`
                  px-1.5 py-0.5 text-xs rounded-full min-w-[20px] text-center
                  ${isActive
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-tertiary text-tertiary'
                  }
                `}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
