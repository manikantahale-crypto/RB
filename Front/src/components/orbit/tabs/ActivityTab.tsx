import React, { useState, useEffect } from 'react';
import {
  Activity,
  RefreshCw,
  Clock,
  StickyNote,
  ArrowRightCircle,
  CheckCircle2,
  DollarSign,
  AlertCircle,
  Loader2,
  UserCheck,
  FileText,
  Sparkles,
  Edit3,
  Target,
  ChevronDown,
  ChevronUp,
  Tag,
  ArrowRight,
  Briefcase,
  MapPin,
  Mail,
  Phone,
} from 'lucide-react';
import { CandidateProfile, OrbitActivityItem } from '../../../types';
import { apiFetch } from '../../../services/api';

interface ActivityTabProps {
  candidate: CandidateProfile;
}

interface DateGroup {
  dateLabel: string;
  dateKey: string;
  activities: OrbitActivityItem[];
}

export const ActivityTab: React.FC<ActivityTabProps> = ({ candidate }) => {
  const [activities, setActivities] = useState<OrbitActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const fetchActivities = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/candidates/${candidate.id}/activities`);
      if (res.ok) {
        const json = await res.json();
        const rawList: OrbitActivityItem[] = json.data || json.activities || [];
        // Strict chronological sort: newest occurred_at first
        const sorted = [...rawList].sort((a, b) => {
          const tA = new Date(a.occurred_at || a.created_at).getTime();
          const tB = new Date(b.occurred_at || b.created_at).getTime();
          return tB - tA;
        });
        setActivities(sorted);
      } else {
        throw new Error(`Failed to load activities (${res.status})`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load activity feed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (candidate.id) {
      fetchActivities();
    }
  }, [candidate.id]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Format Date Group Label (TODAY, YESTERDAY, AUG 20, 2026)
  const getDateLabel = (dateStr: string): string => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'UNKNOWN DATE';

    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    if (isToday) return 'TODAY';

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return 'YESTERDAY';

    return d
      .toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      .toUpperCase();
  };

  // Group activities purely by date in descending chronological order
  const dateGroups: DateGroup[] = [];
  activities.forEach((act) => {
    const d = new Date(act.occurred_at || act.created_at);
    const dateKey = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : 'undated';
    const dateLabel = getDateLabel(act.occurred_at || act.created_at);

    let group = dateGroups.find((g) => g.dateKey === dateKey);
    if (!group) {
      group = { dateLabel, dateKey, activities: [] };
      dateGroups.push(group);
    }
    group.activities.push(act);
  });

  const getEventMeta = (type: string) => {
    switch (type) {
      case 'CANDIDATE_CREATED':
        return {
          title: 'Candidate Added',
          icon: <UserCheck className="w-3.5 h-3.5 text-emerald-400" />,
          badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
          dotBg: 'bg-emerald-500',
        };
      case 'RESUME_UPLOADED':
        return {
          title: 'Resume Uploaded',
          icon: <FileText className="w-3.5 h-3.5 text-blue-400" />,
          badgeColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
          dotBg: 'bg-blue-500',
        };
      case 'RESUME_PARSED':
        return {
          title: 'Resume Parsed',
          icon: <Sparkles className="w-3.5 h-3.5 text-purple-400" />,
          badgeColor: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
          dotBg: 'bg-purple-500',
        };
      case 'PROFILE_UPDATED':
        return {
          title: 'Profile Updated',
          icon: <Edit3 className="w-3.5 h-3.5 text-amber-400" />,
          badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
          dotBg: 'bg-amber-500',
        };
      case 'RESUME_REPLACED':
        return {
          title: 'Resume Replaced',
          icon: <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />,
          badgeColor: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
          dotBg: 'bg-cyan-500',
        };
      case 'AI_MATCH_COMPLETED':
        return {
          title: 'AI Match Completed',
          icon: <Target className="w-3.5 h-3.5 text-purple-400" />,
          badgeColor: 'bg-purple-600/20 text-purple-200 border-purple-500/30',
          dotBg: 'bg-purple-600',
        };
      case 'LIFECYCLE_CHANGED':
        return {
          title: 'Status Changed',
          icon: <ArrowRightCircle className="w-3.5 h-3.5 text-indigo-400" />,
          badgeColor: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
          dotBg: 'bg-indigo-500',
        };
      case 'PLACEMENT_CONFIRMED':
        return {
          title: 'Candidate Placed',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
          badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
          dotBg: 'bg-emerald-400',
        };
      case 'COMMERCIAL_UPDATED':
        return {
          title: 'Commercial Details Updated',
          icon: <DollarSign className="w-3.5 h-3.5 text-green-400" />,
          badgeColor: 'bg-green-500/10 text-green-300 border-green-500/20',
          dotBg: 'bg-green-500',
        };
      case 'NOTE':
        return {
          title: 'Recruiter Note',
          icon: <StickyNote className="w-3.5 h-3.5 text-amber-400" />,
          badgeColor: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
          dotBg: 'bg-amber-400',
        };
      default:
        return {
          title: type.replace(/_/g, ' '),
          icon: <Activity className="w-3.5 h-3.5 text-slate-400" />,
          badgeColor: 'bg-white/5 text-slate-300 border-white/10',
          dotBg: 'bg-slate-400',
        };
    }
  };

  const renderDetails = (act: OrbitActivityItem) => {
    const payload = act.payload || {};

    switch (act.activity_type) {
      case 'PROFILE_UPDATED': {
        const changes = Array.isArray(payload.changes) ? payload.changes : [];
        if (changes.length === 0) return null;
        return (
          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Field Changes ({changes.length})
            </div>
            <div className="space-y-1.5">
              {changes.map((ch: any, i: number) => (
                <div
                  key={i}
                  className="p-2 rounded-lg bg-black/30 border border-white/5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                >
                  <span className="font-medium text-slate-400 min-w-[120px]">
                    {ch.fieldLabel || ch.field}:
                  </span>
                  <div className="flex items-center gap-2 text-slate-200">
                    <span className="line-through text-slate-500 text-[11px]">
                      {ch.before || 'None'}
                    </span>
                    <ArrowRight className="w-3 h-3 text-purple-400 shrink-0" />
                    <span className="font-semibold text-purple-300">
                      {ch.after || 'None'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }

      case 'RESUME_PARSED': {
        const skills: string[] = Array.isArray(payload.skills) ? payload.skills : [];
        return (
          <div className="mt-3 pt-3 border-t border-white/5 space-y-2.5">
            {skills.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Extracted Skills ({skills.length})
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                  {skills.map((skill, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[11px] font-medium"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {payload.summary && (
              <div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Profile Summary
                </div>
                <p className="text-xs text-slate-300 bg-black/20 p-2.5 rounded-lg border border-white/5 leading-relaxed">
                  {payload.summary}
                </p>
              </div>
            )}
            {(payload.currentCompany || payload.location) && (
              <div className="flex flex-wrap gap-4 text-xs text-slate-400 pt-1">
                {payload.currentCompany && (
                  <div className="flex items-center gap-1.5">
                    <Briefcase className="w-3 h-3 text-slate-500" />
                    <span>{payload.currentCompany}</span>
                  </div>
                )}
                {payload.location && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3 h-3 text-slate-500" />
                    <span>{payload.location}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }

      case 'AI_MATCH_COMPLETED': {
        const matches: any[] = Array.isArray(payload.matches) ? payload.matches : [];
        return (
          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              <span>Top Matched Job Descriptions</span>
              <span className="text-purple-300 lowercase font-normal">
                {payload.jobsEvaluated || 0} evaluated ┬À {payload.matchesFound || 0} found
              </span>
            </div>
            {matches.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No qualifying jobs above threshold</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {matches.map((m, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-black/30 border border-white/5 flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-medium text-slate-200 truncate" title={m.title}>
                      {m.title}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-[11px] shrink-0">
                      {m.score}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      case 'CANDIDATE_CREATED': {
        return (
          <div className="mt-3 pt-3 border-t border-white/5 space-y-1.5 text-xs text-slate-300">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {payload.email && (
                <div className="flex items-center gap-1.5 text-slate-300">
                  <Mail className="w-3 h-3 text-slate-500" />
                  <span className="truncate">{payload.email}</span>
                </div>
              )}
              {payload.phone && (
                <div className="flex items-center gap-1.5 text-slate-300">
                  <Phone className="w-3 h-3 text-slate-500" />
                  <span>{payload.phone}</span>
                </div>
              )}
              {payload.fileName && (
                <div className="flex items-center gap-1.5 text-slate-300">
                  <FileText className="w-3 h-3 text-purple-400" />
                  <span className="truncate">{payload.fileName}</span>
                </div>
              )}
              {payload.source && (
                <div className="flex items-center gap-1.5 text-slate-300">
                  <Tag className="w-3 h-3 text-slate-500" />
                  <span>Source: {payload.source}</span>
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'PLACEMENT_CONFIRMED': {
        return (
          <div className="mt-3 pt-3 border-t border-white/5 space-y-2 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-black/20 p-2.5 rounded-lg border border-white/5">
              <div>
                <span className="text-[10px] text-slate-500 block">Bill Rate</span>
                <span className="font-bold text-slate-100">
                  ${payload.confirmed_bill_rate || payload.billRate || '0'}/hr
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Pay Rate</span>
                <span className="font-bold text-slate-100">
                  ${payload.confirmed_pay_rate || payload.payRate || '0'}/hr
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block">Monthly Margin</span>
                <span className="font-bold text-emerald-400">
                  ${payload.monthly_gross_margin || payload.grossMargin || '0'}
                </span>
              </div>
            </div>
            {payload.notes && (
              <p className="text-slate-400 text-xs italic bg-white/5 p-2 rounded-md">
                "{payload.notes}"
              </p>
            )}
          </div>
        );
      }

      case 'LIFECYCLE_CHANGED': {
        return payload.note || payload.reason ? (
          <div className="mt-3 pt-3 border-t border-white/5 text-xs text-slate-300">
            <span className="text-[10px] text-slate-500 block uppercase font-semibold">
              Transition Reason / Note:
            </span>
            <p className="mt-0.5 text-slate-200">{payload.note || payload.reason}</p>
          </div>
        ) : null;
      }

      default:
        return null;
    }
  };

  const hasExpandableDetails = (act: OrbitActivityItem): boolean => {
    switch (act.activity_type) {
      case 'PROFILE_UPDATED':
        return Boolean(act.payload?.changes && act.payload.changes.length > 0);
      case 'RESUME_PARSED':
        return Boolean(
          (act.payload?.skills && act.payload.skills.length > 0) || act.payload?.summary
        );
      case 'AI_MATCH_COMPLETED':
        return Boolean(act.payload?.matches && act.payload.matches.length > 0);
      case 'CANDIDATE_CREATED':
        return Boolean(act.payload?.email || act.payload?.phone || act.payload?.fileName);
      case 'PLACEMENT_CONFIRMED':
        return Boolean(act.payload?.confirmed_bill_rate || act.payload?.billRate);
      case 'LIFECYCLE_CHANGED':
        return Boolean(act.payload?.note || act.payload?.reason);
      default:
        return false;
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* HEADER */}
      <div className="flex items-center justify-between pb-2 border-b border-[#261e38]">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Chronological Activity Log ({activities.length})
          </span>
        </div>
        <button
          onClick={fetchActivities}
          disabled={loading}
          className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
          title="Refresh activity timeline"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          <span>Loading chronological activity timeline...</span>
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-16 text-slate-400 space-y-2 p-6 rounded-2xl bg-white/5 border border-white/5">
          <Activity className="w-8 h-8 text-purple-400/40 mx-auto" />
          <p className="text-sm font-semibold text-slate-200">No activity logged yet</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Candidate creation, resume parsing, profile changes, status transitions, and match runs will appear here in chronological order.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {dateGroups.map((group) => (
            <div key={group.dateKey} className="space-y-3">
              {/* DATE GROUP BADGE */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-extrabold tracking-wider text-purple-400 px-2.5 py-1 rounded-md bg-purple-500/10 border border-purple-500/20">
                  {group.dateLabel}
                </span>
                <div className="h-[1px] flex-1 bg-gradient-to-r from-purple-500/20 to-transparent" />
              </div>

              {/* TIMELINE ITEMS FOR THIS DATE */}
              <div className="relative pl-6 space-y-3 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[1.5px] before:bg-purple-500/20">
                {group.activities.map((act) => {
                  const meta = getEventMeta(act.activity_type);
                  const isExpanded = expandedIds.has(act.id);
                  const canExpand = hasExpandableDetails(act);
                  const timeStr = new Date(act.occurred_at || act.created_at).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  });

                  return (
                    <div key={act.id} className="relative group">
                      {/* Timeline Dot Indicator */}
                      <div className="absolute -left-6 top-3 w-3 h-3 rounded-full bg-[#0e0a1a] border-2 border-purple-400 flex items-center justify-center shadow-md shadow-purple-950">
                        <span className={`w-1 h-1 rounded-full ${meta.dotBg}`} />
                      </div>

                      {/* Compact Event Card */}
                      <div className="p-3.5 rounded-xl bg-[#130e24] border border-[#2b2144] hover:border-purple-500/40 transition shadow-sm space-y-1.5">
                        {/* Header: Event Type & Timestamp */}
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="p-1 rounded-md bg-white/5">{meta.icon}</span>
                            <span className="font-bold text-slate-100">{meta.title}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                            <Clock className="w-3 h-3 text-slate-500" />
                            <span>{timeStr}</span>
                          </div>
                        </div>

                        {/* Concise Summary & Details Toggle */}
                        <div className="flex items-start justify-between gap-3 pt-0.5">
                          <p className="text-xs text-slate-300 font-normal leading-relaxed">
                            {act.summary}
                          </p>
                          {canExpand && (
                            <button
                              onClick={() => toggleExpand(act.id)}
                              className="text-[11px] font-semibold text-purple-400 hover:text-purple-300 flex items-center gap-0.5 shrink-0 px-2 py-0.5 rounded hover:bg-purple-500/10 transition cursor-pointer"
                            >
                              <span>{isExpanded ? 'Hide' : 'Details'}</span>
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>

                        {/* Expanded Content */}
                        {isExpanded && renderDetails(act)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
