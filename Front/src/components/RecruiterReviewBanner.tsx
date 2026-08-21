import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { apiFetch } from '../services/api';

export interface RecruiterReviewItem {
  id: string;
  actionType: 'duplicate_review' | 'approval' | 'workflow_parked' | string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  sourceEventType?: string;
  createdAt?: string;
}

interface RecruiterReviewBannerProps {
  onCountChange?: (count: number) => void;
}

export const RecruiterReviewBanner: React.FC<RecruiterReviewBannerProps> = ({
  onCountChange,
}) => {
  const [items, setItems] = useState<RecruiterReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const fetchPending = useCallback(async () => {
    try {
      const res = await apiFetch('/recruiter/reviews/pending');
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.items || []) as RecruiterReviewItem[];
      setItems(list);
      onCountChange?.(list.length);
      if (list.length > 0) setDismissed(false);
    } catch {
      /* ignore poll errors */
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void fetchPending();
    const interval = setInterval(() => void fetchPending(), 15000);
    return () => clearInterval(interval);
  }, [fetchPending]);

  const decide = async (id: string, approved: boolean) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`/recruiter/reviews/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ approved }),
      });
      if (res.ok) {
        await fetchPending();
      }
    } finally {
      setBusyId(null);
    }
  };

  if (loading || items.length === 0 || dismissed) {
    return null;
  }

  const primary = items[0];

  return (
    <div className="mx-8 mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-col gap-3 shadow-lg shadow-amber-900/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-200">
              Recruiter review needed
              {items.length > 1 ? ` (${items.length} items)` : ''}
            </p>
            <p className="text-xs font-semibold text-amber-100/90 mt-0.5">{primary.title}</p>
            <p className="text-xs text-amber-100/70 mt-1 leading-relaxed">{primary.message}</p>
            {primary.sourceEventType && (
              <p className="text-[10px] text-amber-300/60 mt-1 font-mono">
                via orchestration · {primary.sourceEventType}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 rounded-lg text-amber-300/70 hover:text-amber-100 hover:bg-amber-500/20"
          title="Dismiss banner (items stay in queue)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-8">
        <button
          type="button"
          disabled={busyId === primary.id}
          onClick={() => void decide(primary.id, true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
        >
          {busyId === primary.id ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          Approve / Continue
        </button>
        <button
          type="button"
          disabled={busyId === primary.id}
          onClick={() => void decide(primary.id, false)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/40 hover:bg-red-500/60 text-red-100 text-xs font-semibold border border-red-500/40 disabled:opacity-50"
        >
          <XCircle className="w-3.5 h-3.5" />
          Reject
        </button>
      </div>

      {items.length > 1 && (
        <ul className="pl-8 space-y-1 border-t border-amber-500/20 pt-2">
          {items.slice(1, 4).map((item) => (
            <li key={item.id} className="text-[11px] text-amber-100/80 truncate">
              • {item.title}
            </li>
          ))}
          {items.length > 4 && (
            <li className="text-[10px] text-amber-300/60">+ {items.length - 4} more in queue</li>
          )}
        </ul>
      )}
    </div>
  );
};
