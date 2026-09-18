import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, LogOut, Shield, ChevronDown, AlertTriangle, Sparkles, ExternalLink } from 'lucide-react';
import { NavigationScreen } from '../types';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';

interface HeaderProps {
  activeScreen: NavigationScreen;
  onGoToMatch?: (mode: 'job' | 'resume', id: string) => void;
}

interface ReviewItem {
  id: string;
  title: string;
  message: string;
  actionType: string;
  payload?: {
    candidateId?: string;
    candidateName?: string;
    jobId?: string;
    jobTitle?: string;
    matchScore?: number;
    matchTier?: string;
    [key: string]: unknown;
  };
  createdAt?: string;
}

export const Header: React.FC<HeaderProps> = ({ activeScreen, onGoToMatch }) => {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const titles: Record<NavigationScreen, string> = {
    dashboard: 'Dashboard',
    upload: 'Upload & Analyze',
    matching: 'AI Matching Workspace',
    inbox: 'Smart Inbox',
    jobs: 'Job Descriptions',
    resumes: 'Resumes',
    vendors: 'Vendors',
    prism: 'Submission & RTR',
    settings: 'Settings',
  };

  const fetchReviews = useCallback(async () => {
    try {
      const res = await apiFetch('/recruiter/reviews/pending');
      if (res.ok) {
        const data = await res.json();
        setReviewItems(data.items || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void fetchReviews();
    const interval = setInterval(() => void fetchReviews(), 20000);
    return () => clearInterval(interval);
  }, [fetchReviews]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const decide = async (id: string, approved: boolean) => {
    await apiFetch(`/recruiter/reviews/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    });
    await fetchReviews();
  };

  const pendingCount = reviewItems.length;

  const watchItems = reviewItems.filter((i) => i.actionType === 'watch_match');
  const standardItems = reviewItems.filter((i) => i.actionType !== 'watch_match');

  // Group watch match items by candidateId to cleanly present multiple matching JDs
  const groupedWatchMap = new Map<string, {
    candidateId: string;
    candidateName: string;
    itemIds: string[];
    jobs: Array<{
      jobId?: string;
      jobTitle: string;
      company?: string;
      matchScore?: number;
      matchTier?: string;
    }>;
  }>();

  for (const item of watchItems) {
    const p = item.payload || {};
    const cId = (p.candidateId || p.candidate_id || item.id) as string;
    const cName = (p.candidateName || p.candidate_name || 'Watched Candidate') as string;
    const rawTitle = (p.jobTitle || p.job_title || item.title.replace(/^🎯\s*New\s*Watch\s*Match:\s*/i, '') || 'Job Opening') as string;
    const matchScore = typeof p.matchScore === 'number' ? p.matchScore : (typeof p.match_score === 'number' ? p.match_score : undefined);
    const matchTier = (p.matchTier || p.match_tier || '') as string;
    const company = (p.company || '') as string;

    if (!groupedWatchMap.has(cId)) {
      groupedWatchMap.set(cId, {
        candidateId: cId,
        candidateName: cName,
        itemIds: [item.id],
        jobs: [{ jobId: p.jobId as string, jobTitle: rawTitle, company, matchScore, matchTier }],
      });
    } else {
      const existing = groupedWatchMap.get(cId)!;
      existing.itemIds.push(item.id);
      if (!existing.jobs.some((j) => (j.jobId && j.jobId === p.jobId) || j.jobTitle === rawTitle)) {
        existing.jobs.push({ jobId: p.jobId as string, jobTitle: rawTitle, company, matchScore, matchTier });
      }
    }
  }

  const groupedWatchMatches = Array.from(groupedWatchMap.values());

  return (
    <header className="h-16 shrink-0 px-8 border-b border-[#261e38] bg-[#0b0813]/80 backdrop-blur-md flex items-center justify-between z-20">
      <h1 className="text-xl font-bold text-slate-100 tracking-tight">
        {titles[activeScreen] || 'Dashboard'}
      </h1>

      <div className="flex items-center gap-4">
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => {
              setNotifOpen(!notifOpen);
              void fetchReviews();
            }}
            className="relative p-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Recruiter review queue"
          >
            <Bell className="w-4 h-4" />
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-[10px] font-bold text-black flex items-center justify-center">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-92 glass-card rounded-2xl border border-purple-500/30 shadow-2xl p-3 z-50">
              <p className="text-xs font-bold text-slate-200 mb-2 px-1">Recruiter Notifications & Reviews</p>
              {pendingCount === 0 ? (
                <p className="text-xs text-slate-400 px-1 py-2">No reviews or notifications pending.</p>
              ) : (
                <ul className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
                  {/* 1. Grouped Watch Match Notifications */}
                  {groupedWatchMatches.map((group) => {
                    const isMulti = group.jobs.length > 1;
                    return (
                      <li
                        key={group.candidateId}
                        className="rounded-xl border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/15 p-2.5 transition-all"
                      >
                        <div className="flex items-start gap-2">
                          <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-xs font-semibold text-purple-100">
                                Watch Match Found — {group.candidateName}
                              </p>
                              {!isMulti && group.jobs[0]?.matchScore !== undefined && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/25 text-purple-200 border border-purple-500/40 shrink-0">
                                  {group.jobs[0].matchScore}%
                                </span>
                              )}
                            </div>

                            {isMulti ? (
                              <div className="mt-1">
                                <p className="text-[10px] text-purple-300/90 font-medium">
                                  {group.jobs.length} matching jobs found
                                </p>
                                <ul className="space-y-1 mt-1 border-l-2 border-purple-500/30 pl-2">
                                  {group.jobs.map((j, idx) => (
                                    <li key={idx} className="text-[10px] text-slate-300 truncate">
                                      • {j.jobTitle}{j.matchScore !== undefined ? ` — ${j.matchScore}%` : ''}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-300 mt-0.5 leading-relaxed">
                                • {group.jobs[0]?.jobTitle || 'Job Opening'}{group.jobs[0]?.matchScore !== undefined ? ` — ${group.jobs[0].matchScore}% match` : ''}
                              </p>
                            )}

                            <div className="flex items-center gap-1.5 mt-2.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onGoToMatch?.('resume', group.candidateId);
                                  setNotifOpen(false);
                                  group.itemIds.forEach((id) => void decide(id, true));
                                }}
                                className="text-[10px] px-2.5 py-1 rounded-md bg-purple-600 hover:bg-purple-500 text-white font-semibold flex items-center gap-1 cursor-pointer transition shadow-sm shadow-purple-900/40"
                              >
                                <ExternalLink className="w-3 h-3" />
                                {isMulti ? 'View Matches' : 'View Match'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  group.itemIds.forEach((id) => void decide(id, false));
                                }}
                                className="text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 font-semibold border border-white/10 cursor-pointer transition"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}

                  {/* 2. Standard Review / Approval Items */}
                  {standardItems.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 p-2.5 transition-all"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-amber-100">{item.title}</p>
                          <p className="text-[10px] text-slate-300 mt-0.5 leading-relaxed">{item.message}</p>
                          <div className="flex gap-1.5 mt-2">
                            <button
                              type="button"
                              onClick={() => void decide(item.id, true)}
                              className="text-[10px] px-2.5 py-1 rounded-md bg-emerald-600/80 hover:bg-emerald-500 text-white font-semibold cursor-pointer transition"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void decide(item.id, false)}
                              className="text-[10px] px-2 py-1 rounded-md bg-red-600/40 hover:bg-red-600/60 text-red-100 font-semibold border border-red-500/30 cursor-pointer transition"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="relative pl-2" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2.5 p-1 rounded-xl hover:bg-white/5 transition cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-xs font-bold text-white shadow-md shadow-purple-900/40 relative">
              {getInitials(user?.fullName)}
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#0b0813]" />
            </div>
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-semibold text-slate-200 group-hover:text-white leading-tight">
                {user?.fullName || 'User'}
              </span>
              <span className="text-[10px] text-purple-400 font-medium">
                {user?.role || 'Recruiter'}
              </span>
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${menuOpen ? 'rotate-180 text-purple-400' : ''}`}
            />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-64 glass-card rounded-2xl border border-purple-500/30 shadow-2xl p-3 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3 py-2.5 border-b border-purple-500/10 mb-2">
                <p className="text-sm font-bold text-slate-100 truncate">{user?.fullName}</p>
                <p className="text-xs text-slate-400 truncate mt-0.5">{user?.email}</p>
                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-purple-500/15 border border-purple-500/30 text-[10px] font-semibold text-purple-300">
                  <Shield className="w-3 h-3 text-purple-400" />
                  <span>{user?.role || 'Recruiter'}</span>
                </div>
              </div>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
