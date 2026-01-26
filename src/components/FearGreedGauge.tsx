'use client';

import { useState, useEffect } from 'react';

interface FearGreedData {
  value: string;
  value_classification: string;
  timestamp: string;
  time_until_update?: string;
}

function getClassificationColor(classification: string): string {
  switch (classification.toLowerCase()) {
    case 'extreme fear':
      return '#ea3943';
    case 'fear':
      return '#ea8c00';
    case 'neutral':
      return '#c3c3c3';
    case 'greed':
      return '#93d900';
    case 'extreme greed':
      return '#16c784';
    default:
      return '#c3c3c3';
  }
}

function formatDate(timestamp: string): string {
  const date = new Date(parseInt(timestamp) * 1000);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function FearGreedGauge() {
  const [data, setData] = useState<FearGreedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/fear-greed');
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        if (result.data && result.data.length > 0) {
          setData(result.data[0]);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const value = data ? parseInt(data.value) : 50;
  const classification = data?.value_classification || 'Loading...';
  const classificationColor = getClassificationColor(classification);

  // Calculate needle angle (0 = left, 180 = right)
  // Value 0 = extreme fear (left), 100 = extreme greed (right)
  const needleAngle = -90 + (value / 100) * 180;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 mb-4">
        {/* Bitcoin logo */}
        <div className="w-10 h-10 rounded-full bg-[#f7931a] flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-6 h-6 text-white fill-current">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm0 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-4.5 10-10 10z" fill="#f7931a"/>
            <path d="M14.1 10.2c.4-.6.6-1.3.5-2-.2-1.3-1.3-2-2.7-2.2V4.5h-1.2V6h-.8V4.5H8.7V6H7v1.3h.8c.4 0 .6.2.6.5v5.4c0 .3-.2.5-.6.5H7v1.3h1.7v1.5h1.2V15h.8v1.5h1.2V15c1.7-.1 3.1-.8 3.1-2.5 0-1.2-.7-1.9-1.9-2.3zm-3.4-2.9h.9c.8 0 1.4.3 1.4 1s-.5 1.1-1.3 1.1h-1V7.3zm2.1 6.4h-2.1v-2.4h1.2c1.1 0 1.7.4 1.7 1.2s-.4 1.2-.8 1.2z" fill="white"/>
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-bold">Fear & Greed Index</h3>
          <p className="text-xs text-tertiary">Multifactorial Crypto Market Sentiment Analysis</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="text-secondary">Loading...</div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-48">
          <div className="text-red-500">{error}</div>
        </div>
      ) : (
        <>
          {/* Current status */}
          <div className="mb-4">
            <div className="text-sm font-semibold text-secondary">Now:</div>
            <div className="text-2xl font-bold" style={{ color: classificationColor }}>
              {classification}
            </div>
          </div>

          {/* Gauge */}
          <div className="relative flex justify-center">
            <svg viewBox="0 0 200 120" className="w-full max-w-[280px]">
              {/* Gradient arc background */}
              <defs>
                <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ea3943" />
                  <stop offset="25%" stopColor="#ea8c00" />
                  <stop offset="50%" stopColor="#f3d42f" />
                  <stop offset="75%" stopColor="#93d900" />
                  <stop offset="100%" stopColor="#16c784" />
                </linearGradient>
              </defs>

              {/* Arc track */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="url(#gaugeGradient)"
                strokeWidth="16"
                strokeLinecap="round"
              />

              {/* Needle */}
              <g transform={`rotate(${needleAngle} 100 100)`}>
                {/* Needle shadow */}
                <line
                  x1="100"
                  y1="100"
                  x2="100"
                  y2="35"
                  stroke="rgba(0,0,0,0.3)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  transform="translate(2, 2)"
                />
                {/* Needle */}
                <line
                  x1="100"
                  y1="100"
                  x2="100"
                  y2="35"
                  stroke="#8b8b8b"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </g>

              {/* Value circle */}
              <circle
                cx={20 + (value / 100) * 160}
                cy={100 - Math.sin((value / 100) * Math.PI) * 80}
                r="18"
                fill={classificationColor}
              />
              <text
                x={20 + (value / 100) * 160}
                y={100 - Math.sin((value / 100) * Math.PI) * 80 + 5}
                textAnchor="middle"
                fill="white"
                fontSize="14"
                fontWeight="bold"
              >
                {value}
              </text>

              {/* Center Bitcoin logo */}
              <circle cx="100" cy="100" r="14" fill="#6b6b6b" />
              <text x="100" y="105" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">
                ₿
              </text>
            </svg>
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center mt-4 pt-3 border-t border-primary text-xs text-tertiary">
            <span>alternative.me</span>
            <span>Last updated: {data ? formatDate(data.timestamp) : '-'}</span>
          </div>
        </>
      )}
    </div>
  );
}
