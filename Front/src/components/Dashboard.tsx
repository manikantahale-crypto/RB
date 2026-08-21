import React, { useState, useEffect } from 'react';
import { Briefcase, Users, CheckCircle2, AlertCircle, Zap, Plus, ArrowRight, Upload, FileText, FolderOpen, Loader2 } from 'lucide-react';
import { cleanJobTitle } from '../utils';

import { NavigationScreen } from '../types';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';

interface DashboardProps {
  onNavigate?: (screen: NavigationScreen) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState<'7' | '30'>('7');

  // Backend metrics states
  const [jobsCount, setJobsCount] = useState<number | string>('-');
  const [candidatesCount, setCandidatesCount] = useState<number | string>('-');
  const [readyCount, setReadyCount] = useState<number | string>('-');
  const [attentionCount, setAttentionCount] = useState<number | string>('-');
  const [topSkills, setTopSkills] = useState<any[]>([]);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [trends, setTrends] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [jobsRes, candRes, skillsRes, matchesRes, trendsRes] = await Promise.all([
        apiFetch('/jobs'),
        apiFetch('/candidates'),
        apiFetch('/skills/top?limit=6'),
        apiFetch('/matches/top?limit=50'),
        apiFetch(`/stats/daily-activity?days=${timeRange}`)
      ]);

      if (!jobsRes.ok || !candRes.ok || !skillsRes.ok || !matchesRes.ok || !trendsRes.ok) {
        throw new Error("Failed to fetch dashboard metrics from the Node API.");
      }

      const jobsData = await jobsRes.json();
      const candData = await candRes.json();
      const skillsData = await skillsRes.json();
      const matchesData = await matchesRes.json();
      const trendsData = await trendsRes.json();

      const rawJobs = jobsData.jobs || [];
      const rawCandidates = candData.candidates || [];
      const rawSkills = skillsData.skills || [];
      const rawMatches = matchesData.matches || [];
      const rawTrends = trendsData.days || [];

      // KPI Counts
      setJobsCount(rawJobs.length);
      setCandidatesCount(rawCandidates.length);

      // Ready to Submit (Highly Recommended match entries or match score >= 80)
      const readyMatches = rawMatches.filter((m: any) => m.score >= 80 || m.tier === 'highly_recommended' || m.tier === 'Highly Recommended');
      setReadyCount(readyMatches.length);

      // Needs attention: failed jobs or candidates parsing
      const failedJobs = rawJobs.filter((j: any) => j.processingStatus === 'failed').length;
      const failedCands = rawCandidates.filter((c: any) => c.processingStatus === 'failed').length;
      setAttentionCount(failedJobs + failedCands);

      // Top skills in demand mapping with HSL Hues
      const maxSkillCount = Math.max(...rawSkills.map((s: any) => s.count), 1);
      const skillColors = ['#a855f7', '#14b8a6', '#f43f5e', '#eab308', '#ec4899', '#3b82f6'];
      const mappedSkills = rawSkills.map((s: any, idx: number) => ({
        name: s.skill,
        count: s.count,
        color: skillColors[idx % skillColors.length],
        maxCount: maxSkillCount
      }));
      setTopSkills(mappedSkills);

