'use client';

import type { AvatarShape } from '@/lib/arena/types';

interface AgentAvatarProps {
  shape: AvatarShape;
  colorIndex: number;
  isDead?: boolean;
  isTrading?: boolean;
  size?: number;
}

const AGENT_COLORS = [
  'var(--agent-1)',
  'var(--agent-2)',
  'var(--agent-3)',
  'var(--agent-4)',
  'var(--agent-5)',
  'var(--agent-6)',
  'var(--agent-7)',
  'var(--agent-8)',
];

function getShapePath(shape: AvatarShape): string {
  switch (shape) {
    case 'hexagon':
      return 'M50 2 L93 25 L93 75 L50 98 L7 75 L7 25 Z';
    case 'diamond':
      return 'M50 2 L98 50 L50 98 L2 50 Z';
    case 'circle':
      return 'M50 2 A48 48 0 1 1 50 98 A48 48 0 1 1 50 2 Z';
    case 'triangle':
      return 'M50 5 L95 90 L5 90 Z';
    case 'square':
      return 'M10 10 L90 10 L90 90 L10 90 Z';
    case 'pentagon':
      return 'M50 2 L97 38 L79 95 L21 95 L3 38 Z';
    case 'octagon':
      return 'M30 2 L70 2 L98 30 L98 70 L70 98 L30 98 L2 70 L2 30 Z';
    case 'star':
      return 'M50 2 L61 38 L98 38 L68 60 L79 96 L50 74 L21 96 L32 60 L2 38 L39 38 Z';
  }
}

export function AgentAvatar({ shape, colorIndex, isDead, isTrading, size = 32 }: AgentAvatarProps) {
  const color = AGENT_COLORS[colorIndex] || AGENT_COLORS[0];
  const className = `arena-avatar${isDead ? ' dead' : ''}${isTrading ? ' trading' : ''}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ border: 'none', width: size, height: size }}
    >
      <path
        d={getShapePath(shape)}
        fill={color}
        fillOpacity={0.3}
        stroke={color}
        strokeWidth={4}
      />
    </svg>
  );
}
