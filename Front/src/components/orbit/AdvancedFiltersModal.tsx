import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Search,
  Check,
  Filter,
  Sparkles,
  RotateCcw,
  Calendar,
  Briefcase,
  Globe,
  Award,
  Clock,
  DollarSign,
  UserCheck,
  Tag,
  SlidersHorizontal,
} from 'lucide-react';
import { CandidateProfile } from '../../types';

export interface AdvancedFilterState {
  statuses: string[];
  freshness: string[];
  expRanges: string[];
  minExp: number | null;
  maxExp: number | null;
  skills: string[];
  visas: string[];
  locations: string[];
  availabilities: string[];
  benchTimes: string[];
  sources: string[];
  placementStatuses: string[];
  rateRanges: string[];
  minRate: number | null;
  maxRate: number | null;
  poolStatuses: string[];
}

export const INITIAL_FILTER_STATE: AdvancedFilterState = {
  statuses: [],
  freshness: [],
  expRanges: [],
  minExp: null,
  maxExp: null,
  skills: [],
  visas: [],
  locations: [],
  availabilities: [],
  benchTimes: [],
  sources: [],
  placementStatuses: [],
  rateRanges: [],
  minRate: null,
  maxRate: null,
  poolStatuses: [],
};

interface AdvancedFiltersModalProps {
  isOpen: boolean;
  onClose: () => void;
  appliedFilters: AdvancedFilterState;
  onApplyFilters: (filters: AdvancedFilterState) => void;
  candidates: CandidateProfile[];
}

type FilterCategoryKey =
  | 'status'
  | 'freshness'
  | 'experience'
  | 'skills'
  | 'visa'
  | 'location'
  | 'availability'
  | 'benchTime'
  | 'source'
  | 'placement'
  | 'salary'
  | 'pool';

interface CategoryConfig {
  key: FilterCategoryKey;
  label: string;
  icon: React.ReactNode;
}

const CATEGORIES: CategoryConfig[] = [
  { key: 'status', label: 'Status', icon: <UserCheck className="w-4 h-4" /> },
  { key: 'freshness', label: 'Resume Freshness', icon: <Calendar className="w-4 h-4" /> },
  { key: 'experience', label: 'Experience', icon: <Briefcase className="w-4 h-4" /> },
  { key: 'skills', label: 'Skills', icon: <Sparkles className="w-4 h-4" /> },
  { key: 'visa', label: 'Visa Status', icon: <Award className="w-4 h-4" /> },
  { key: 'location', label: 'Location', icon: <Globe className="w-4 h-4" /> },
  { key: 'availability', label: 'Availability', icon: <Clock className="w-4 h-4" /> },
  { key: 'benchTime', label: 'Bench Time', icon: <Clock className="w-4 h-4" /> },
  { key: 'source', label: 'Source', icon: <Tag className="w-4 h-4" /> },
  { key: 'placement', label: 'Placement Status', icon: <SlidersHorizontal className="w-4 h-4" /> },
  { key: 'placement', label: 'Placement Status', icon: <SlidersHorizontal className="w-4 h-4" /> },
  { key: 'salary', label: 'Salary / Rate', icon: <DollarSign className="w-4 h-4" /> },
  { key: 'pool', label: 'Candidate Pool', icon: <UserCheck className="w-4 h-4" /> },
];

