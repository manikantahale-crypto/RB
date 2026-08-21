import React, { useState } from 'react';
import { X, Loader2, AlertCircle, ArrowRightCircle } from 'lucide-react';
import { CandidateProfile, OrbitLifecycleState } from '../../types';
import { apiFetch } from '../../services/api';
import { StatusBadge } from './StatusBadge';

interface TransitionModalProps {
  candidate: CandidateProfile;
  currentState: OrbitLifecycleState | string;
  onClose: () => void;
  onSuccess: (newState: OrbitLifecycleState | string) => void;
}

const STATUS_OPTIONS: { value: OrbitLifecycleState; label: string; description: string }[] = [
  { value: 'AVAILABLE', label: 'Available', description: 'Ready for immediate marketing & matching' },
  { value: 'BENCH', label: 'Bench', description: 'Active on internal bench workforce' },
  { value: 'NOTICE', label: 'Notice', description: 'Serving notice period, available soon' },
  { value: 'PLACED', label: 'Placed', description: 'Confirmed placement at client' },
  { value: 'HOLD', label: 'Hold', description: 'Temporarily paused from marketing' },
  { value: 'PRIORITIZE', label: 'Prioritize', description: 'High priority candidate for urgent requirements' },
  { value: 'OLD', label: 'Old', description: 'Historical candidate, profile aged' },
  { value: 'IGNORE', label: 'Ignore', description: 'Excluded from marketing and matching' },
];

export const TransitionModal: React.FC<TransitionModalProps> = ({
  candidate,
  currentState = 'AVAILABLE',
  onClose,
  onSuccess,
}) => {
  const [selected, setSelected] = useState<OrbitLifecycleState>(
    (currentState as OrbitLifecycleState) || 'AVAILABLE'
  );
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch(`/candidates/${candidate.id}/lifecycle/transition`, {
        method: 'POST',
        body: JSON.stringify({
          to_state: selected,
          note: note.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update lifecycle status');
      }

      onSuccess(selected);
      onClose();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#120c24] border border-purple-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl relative max-h-[90vh] flex flex-col space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#261e38] pb-3">
          <div>
            <h3 className="text-base font-extrabold text-white">Update Status</h3>
            <p className="text-xs text-slate-400 mt-0.5">{candidate.name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current status display */}
        <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
            Current State
          </span>
          <StatusBadge state={currentState} size="sm" />
        </div>

        {/* Status list */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-3 pr-1">
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
            Transition To *
          </label>
          <div className="space-y-1.5">
            {STATUS_OPTIONS.map((opt) => {
              const isSelected = selected === opt.value;
              const isCurrent = currentState === opt.value;

              return (
                <label
                  key={opt.value}
                  onClick={() => setSelected(opt.value)}
                  className={`flex items-start justify-between p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-purple-600/20 border-purple-500/50 shadow-sm'
                      : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="candidate_status"
                      value={opt.value}
                      checked={isSelected}
                      onChange={() => setSelected(opt.value)}
                      className="accent-purple-500 cursor-pointer mt-0.5"
                    />
                    <div>
                      <span
                        className={`font-semibold ${
                          isSelected ? 'text-purple-300' : 'text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">{opt.description}</p>
                    </div>
                  </div>
                  {isCurrent && (
                    <span className="text-[10px] font-semibold text-slate-500 bg-white/5 px-2 py-0.5 rounded shrink-0">
                      Current
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {/* Note Input */}
          <div className="space-y-1 pt-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Transition Note (Optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context for this status change..."
              rows={2}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/60 resize-none font-sans"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer actions */}
          <div className="pt-3 border-t border-[#261e38] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || selected === currentState}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-purple-900/40 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Updating...</span>
                </>
              ) : (
                <>
                  <ArrowRightCircle className="w-3.5 h-3.5" />
                  <span>Confirm Transition</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
