'use client';

import { getHealthZone, getHealthColor } from '@/lib/arena/types';

interface AgentHealthBarProps {
  health: number;
  showLabel?: boolean;
}

export function AgentHealthBar({ health, showLabel = true }: AgentHealthBarProps) {
  const zone = getHealthZone(health);
  const color = getHealthColor(zone);
  const clamped = Math.max(0, Math.min(100, health));

  return (
    <div className="flex items-center gap-2 w-full">
      <div className="arena-health-bar flex-1">
        <div
          style={{
            width: `${clamped}%`,
            backgroundColor: color,
          }}
        />
      </div>
      {showLabel && (
        <span
          className="text-xs mono min-w-[32px] text-right"
          style={{ color }}
        >
          {Math.round(clamped)}
        </span>
      )}
    </div>
  );
}
