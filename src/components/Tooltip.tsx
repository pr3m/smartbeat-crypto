'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  maxWidth?: string;
  block?: boolean;
}

export function Tooltip({ children, content, position = 'top', maxWidth = '300px', block = false }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateCoords = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    let top = 0;
    let left = 0;

    switch (position) {
      case 'top':
        top = triggerRect.top - tooltipRect.height - 8;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'bottom':
        top = triggerRect.bottom + 8;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'left':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.left - tooltipRect.width - 8;
        break;
      case 'right':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.right + 8;
        break;
    }

    // Keep tooltip within viewport
    const padding = 10;
    if (left < padding) left = padding;
    if (left + tooltipRect.width > window.innerWidth - padding) {
      left = window.innerWidth - tooltipRect.width - padding;
    }
    if (top < padding) top = padding;
    if (top + tooltipRect.height > window.innerHeight - padding) {
      top = window.innerHeight - tooltipRect.height - padding;
    }

    setCoords({ top, left });
  }, [position]);

  useEffect(() => {
    if (!isVisible) return;
    const scrollOptions: AddEventListenerOptions = { passive: true, capture: true };
    updateCoords();
    document.addEventListener('scroll', updateCoords, scrollOptions);
    window.addEventListener('resize', updateCoords);
    return () => {
      document.removeEventListener('scroll', updateCoords, scrollOptions);
      window.removeEventListener('resize', updateCoords);
    };
  }, [isVisible, updateCoords]);

  const Tag = block ? 'div' : 'span';

  const tooltipPopup = isVisible && mounted ? createPortal(
    <div
      ref={tooltipRef}
      className="fixed z-[9999] px-3 py-2 text-sm bg-gray-900 text-gray-100 rounded-lg shadow-xl border border-gray-700 pointer-events-none"
      style={{
        top: coords.top,
        left: coords.left,
        maxWidth,
      }}
    >
      {content}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <Tag className={block ? 'block w-full' : 'relative inline-flex items-center'}>
        <Tag
          ref={triggerRef as React.RefObject<HTMLDivElement> & React.RefObject<HTMLSpanElement>}
          onMouseEnter={() => setIsVisible(true)}
          onMouseLeave={() => setIsVisible(false)}
          className={block ? 'cursor-help block w-full' : 'cursor-help'}
        >
          {children}
        </Tag>
      </Tag>
      {tooltipPopup}
    </>
  );
}

export function HelpIcon({ tooltip, position = 'top' }: { tooltip: React.ReactNode; position?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip content={tooltip} position={position}>
      <span className="inline-flex items-center justify-center w-4 h-4 ml-1 text-xs rounded-full bg-tertiary text-tertiary hover:bg-blue-600 hover:text-white transition-colors">
        ?
      </span>
    </Tooltip>
  );
}

export function InfoBadge({ children, tooltip, position = 'top' }: { children: React.ReactNode; tooltip: React.ReactNode; position?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip content={tooltip} position={position}>
      <span className="border-b border-dashed border-current cursor-help">
        {children}
      </span>
    </Tooltip>
  );
}