function parseExpYears(exp: string | number | undefined): number {
  if (exp == null) return 0;
  if (typeof exp === 'number') return exp;
  const match = String(exp).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

function getDaysSinceUploaded(dateString?: string): number {
  if (!dateString) return 30;
  const time = new Date(dateString).getTime();
  if (isNaN(time)) return 30;
  const diffMs = Date.now() - time;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function filterCandidate(candidate: CandidateProfile, filters: AdvancedFilterState): boolean {
  // 1. STATUS (OR logic within category)
  if (filters.statuses.length > 0) {
    const candState = (candidate.orbit_lifecycle_state || 'AVAILABLE').toUpperCase();
    if (!filters.statuses.some((st) => st.toUpperCase() === candState)) {
      return false;
    }
  }

  // 2. RESUME FRESHNESS (OR logic within category)
  if (filters.freshness.length > 0) {
    const days = getDaysSinceUploaded(candidate.uploadedDate);
    const matchesFreshness = filters.freshness.some((f) => {
      if (f === 'Last 24 Hours') return days <= 1;
      if (f === 'Last 7 Days') return days <= 7;
      if (f === 'Last 14 Days') return days <= 14;
      if (f === 'Last 30 Days') return days <= 30;
      if (f === 'Older than 30 Days') return days > 30;
      return false;
    });
    if (!matchesFreshness) return false;
  }

  // 3. EXPERIENCE (OR logic within ranges + min/max AND bounds)
  const candExp = candidate.expYears || parseExpYears(candidate.experience);
  if (filters.expRanges.length > 0) {
    const matchesExpRange = filters.expRanges.some((r) => {
      if (r === '0–2 Years') return candExp <= 2;
      if (r === '3–5 Years') return candExp >= 3 && candExp <= 5;
      if (r === '6–8 Years') return candExp >= 6 && candExp <= 8;
      if (r === '9–12 Years') return candExp >= 9 && candExp <= 12;
      if (r === '12+ Years') return candExp >= 12;
      return false;
    });
    if (!matchesExpRange) return false;
  }
  if (filters.minExp !== null && candExp < filters.minExp) return false;
  if (filters.maxExp !== null && candExp > filters.maxExp) return false;

  // 4. SKILLS (OR logic within category: matches any selected skill)
  if (filters.skills.length > 0) {
    const candSkills = (candidate.matchedSkills || []).map((s) => s.toLowerCase());
    const matchesSkill = filters.skills.some((req) =>
      candSkills.some((cs) => cs.includes(req.toLowerCase()) || req.toLowerCase().includes(cs))
    );
    if (!matchesSkill) return false;
  }

  // 5. VISA / WORK AUTHORIZATION (OR logic within category)
  if (filters.visas.length > 0) {
    const candVisa = (candidate.visa || '').toLowerCase();
    const matchesVisa = filters.visas.some((v) => candVisa.includes(v.toLowerCase()));
    if (!matchesVisa) return false;
  }

  // 6. LOCATION (OR logic within category)
  if (filters.locations.length > 0) {
    const candLoc = (candidate.location || '').toLowerCase();
    const matchesLoc = filters.locations.some((loc) => candLoc.includes(loc.toLowerCase()));
    if (!matchesLoc) return false;
  }

  // 7. AVAILABILITY (OR logic within category)
  if (filters.availabilities.length > 0) {
    const candState = (candidate.orbit_lifecycle_state || 'AVAILABLE').toUpperCase();
    const matchesAvail = filters.availabilities.some((av) => {
      if (av === 'Immediate') return candState === 'AVAILABLE' || candState === 'BENCH';
      if (av === '1–2 Weeks Notice') return candState === 'NOTICE';
      if (av === '30 Days Notice') return candState === 'NOTICE' || candState === 'HOLD';
      if (av === 'Specific Date / Future') return candState === 'HOLD' || candState === 'OLD';
      return false;
    });
    if (!matchesAvail) return false;
  }

  // 8. BENCH TIME (OR logic within category)
  if (filters.benchTimes.length > 0) {
    const days = getDaysSinceUploaded(candidate.uploadedDate);
    const matchesBench = filters.benchTimes.some((bt) => {
      if (bt === '< 1 Month') return days < 30;
      if (bt === '1–3 Months') return days >= 30 && days <= 90;
      if (bt === '3–6 Months') return days >= 90 && days <= 180;
      if (bt === '6+ Months') return days > 180;
      return false;
    });
    if (!matchesBench) return false;
  }

  // 9. SOURCE (OR logic within category)
  if (filters.sources.length > 0) {
    const fileName = (candidate.fileName || '').toLowerCase();
    const matchesSource = filters.sources.some((src) => {
      if (src === 'Resume Upload') return true;
      if (src === 'Email Ingestion') return fileName.includes('email') || fileName.includes('inbox');
      if (src === 'Direct Application') return fileName.includes('app');
      return true;
    });
    if (!matchesSource) return false;
  }

  // 10. PLACEMENT STATUS (OR logic within category)
  if (filters.placementStatuses.length > 0) {
    const candState = (candidate.orbit_lifecycle_state || 'AVAILABLE').toUpperCase();
    const matchesPl = filters.placementStatuses.some((pl) => {
      if (pl === 'Open for Marketing') return candState === 'AVAILABLE' || candState === 'BENCH';
      if (pl === 'Interviewing / Screening') return candState === 'PRIORITIZE' || candState === 'NOTICE';
      if (pl === 'Offer Received') return candState === 'HOLD';
      if (pl === 'Placed on Engagement') return candState === 'PLACED';
      return false;
    });
    if (!matchesPl) return false;
  }

  // 11. SALARY / RATE
  if (filters.rateRanges.length > 0) {
    const rateNum = parseFloat(candidate.minRate || '70') || 70;
    const matchesRate = filters.rateRanges.some((rr) => {
      if (rr === '< $50 / hr') return rateNum < 50;
      if (rr === '$50 – $70 / hr') return rateNum >= 50 && rateNum <= 70;
      if (rr === '$70 – $90 / hr') return rateNum >= 70 && rateNum <= 90;
      if (rr === '$90 – $120 / hr') return rateNum >= 90 && rateNum <= 120;
      if (rr === '$120+ / hr') return rateNum >= 120;
      return false;
    });
    if (!matchesRate) return false;
  }

  // 12. POOL STATUS (OR logic within category)
  if (filters.poolStatuses && filters.poolStatuses.length > 0) {
    const candPool = candidate.poolStatus || 'Active';
    if (!filters.poolStatuses.includes(candPool)) {
      return false;
    }
  }

  return true;
}

export const AdvancedFiltersModal: React.FC<AdvancedFiltersModalProps> = ({
  isOpen,
  onClose,
  appliedFilters,
  onApplyFilters,
  candidates,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<FilterCategoryKey>('status');
  const [draftFilters, setDraftFilters] = useState<AdvancedFilterState>(appliedFilters);
  const [skillsSearch, setSkillsSearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');

  // Sync draft state whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setDraftFilters(appliedFilters);
      setSelectedCategory('status');
      setSkillsSearch('');
      setLocationSearch('');
    }
  }, [isOpen, appliedFilters]);

  // Live Matching Candidates Count
  const liveMatchCount = useMemo(() => {
    return candidates.filter((c) => filterCandidate(c, draftFilters)).length;
  }, [candidates, draftFilters]);

  // Active / Passive Candidate Counts (Dynamic from dataset: < 15 days vs 15+ days)
  const activeCount = useMemo(() => {
    return candidates.filter((c) => (c.poolStatus || 'Active') === 'Active').length;
  }, [candidates]);

  const passiveCount = useMemo(() => {
    return candidates.filter((c) => (c.poolStatus || 'Active') === 'Passive').length;
  }, [candidates]);

  // Dynamic values extracted from candidates dataset
  const dynamicLocations = useMemo(() => {
    const locs = Array.from(new Set(candidates.map((c) => c.location).filter(Boolean))).filter(
      (l) => l !== 'N/A' && l !== 'Remote'
    );
    const standardHubs = [
      'Remote',
      'Atlanta, GA',
      'Austin, TX',
      'Bengaluru',
      'Chicago, IL',
      'Dallas, TX',
      'Hyderabad',
      'Jersey City, NJ',
      'New York, NY',
      'San Francisco, CA',
      'Seattle, WA',
    ];
    return Array.from(new Set([...standardHubs, ...locs])).sort();
  }, [candidates]);

  const dynamicSkills = useMemo(() => {
    const candSkills = candidates.flatMap((c) => (Array.isArray(c.matchedSkills) ? c.matchedSkills : []));
    const standardSkills = [
      'AWS',
      'Angular',
      'Apache Spark',
      'Azure',
      'C#',
      'Databricks',
      'Docker',
      'Express',
      'FastAPI',
      'GCP',
      'Generative AI',
      'HTML5',
      'Java',
      'JavaScript',
      'Kubernetes',
      'Microservices',
      'Node.js',
      'PostgreSQL',
      'Power Apps',
      'Power Automate',
      'Power BI',
      'Python',
      'React',
      'React.js',
      'REST APIs',
      'SQL',
      'Salesforce',
      'Snowflake',
      'Spring Boot',
      'Tableau',
      'TypeScript',
    ];
    return Array.from(new Set([...standardSkills, ...candSkills])).filter(Boolean).sort();
  }, [candidates]);

  if (!isOpen) return null;

  // Toggle helpers
  const toggleArrayItem = (category: keyof AdvancedFilterState, item: string) => {
    setDraftFilters((prev) => {
      const currentList = (prev[category] as string[]) || [];
      const exists = currentList.includes(item);
      const nextList = exists ? currentList.filter((i) => i !== item) : [...currentList, item];
      return {
        ...prev,
        [category]: nextList,
      };
    });
  };

  const handleResetAll = () => {
    setDraftFilters(INITIAL_FILTER_STATE);
  };

  const handleApply = () => {
    onApplyFilters(draftFilters);
    onClose();
  };

  // Check how many items selected in a category for category badges
  const getCategoryCount = (key: FilterCategoryKey): number => {
    switch (key) {
      case 'status':
        return draftFilters.statuses.length;
      case 'freshness':
        return draftFilters.freshness.length;
      case 'experience':
        return (
          draftFilters.expRanges.length +
          (draftFilters.minExp !== null ? 1 : 0) +
          (draftFilters.maxExp !== null ? 1 : 0)
        );
      case 'skills':
        return draftFilters.skills.length;
      case 'visa':
        return draftFilters.visas.length;
      case 'location':
        return draftFilters.locations.length;
      case 'availability':
        return draftFilters.availabilities.length;
      case 'benchTime':
        return draftFilters.benchTimes.length;
      case 'source':
        return draftFilters.sources.length;
      case 'placement':
        return draftFilters.placementStatuses.length;
      case 'salary':
        return (
          draftFilters.rateRanges.length +
          (draftFilters.minRate !== null ? 1 : 0) +
          (draftFilters.maxRate !== null ? 1 : 0)
        );
      default:
        return 0;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 font-sans animate-in fade-in duration-150">
      <div className="bg-[#0f0a1f] border border-purple-500/30 rounded-2xl w-full max-w-5xl h-[88vh] max-h-[820px] flex flex-col shadow-2xl overflow-hidden relative text-slate-100">
        {/* ========================================================================= */}
        {/* 1. MODAL HEADER */}
        {/* ========================================================================= */}
        <div className="px-6 py-4 border-b border-[#261e38] bg-[#140e29] flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-6 rounded-full bg-purple-500 shadow-sm shadow-purple-500/50" />
              <h2 className="text-xl font-extrabold text-white tracking-tight">
                Advanced Filters
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 pl-4">
              Categories combine with AND logic. Multiple values within a category use OR logic.
            </p>
          </div>

          {/* Top-Right: Passive / Active Counts + Close Button */}
          <div className="flex items-center gap-3">
            {/* Passive Chip */}
            <div className="hidden sm:flex flex-col items-center px-3 py-1 rounded-xl bg-[#1c1436] border border-purple-500/20 text-center">
              <span className="text-[10px] text-slate-400 font-medium">Passive (15+ days)</span>
              <span className="text-xs font-bold text-slate-200">{passiveCount} candidates</span>
            </div>

            {/* Active Chip */}
            <div className="hidden sm:flex flex-col items-center px-3 py-1 rounded-xl bg-[#1c1436] border border-purple-500/20 text-center">
              <span className="text-[10px] text-slate-400 font-medium">Active (&lt; 15 days)</span>
              <span className="text-xs font-bold text-emerald-300">{activeCount} candidates</span>
            </div>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. TWO-PANEL CONTENT BODY */}
        {/* ========================================================================= */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* ----------------------------------------------------------------------- */}
          {/* LEFT SIDE: FILTER CATEGORY NAVIGATION */}
          {/* ----------------------------------------------------------------------- */}
          <div className="w-56 sm:w-64 border-r border-[#261e38] bg-[#0c0818] p-3 space-y-1 overflow-y-auto shrink-0">
            {CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.key;
              const count = getCategoryCount(cat.key);
              return (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${isSelected
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-900/40'
                      : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <span className={isSelected ? 'text-white' : 'text-purple-400'}>
                      {cat.icon}
                    </span>
                    <span className="truncate">{cat.label}</span>
                  </div>
                  {count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${isSelected ? 'bg-white/25 text-white' : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ----------------------------------------------------------------------- */}
          {/* RIGHT SIDE: SELECTED CATEGORY OPTIONS PANEL */}
          {/* ----------------------------------------------------------------------- */}
          <div className="flex-1 bg-[#120c24] p-6 overflow-y-auto space-y-5">
            {/* ==================== 1. STATUS ==================== */}
            {selectedCategory === 'status' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Status
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Select one or more statuses. Results match any selected (OR logic).
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    { id: 'AVAILABLE', label: 'Available', desc: 'Active & ready for client placement' },
                    { id: 'BENCH', label: 'Bench', desc: 'On active bench marketing pool' },
                    { id: 'NOTICE', label: 'Notice', desc: 'Currently serving notice period' },
                    { id: 'PLACED', label: 'Placed', desc: 'Actively working on client project' },
                    { id: 'HOLD', label: 'Hold', desc: 'Temporarily on hold / reserved' },
                    { id: 'PRIORITIZE', label: 'Prioritize', desc: 'High priority marketing focus' },
                    { id: 'OLD', label: 'Old', desc: 'Historical profile' },
                    { id: 'IGNORE', label: 'Ignore', desc: 'Excluded from marketing' },
                  ].map((item) => {
                    const isChecked = draftFilters.statuses.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        onClick={() => toggleArrayItem('statuses', item.id)}
                        className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                            ? 'bg-purple-900/30 border-purple-500 text-white shadow-sm'
                            : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-slate-600 bg-slate-900/50'
                            }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <div>
                          <span className="font-bold text-xs block">{item.label}</span>
                          <span className="text-[11px] text-slate-400">{item.desc}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ==================== 2. RESUME FRESHNESS ==================== */}
            {selectedCategory === 'freshness' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Resume Freshness
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by when the resume was uploaded or updated.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    'Last 24 Hours',
                    'Last 7 Days',
                    'Last 14 Days',
                    'Last 30 Days',
                    'Older than 30 Days',
                  ].map((fresh) => {
                    const isChecked = draftFilters.freshness.includes(fresh);
                    return (
                      <label
                        key={fresh}
                        onClick={() => toggleArrayItem('freshness', fresh)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                            ? 'bg-purple-900/30 border-purple-500 text-white'
                            : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-slate-600 bg-slate-900/50'
                            }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-semibold text-xs">{fresh}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ==================== 3. EXPERIENCE ==================== */}
            {selectedCategory === 'experience' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Experience
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by total professional experience duration.
                  </p>
                </div>

                {/* Predefined Range Checkboxes */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider block">
                    Experience Ranges
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {[
                      '0–2 Years',
                      '3–5 Years',
                      '6–8 Years',
                      '9–12 Years',
                      '12+ Years',
                    ].map((rng) => {
                      const isChecked = draftFilters.expRanges.includes(rng);
                      return (
                        <label
                          key={rng}
                          onClick={() => toggleArrayItem('expRanges', rng)}
                          className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                              ? 'bg-purple-900/30 border-purple-500 text-white'
                              : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                            }`}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                                ? 'bg-purple-600 border-purple-500 text-white'
                                : 'border-slate-600 bg-slate-900/50'
                              }`}
                          >
                            {isChecked && <Check className="w-3 h-3" />}
                          </div>
                          <span className="font-semibold text-xs">{rng}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Min / Max Inputs */}
                <div className="space-y-2 pt-2 border-t border-[#261e38]">
                  <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider block">
                    Exact Range Bounds (Years)
                  </span>
                  <div className="grid grid-cols-2 gap-3 max-w-sm">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Minimum Years</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={draftFilters.minExp ?? ''}
                        onChange={(e) =>
                          setDraftFilters((p) => ({
                            ...p,
                            minExp: e.target.value === '' ? null : Number(e.target.value),
                          }))
                        }
                        placeholder="0"
                        className="w-full px-3 py-2 rounded-xl bg-[#18112e] border border-[#2b2144] text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">Maximum Years</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={draftFilters.maxExp ?? ''}
                        onChange={(e) =>
                          setDraftFilters((p) => ({
                            ...p,
                            maxExp: e.target.value === '' ? null : Number(e.target.value),
                          }))
                        }
                        placeholder="30"
                        className="w-full px-3 py-2 rounded-xl bg-[#18112e] border border-[#2b2144] text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== 4. SKILLS ==================== */}
            {selectedCategory === 'skills' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      Skills
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Search and select skills. Candidates matching any selected skill will appear.
                    </p>
                  </div>
                  {draftFilters.skills.length > 0 && (
                    <span className="text-xs font-bold text-purple-300 bg-purple-500/15 border border-purple-500/30 px-2.5 py-1 rounded-lg">
                      {draftFilters.skills.length} selected
                    </span>
                  )}
                </div>

                {/* Skills Search Input */}
                <div className="relative max-w-md">
                  <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-purple-400/80" />
                  <input
                    type="text"
                    value={skillsSearch}
                    onChange={(e) => setSkillsSearch(e.target.value)}
                    placeholder="Search technical skills (e.g., React, Python, AWS)..."
                    className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#18112e] border border-purple-500/30 text-xs text-white placeholder-slate-400 focus:border-purple-400 focus:outline-none"
                  />
                  {skillsSearch && (
                    <button
                      onClick={() => setSkillsSearch('')}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Skills Checkbox Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[360px] overflow-y-auto pr-1">
                  {dynamicSkills
                    .filter((s) => s.toLowerCase().includes(skillsSearch.toLowerCase()))
                    .map((skill) => {
                      const isChecked = draftFilters.skills.includes(skill);
                      return (
                        <button
                          key={skill}
                          type="button"
                          onClick={() => toggleArrayItem('skills', skill)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition cursor-pointer text-left ${isChecked
                              ? 'bg-purple-900/30 border-purple-500 text-white font-bold'
                              : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                            }`}
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                                ? 'bg-purple-600 border-purple-500 text-white'
                                : 'border-slate-600 bg-slate-900/50'
                              }`}
                          >
                            {isChecked && <Check className="w-2.5 h-2.5" />}
                          </div>
                          <span className="truncate">{skill}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {/* ==================== 5. VISA STATUS ==================== */}
            {selectedCategory === 'visa' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Visa / Work Authorization
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by candidate work authorization status.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    'US Citizen',
                    'Green Card',
                    'H1B',
                    'OPT',
                    'CPT',
                    'H4 EAD',
                    'TN Visa',
                    'L2 EAD',
                    'W2',
                    'C2C',
                  ].map((visa) => {
                    const isChecked = draftFilters.visas.includes(visa);
                    return (
                      <label
                        key={visa}
                        onClick={() => toggleArrayItem('visas', visa)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                            ? 'bg-purple-900/30 border-purple-500 text-white'
                            : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-slate-600 bg-slate-900/50'
                            }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-semibold text-xs">{visa}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ==================== 6. LOCATION ==================== */}
            {selectedCategory === 'location' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Location
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by candidate city, state, or remote preference.
                  </p>
                </div>

                {/* Location Search */}
                <div className="relative max-w-md">
                  <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-purple-400/80" />
                  <input
                    type="text"
                    value={locationSearch}
                    onChange={(e) => setLocationSearch(e.target.value)}
                    placeholder="Search locations (e.g., Atlanta, Dallas, Remote)..."
                    className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#18112e] border border-purple-500/30 text-xs text-white placeholder-slate-400 focus:border-purple-400 focus:outline-none"
                  />
                  {locationSearch && (
                    <button
                      onClick={() => setLocationSearch('')}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Location Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
                  {dynamicLocations
                    .filter((loc) => loc.toLowerCase().includes(locationSearch.toLowerCase()))
                    .map((loc) => {
                      const isChecked = draftFilters.locations.includes(loc);
                      return (
                        <label
                          key={loc}
                          onClick={() => toggleArrayItem('locations', loc)}
                          className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                              ? 'bg-purple-900/30 border-purple-500 text-white'
                              : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                            }`}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                                ? 'bg-purple-600 border-purple-500 text-white'
                                : 'border-slate-600 bg-slate-900/50'
                              }`}
                          >
                            {isChecked && <Check className="w-3 h-3" />}
                          </div>
                          <span className="font-semibold text-xs">{loc}</span>
                        </label>
                      );
                    })}
                </div>
              </div>
            )}

            {/* ==================== 7. AVAILABILITY ==================== */}
            {selectedCategory === 'availability' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Availability
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by candidate placement readiness and start timeline.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    'Immediate',
                    '1–2 Weeks Notice',
                    '30 Days Notice',
                    'Specific Date / Future',
                  ].map((av) => {
                    const isChecked = draftFilters.availabilities.includes(av);
                    return (
                      <label
                        key={av}
                        onClick={() => toggleArrayItem('availabilities', av)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                            ? 'bg-purple-900/30 border-purple-500 text-white'
                            : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-slate-600 bg-slate-900/50'
                            }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-semibold text-xs">{av}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ==================== 8. BENCH TIME ==================== */}
            {selectedCategory === 'benchTime' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Bench Time
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by duration on bench or active marketing search.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    '< 1 Month',
                    '1–3 Months',
                    '3–6 Months',
                    '6+ Months',
                  ].map((bt) => {
                    const isChecked = draftFilters.benchTimes.includes(bt);
                    return (
                      <label
                        key={bt}
                        onClick={() => toggleArrayItem('benchTimes', bt)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                            ? 'bg-purple-900/30 border-purple-500 text-white'
                            : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-slate-600 bg-slate-900/50'
                            }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-semibold text-xs">{bt}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ==================== 9. SOURCE ==================== */}
            {selectedCategory === 'source' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Source
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by candidate ingestion or upload source.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    'Resume Upload',
                    'Email Ingestion',
                    'Direct Application',
                    'Referral',
                    'Job Board',
                  ].map((src) => {
                    const isChecked = draftFilters.sources.includes(src);
                    return (
                      <label
                        key={src}
                        onClick={() => toggleArrayItem('sources', src)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                            ? 'bg-purple-900/30 border-purple-500 text-white'
                            : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-slate-600 bg-slate-900/50'
                            }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-semibold text-xs">{src}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ==================== 10. PLACEMENT STATUS ==================== */}
            {selectedCategory === 'placement' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Placement Status
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by recruitment marketing and interview pipeline stage.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    'Open for Marketing',
                    'Interviewing / Screening',
                    'Offer Received',
                    'Placed on Engagement',
                  ].map((pl) => {
                    const isChecked = draftFilters.placementStatuses.includes(pl);
                    return (
                      <label
                        key={pl}
                        onClick={() => toggleArrayItem('placementStatuses', pl)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                            ? 'bg-purple-900/30 border-purple-500 text-white'
                            : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-slate-600 bg-slate-900/50'
                            }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-semibold text-xs">{pl}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ==================== 11. SALARY / RATE ==================== */}
            {selectedCategory === 'salary' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Salary / Hourly Rate
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by target hourly billing rate.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    '< $50 / hr',
                    '$50 – $70 / hr',
                    '$70 – $90 / hr',
                    '$90 – $120 / hr',
                    '$120+ / hr',
                  ].map((rate) => {
                    const isChecked = draftFilters.rateRanges.includes(rate);
                    return (
                      <label
                        key={rate}
                        onClick={() => toggleArrayItem('rateRanges', rate)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                            ? 'bg-purple-900/30 border-purple-500 text-white'
                            : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-slate-600 bg-slate-900/50'
                            }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-semibold text-xs">{rate}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ==================== 12. POOL STATUS ==================== */}
            {selectedCategory === 'pool' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Candidate Pool
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Filter by active or passive candidates (based on time in pool).
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    'Active',
                    'Passive',
                  ].map((pool) => {
                    const isChecked = draftFilters.poolStatuses.includes(pool);
                    return (
                      <label
                        key={pool}
                        onClick={() => toggleArrayItem('poolStatuses', pool)}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition cursor-pointer ${isChecked
                            ? 'bg-purple-900/30 border-purple-500 text-white'
                            : 'bg-[#18112e] border-[#2b2144] text-slate-300 hover:border-purple-500/50'
                          }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition shrink-0 ${isChecked
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-slate-600 bg-slate-900/50'
                            }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-semibold text-xs">{pool}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 3. BOTTOM ACTION BAR */}
        {/* ========================================================================= */}
        <div className="px-6 py-4 border-t border-[#261e38] bg-[#140e29] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          {/* Live Matching Candidates Count */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-slate-200">
              <strong className="font-extrabold text-white">{liveMatchCount}</strong> candidates match your filters
            </span>
          </div>

          {/* Action Buttons: Reset All | Cancel | Apply Filters */}
          <div className="flex items-center gap-3 self-end sm:self-auto">
            <button
              type="button"
              onClick={handleResetAll}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset All</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-xs font-semibold transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-violet-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-900/50 flex items-center gap-1.5 transition cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Apply Filters</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
