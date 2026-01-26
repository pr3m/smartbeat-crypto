'use client';

interface FloatingTradeButtonProps {
  onClick: () => void;
  testMode: boolean;
  hasOpenPosition?: boolean;
}

export function FloatingTradeButton({
  onClick,
  testMode,
  hasOpenPosition,
}: FloatingTradeButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`fab fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full flex items-center justify-center text-white ${
        testMode
          ? 'bg-gradient-to-br from-orange-500 to-orange-600'
          : 'bg-gradient-to-br from-blue-500 to-blue-600'
      }`}
      aria-label="Open trade panel"
    >
      {/* Trading icon */}
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
        />
      </svg>

      {/* Open position indicator */}
      {hasOpenPosition && (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-secondary animate-pulse" />
      )}

      {/* Test mode indicator ring */}
      {testMode && (
        <span className="absolute inset-0 rounded-full border-2 border-orange-400/50 animate-pulse" />
      )}
    </button>
  );
}
