'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';

interface TradeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  testMode: boolean;
  children: ReactNode;
}

export function TradeDrawer({ isOpen, onClose, testMode, children }: TradeDrawerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // Handle open/close animations
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setIsAnimating(true);
      // Remove animating state after animation completes
      const timer = setTimeout(() => setIsAnimating(false), 300);
      return () => clearTimeout(timer);
    } else if (isVisible) {
      setIsAnimating(true);
      // Keep visible during close animation, then hide
      const timer = setTimeout(() => {
        setIsVisible(false);
        setIsAnimating(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isVisible]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when drawer is open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isVisible) return null;

  return (
    <>
      {/* Mobile: Full screen overlay */}
      <div className="lg:hidden fixed inset-0 z-50">
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/50 backdrop-blur-sm ${
            isOpen ? 'animate-fade-in' : 'animate-fade-out'
          }`}
          onClick={onClose}
        />

        {/* Drawer content - slides up from bottom */}
        <div
          className={`absolute inset-0 bg-secondary flex flex-col ${
            isOpen ? 'animate-slide-in-up' : 'animate-slide-out-down'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-primary">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Trade</h2>
              {testMode && (
                <span className="test-mode-badge px-2 py-0.5 rounded text-xs">
                  TEST MODE
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-tertiary rounded-lg transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>

      {/* Desktop: Right side panel */}
      <div className="hidden lg:block fixed right-0 top-0 h-full z-40">
        {/* Backdrop for desktop (optional, semi-transparent) */}
        <div
          className={`absolute inset-0 bg-black/20 -left-[100vw] w-[100vw] ${
            isOpen ? 'animate-fade-in' : 'animate-fade-out'
          }`}
          onClick={onClose}
        />

        {/* Drawer panel */}
        <div
          className={`relative h-full w-[420px] bg-secondary border-l border-primary flex flex-col shadow-xl ${
            isOpen ? 'animate-slide-in-right' : 'animate-slide-out-right'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-primary shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Trade XRP/EUR</h2>
              {testMode && (
                <span className="test-mode-badge px-2 py-0.5 rounded text-xs">
                  TEST MODE
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-tertiary rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