      // Recent activities list mapping (keep only top 10 on the dashboard)
      const mappedActivities = rawMatches.slice(0, 10).map((m: any) => ({
        id: m.matchId || `${m.jobId}-${m.candidateId}`,
        jobTitle: cleanJobTitle(m.jobTitle || "Job Description Match"),
        company: m.candidateName || "Candidate",
        matchScore: Math.round(m.score) || 0,
        candidateCount: 1,
        timeAgo: "Recent"
      }));
      setRecentActivities(mappedActivities);
      setTrends(rawTrends);

    } catch (err: any) {
      console.error("Dashboard fetch error:", err);
      setError(err.message || "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [timeRange]);

  const handleActionClick = (actionName: string) => {
    alert(`${actionName} action triggered (local mock interface).`);
  };

  const showLoader = loading && jobsCount === '-' && candidatesCount === '-';

  // Check if we have active trends
  const hasTrendsData = trends.length > 0 && trends.some(
    (t) => t.matchesRequested > 0 || t.matchesCompleted > 0 || t.eligibleMatches > 0
  );

  // Find max value across all trends to scale Y axis dynamically
  const maxVal = Math.max(
    ...trends.map((t) => Math.max(t.matchesRequested, t.matchesCompleted, t.eligibleMatches)),
    10 // default minimum to look nice
  );

  // Map data to SVG coordinates
  // SVG viewBox is 500x180.
  // X spans from 40 to 480.
  // Y spans from 20 (maxVal) to 160 (0).
  const N = trends.length;
  const points = trends.map((t, idx) => {
    const x = N > 1 ? 40 + idx * (440 / (N - 1)) : 40;
    const yRequested = 160 - (t.matchesRequested / maxVal) * 140;
    const yCompleted = 160 - (t.matchesCompleted / maxVal) * 140;
    const yEligible = 160 - (t.eligibleMatches / maxVal) * 140;

    // Day label
    const dateObj = new Date(t.date);
    let label = '';
    if (N <= 7) {
      label = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      // 30 days: show every 5 days
      if (idx % 5 === 0 || idx === N - 1) {
        label = dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      }
    }

    return {
      x,
      yRequested,
      yCompleted,
      yEligible,
      label
    };
  });

  const requestedPath = points.length > 0
    ? points.map((p, idx) => (idx === 0 ? `M ${p.x} ${p.yRequested}` : `L ${p.x} ${p.yRequested}`)).join(' ')
    : '';
  const completedPath = points.length > 0
    ? points.map((p, idx) => (idx === 0 ? `M ${p.x} ${p.yCompleted}` : `L ${p.x} ${p.yCompleted}`)).join(' ')
    : '';
  const eligiblePath = points.length > 0
    ? points.map((p, idx) => (idx === 0 ? `M ${p.x} ${p.yEligible}` : `L ${p.x} ${p.yEligible}`)).join(' ')
    : '';

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Greeting & Top Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">
            Good morning, {user?.fullName || 'there'}
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Find the right candidates faster.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate ? onNavigate('upload') : handleActionClick('Add Job')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 text-sm font-medium transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Job</span>
          </button>
          <button
            onClick={() => onNavigate ? onNavigate('upload') : handleActionClick('Add Resumes')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium shadow-lg shadow-purple-900/30 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Resumes</span>
          </button>
        </div>
      </div>

      {showLoader && (
        <div className="py-24 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
          <span className="text-xs text-slate-400">Fetching dashboard metrics...</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs md:text-sm font-semibold flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!showLoader && (
        <>
          {/* KPI Cards Grid */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Overview
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Active Jobs */}
              <div className="relative p-5 rounded-2xl bg-[#130d22]/80 backdrop-blur-xl border border-purple-500/20 hover:border-purple-500/50 shadow-lg hover:shadow-[0_10px_30px_-10px_rgba(168,85,247,0.3)] hover:-translate-y-1 flex items-start justify-between overflow-hidden group transition-all duration-300 ease-out cursor-default">
                {/* Top accent line */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500/30 group-hover:h-[3px] group-hover:shadow-[0_0_12px_rgba(168,85,247,0.8)] transition-all duration-300" />
                
                <div className="space-y-2 z-10">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    ACTIVE JOBS
                  </span>
                  <div className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-sm">{jobsCount}</div>
                </div>
                <div className="p-3 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.15)] group-hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] group-hover:scale-105 transition-all duration-300 shrink-0">
                  <Briefcase className="w-5 h-5" />
                </div>
              </div>

              {/* Available Candidates */}
              <div className="relative p-5 rounded-2xl bg-[#0d1c22]/80 backdrop-blur-xl border border-teal-500/20 hover:border-teal-500/50 shadow-lg hover:shadow-[0_10px_30px_-10px_rgba(20,184,166,0.3)] hover:-translate-y-1 flex items-start justify-between overflow-hidden group transition-all duration-300 ease-out cursor-default">
                {/* Top accent line */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-teal-500 via-cyan-400 to-teal-500/30 group-hover:h-[3px] group-hover:shadow-[0_0_12px_rgba(20,184,166,0.8)] transition-all duration-300" />
                
                <div className="space-y-2 z-10">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    AVAILABLE CANDIDATES
                  </span>
                  <div className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-sm">{candidatesCount}</div>
                </div>
                <div className="p-3 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-300 shadow-[0_0_12px_rgba(20,184,166,0.15)] group-hover:shadow-[0_0_20px_rgba(20,184,166,0.4)] group-hover:scale-105 transition-all duration-300 shrink-0">
                  <Users className="w-5 h-5" />
                </div>
              </div>

              {/* Ready to Submit */}
              <div className="relative p-5 rounded-2xl bg-[#0d2019]/80 backdrop-blur-xl border border-emerald-500/20 hover:border-emerald-500/50 shadow-lg hover:shadow-[0_10px_30px_-10px_rgba(16,185,129,0.3)] hover:-translate-y-1 flex items-start justify-between overflow-hidden group transition-all duration-300 ease-out cursor-default">
                {/* Top accent line */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 via-green-400 to-emerald-500/30 group-hover:h-[3px] group-hover:shadow-[0_0_12px_rgba(16,185,129,0.8)] transition-all duration-300" />
                
                <div className="space-y-2 z-10">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    READY TO SUBMIT
                  </span>
                  <div className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-sm">{readyCount}</div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)] group-hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] group-hover:scale-105 transition-all duration-300 shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              </div>

              {/* Needs Attention */}
              <div className="relative p-5 rounded-2xl bg-[#22180d]/80 backdrop-blur-xl border border-amber-500/20 hover:border-amber-500/50 shadow-lg hover:shadow-[0_10px_30px_-10px_rgba(245,158,11,0.3)] hover:-translate-y-1 flex items-start justify-between overflow-hidden group transition-all duration-300 ease-out cursor-default">
                {/* Top accent line */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500/30 group-hover:h-[3px] group-hover:shadow-[0_0_12px_rgba(245,158,11,0.8)] transition-all duration-300" />
                
                <div className="space-y-2 z-10">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    NEEDS ATTENTION
                  </span>
                  <div className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-sm">{attentionCount}</div>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)] group-hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] group-hover:scale-105 transition-all duration-300 shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Match Highlight Card */}
          <div className="glass-card p-6 rounded-2xl border border-purple-500/30 bg-gradient-to-r from-purple-950/40 via-violet-950/20 to-slate-900/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300">
                  <Zap className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-100">Quick Match</h3>
              </div>
              <p className="text-sm text-slate-300 max-w-xl leading-relaxed">
                Upload a JD or Resume and instantly find matching candidates or jobs.
              </p>

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300">
                  <Upload className="w-3.5 h-3.5 text-purple-400" /> Drag & Drop
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300">
                  <FolderOpen className="w-3.5 h-3.5 text-purple-400" /> Browse Files
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300">
                  <FileText className="w-3.5 h-3.5 text-purple-400" /> Paste Text
                </span>
              </div>
            </div>

            <button
              onClick={() => onNavigate ? onNavigate('upload') : handleActionClick('Quick Match')}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-sm flex items-center gap-2 shadow-xl shadow-purple-900/40 transition-all transform hover:scale-[1.02] active:scale-95 cursor-pointer shrink-0"
            >
              <span>Quick Match</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Two-Column Analytics Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* LEFT: Matching Trends Line Chart */}
            <div className="lg:col-span-2 glass-card p-6 rounded-2xl space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-100">Matching Trends</h3>
                <div className="flex items-center bg-white/5 p-1 rounded-xl border border-white/10">
                  <button
                    onClick={() => setTimeRange('7')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      timeRange === '7' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    7 Days
                  </button>
                  <button
                    onClick={() => setTimeRange('30')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      timeRange === '30' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    30 Days
                  </button>
                </div>
              </div>

              {/* SVG Line Chart */}
              <div className="h-56 w-full relative pt-4 pb-2">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 500 180">
                  {/* Grid Lines */}
                  <line x1="30" y1="20" x2="490" y2="20" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                  <line x1="30" y1="60" x2="490" y2="60" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                  <line x1="30" y1="100" x2="490" y2="100" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                  <line x1="30" y1="140" x2="490" y2="140" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />

                  {/* Y Axis Labels */}
                  <text x="10" y="24" fill="#64748b" fontSize="10">{Math.round(maxVal)}</text>
                  <text x="10" y="64" fill="#64748b" fontSize="10">{Math.round(maxVal * 0.75)}</text>
                  <text x="10" y="104" fill="#64748b" fontSize="10">{Math.round(maxVal * 0.5)}</text>
                  <text x="10" y="144" fill="#64748b" fontSize="10">{Math.round(maxVal * 0.25)}</text>
                  <text x="10" y="178" fill="#64748b" fontSize="10">0</text>

                  {hasTrendsData ? (
                    <>
                      {/* Candidates Matched Line (Teal) */}
                      <path d={completedPath} fill="none" stroke="#14b8a6" strokeWidth="2.5" />
                      {points.map((p, idx) => (
                        <circle key={`comp-${idx}`} cx={p.x} cy={p.yCompleted} r="3" fill="#14b8a6" />
                      ))}

                      {/* Jobs Matched Line (Purple) */}
                      <path d={requestedPath} fill="none" stroke="#a855f7" strokeWidth="2.5" />
                      {points.map((p, idx) => (
                        <circle key={`req-${idx}`} cx={p.x} cy={p.yRequested} r="3" fill="#a855f7" />
                      ))}

                      {/* Candidates Shortlisted Line (Pink Dashed) */}
                      <path d={eligiblePath} fill="none" stroke="#ec4899" strokeWidth="2" strokeDasharray="4 4" />
                      {points.map((p, idx) => (
                        <circle key={`elig-${idx}`} cx={p.x} cy={p.yEligible} r="2.5" fill="#ec4899" />
                      ))}
                    </>
                  ) : (
                    /* Centered Empty State Text */
                    <text x="260" y="90" fill="#64748b" fontSize="12" textAnchor="middle" className="font-semibold">
                      No active matching trends to display.
                    </text>
                  )}

                  {/* X Axis Labels */}
                  {points.map((p, idx) => p.label && (
                    <text
                      key={idx}
                      x={p.x}
                      y="178"
                      fill="#64748b"
                      fontSize="9"
                      textAnchor="middle"
                    >
                      {p.label}
                    </text>
                  ))}
                </svg>
              </div>

              {/* Legend */}
              <div className="flex items-center justify-center gap-6 pt-2 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                  <span>Jobs Matched</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-teal-500" />
                  <span>Candidates Matched</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-pink-500" />
                  <span>Candidates Shortlisted</span>
                </div>
              </div>
            </div>

            {/* RIGHT: Top Skills in Demand */}
            <div className="glass-card p-6 rounded-2xl space-y-5">
              <div>
                <h3 className="text-base font-bold text-slate-100">Top Skills in Demand</h3>
                <p className="text-xs text-slate-400 mt-0.5">Extracted from active job descriptions</p>
              </div>

              <div className="space-y-3.5">
                {topSkills.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    No demand skill data available.
                  </div>
                ) : (
                  topSkills.map((skill) => {
                    const percent = Math.round((skill.count / skill.maxCount) * 100);
                    return (
                      <div key={skill.name} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: skill.color }} />
                            <span className="font-semibold text-slate-200">{skill.name}</span>
                          </div>
                          <span className="text-slate-400 font-mono text-[11px] bg-white/5 px-2 py-0.5 rounded-md border border-white/5">
                            {skill.count} Jobs
                          </span>
                        </div>

                        <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${percent}%`,
                              backgroundColor: skill.color,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Recent Matching Activity List */}
          <div className="glass-card p-6 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-100">Recent Matching Activity</h3>
              <button
                onClick={() => onNavigate ? onNavigate('matching') : handleActionClick('View All')}
                className="text-xs font-semibold text-purple-400 hover:text-purple-300 cursor-pointer"
              >
                View All in Workspace →
              </button>
            </div>

            <div className="divide-y divide-white/5">
              {recentActivities.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No recent match activities recorded.
                </div>
              ) : (
                recentActivities.map((act) => (
                  <div
                    key={act.id}
                    onClick={() => onNavigate ? onNavigate('matching') : handleActionClick(`Activity ${act.jobTitle}`)}
                    className="py-3.5 flex items-center justify-between gap-4 hover:bg-white/5 px-3 rounded-xl transition cursor-pointer group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-teal-400" />
                      <div>
                        <div className="text-sm font-semibold text-slate-100 group-hover:text-purple-300 transition">
                          {act.jobTitle}
                        </div>
                        <div className="text-xs text-slate-400">{act.company}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xs">
                        {act.matchScore}%
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xs font-medium">
                        {act.candidateCount} candidates
                      </span>
                      <span className="text-xs text-slate-500 min-w-[70px] text-right">
                        {act.timeAgo}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
