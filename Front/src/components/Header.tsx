import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, LogOut, User as UserIcon, Shield, ChevronDown, AlertTriangle } from 'lucide-react';
import { NavigationScreen } from '../types';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';

interface HeaderProps {
  activeScreen: NavigationScreen;
}

interface ReviewItem {
  id: string;
  title: string;
  message: string;
  actionType: string;
}

export const Header: React.FC<HeaderProps> = ({ activeScreen }) => {
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
    jobs: 'Job Descriptions',
    resumes: 'Resumes',
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

  return (
    <header className="h-16 px-8 border-b border-[#261e38] bg-[#0b0813]/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-20">
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
            <div className="absolute right-0 mt-2 w-80 glass-card rounded-2xl border border-amber-500/30 shadow-2xl p-3 z-50">
              <p className="text-xs font-bold text-slate-200 mb-2 px-1">Recruiter actions</p>
              {pendingCount === 0 ? (
                <p className="text-xs text-slate-400 px-1 py-2">No reviews pending.</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {reviewItems.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-amber-100">{item.title}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{item.message}</p>
                          <div className="flex gap-1.5 mt-2">
                            <button
                              type="button"
                              onClick={() => void decide(item.id, true)}
                              className="text-[10px] px-2 py-0.5 rounded bg-emerald-600/80 text-white font-semibold"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void decide(item.id, false)}
                              className="text-[10px] px-2 py-0.5 rounded bg-red-600/40 text-red-100 font-semibold border border-red-500/30"
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
