import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw, Clock, StickyNote, ArrowRightCircle, CheckCircle, DollarSign, AlertCircle, Loader2 } from 'lucide-react';
import { CandidateProfile, OrbitActivityItem } from '../../../types';
import { apiFetch } from '../../../services/api';

interface ActivityTabProps {
  candidate: CandidateProfile;
}

export const ActivityTab: React.FC<ActivityTabProps> = ({ candidate }) => {
  const [activities, setActivities] = useState<OrbitActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/candidates/${candidate.id}/activities`);
      if (res.ok) {
        const json = await res.json();
        setActivities(json.data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load activity feed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, [candidate.id]);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'LIFECYCLE_CHANGED':
        return <ArrowRightCircle className="w-3.5 h-3.5 text-blue-400" />;
      case 'NOTE':
        return <StickyNote className="w-3.5 h-3.5 text-amber-400" />;
      case 'PLACEMENT_CONFIRMED':
        return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
      case 'REVENUE_UPDATED':
        return <DollarSign className="w-3.5 h-3.5 text-purple-400" />;
      default:
        return <Activity className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          Chronological Activity Log ({activities.length})
        </span>
        <button
          onClick={fetchActivities}
          disabled={loading}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
          title="Refresh activity timeline"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400 gap-2 text-xs">
          <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
          <span>Loading activity history...</span>
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-10 text-slate-400 space-y-1.5 p-4 rounded-xl bg-white/5 border border-white/5">
          <Activity className="w-6 h-6 text-purple-400/40 mx-auto" />
          <p className="text-xs font-semibold text-slate-300">No activity logged yet</p>
          <p className="text-[11px] text-slate-500">Status transitions and notes will appear in this timeline.</p>
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-purple-500/20">
          {activities.map((act) => (
            <div key={act.id} className="relative group">
              {/* Dot Icon */}
              <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-[#120c24] border border-white/20 flex items-center justify-center shadow-sm">
                {getActivityIcon(act.activity_type)}
              </div>

              {/* Card */}
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1 hover:border-purple-500/30 transition">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="font-semibold uppercase tracking-wider text-purple-300">
                    {act.activity_type.replace(/_/g, ' ')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span>
                      {new Date(act.occurred_at || act.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed font-normal">
                  {act.summary}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
