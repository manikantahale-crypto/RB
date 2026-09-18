import React from 'react';

interface ScrollableTableCardProps {
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  scrollClassName?: string;
}

/**
 * Standardized, bulletproof table container component for all data-heavy SYNTRA tables.
 *
 * Provides:
 * 1. Card container pinned to available height: flex-1 min-h-0 w-full rounded-2xl border bg-[#0c0916]/80 flex flex-col overflow-hidden
 * 2. Inner scroll viewport: flex-1 min-h-0 w-full overflow-auto
 * 3. Sticky header support with opaque thead
 * 4. Docked footer for pagination: shrink-0 z-20
 * 5. Clean, card-bounded horizontal scroll without application-level page overflow.
 */
export const ScrollableTableCard: React.FC<ScrollableTableCardProps> = ({
  children,
  footer,
  className = '',
  scrollClassName = '',
}) => {
  return (
    <div
      className={`flex-1 min-h-0 w-full rounded-2xl border border-[#261e38] bg-[#0c0916]/80 backdrop-blur-xl glass-card flex flex-col overflow-hidden shadow-xl ${className}`}
    >
      {/* Scrollable table viewport */}
      <div className={`flex-1 min-h-0 w-full overflow-auto ${scrollClassName}`}>
        {children}
      </div>

      {/* Permanently docked pagination/footer bar */}
      {footer && (
        <div className="shrink-0 z-20 border-t border-[#261e38] bg-[#150f27]">
          {footer}
        </div>
      )}
    </div>
  );
};
