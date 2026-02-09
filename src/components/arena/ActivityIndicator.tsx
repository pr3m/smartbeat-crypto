'use client';

interface ActivityIndicatorProps {
  activity: string;  // 'idle' | 'thinking' | 'trading' | 'holding' | 'waiting'
  size?: number;     // Default 8
}

export function ActivityIndicator({ activity, size = 8 }: ActivityIndicatorProps) {
  const getStyle = (): { color: string; animate: string; title: string } => {
    switch (activity) {
      case 'thinking':
        return { color: '#3b82f6', animate: 'animate-pulse', title: 'Thinking...' };
      case 'trading':
        return { color: '#22c55e', animate: 'animate-ping-once', title: 'Trading!' };
      case 'holding':
        return { color: '#f59e0b', animate: '', title: 'Holding position' };
      case 'waiting':
        return { color: '#6b7280', animate: '', title: 'Waiting for signal' };
      case 'idle':
      default:
        return { color: '#374151', animate: '', title: 'Idle' };
    }
  };

  const { color, animate, title } = getStyle();

  return (
    <span
      className={`inline-block rounded-full shrink-0 ${animate}`}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
      }}
      title={title}
    />
  );
}
