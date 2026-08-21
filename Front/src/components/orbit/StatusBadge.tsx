import React from 'react';
import { OrbitLifecycleState } from '../../types';

interface StatusBadgeProps {
  state?: OrbitLifecycleState | string;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  interactive?: boolean;
}

const STATE_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  AVAILABLE: {
    label: 'Available',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-300',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  BENCH: {
    label: 'Bench',
    bg: 'bg-purple-500/15',
    text: 'text-purple-300',
    border: 'border-purple-500/30',
    dot: 'bg-purple-400',
  },
  NOTICE: {
    label: 'Notice',
    bg: 'bg-amber-500/15',
    text: 'text-amber-300',
    border: 'border-amber-500/30',
    dot: 'bg-amber-400',
  },
  PLACED: {
    label: 'Placed',
    bg: 'bg-blue-500/15',
    text: 'text-blue-300',
    border: 'border-blue-500/30',
    dot: 'bg-blue-400',
  },
  HOLD: {
    label: 'Hold',
    bg: 'bg-orange-500/15',
    text: 'text-orange-300',
    border: 'border-orange-500/30',
    dot: 'bg-orange-400',
  },
  PRIORITIZE: {
    label: 'Prioritize',
    bg: 'bg-pink-500/15',
    text: 'text-pink-300',
    border: 'border-pink-500/30',
    dot: 'bg-pink-400',
  },
  OLD: {
    label: 'Old',
    bg: 'bg-slate-500/15',
    text: 'text-slate-300',
    border: 'border-slate-500/30',
    dot: 'bg-slate-400',
  },
  IGNORE: {
    label: 'Ignore',
    bg: 'bg-red-500/15',
    text: 'text-red-300',
    border: 'border-red-500/30',
    dot: 'bg-red-400',
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  state = 'AVAILABLE',
  size = 'sm',
  onClick,
  interactive = false,
}) => {
  const normState = (state || 'AVAILABLE').toUpperCase();
  const cfg = STATE_CONFIG[normState] || {
    label: normState,
    bg: 'bg-slate-500/15',
    text: 'text-slate-300',
    border: 'border-slate-500/30',
    dot: 'bg-slate-400',
  };

  const sizeClasses =
    size === 'lg'
      ? 'px-3 py-1.5 text-xs'
      : size === 'md'
      ? 'px-2.5 py-1 text-xs'
      : 'px-2 py-0.5 text-[11px]';

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 font-semibold rounded-lg border transition-all ${
        sizeClasses
      } ${cfg.bg} ${cfg.text} ${cfg.border} ${
        interactive || onClick
          ? 'cursor-pointer hover:brightness-125 hover:scale-105 active:scale-95 shadow-sm'
          : ''
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse`} />
      <span>{cfg.label}</span>
    </span>
  );
};
