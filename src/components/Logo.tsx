export function Logo({ size = 32, showText = true }: { size?: number; showText?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="50%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>

        {/* Background circle */}
        <circle cx="16" cy="16" r="15" fill="#1e293b" />

        {/* Heartbeat pulse line */}
        <path
          d="M4 16 L9 16 L12 10 L16 22 L20 8 L23 16 L28 16"
          fill="none"
          stroke="url(#logoGradient)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {showText && (
        <span className="font-semibold text-lg">
          <span className="text-emerald-400">Smart</span>
          <span className="text-emerald-500">Beat</span>
          <span className="text-slate-400">Crypto</span>
        </span>
      )}
    </div>
  );
}

export function LogoIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="iconGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="50%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>

      <circle cx="16" cy="16" r="15" fill="#1e293b" />

      <path
        d="M4 16 L9 16 L12 10 L16 22 L20 8 L23 16 L28 16"
        fill="none"
        stroke="url(#iconGradient)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
