import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  UploadCloud,
  Search,
  X,
  FileText,
  Target,
  Trash2,
  AlertTriangle,
  Loader2,
  Download,
  User,
  Sparkles,
  Briefcase,
  StickyNote,
  Activity as ActivityIcon,
  SlidersHorizontal,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { CandidateProfile, OrbitLifecycleState } from '../../types';
import { apiFetch } from '../../services/api';
import { StatusBadge } from './StatusBadge';
import { TransitionModal } from './TransitionModal';
import { OverviewTab } from './tabs/OverviewTab';
import { SkillsTab } from './tabs/SkillsTab';
import { ExperienceTab } from './tabs/ExperienceTab';
import { DocumentsTab } from './tabs/DocumentsTab';
import { NotesTab } from './tabs/NotesTab';
import { ActivityTab } from './tabs/ActivityTab';
import {
  AdvancedFiltersModal,
  AdvancedFilterState,
  INITIAL_FILTER_STATE,
  filterCandidate,
} from './AdvancedFiltersModal';

interface CandidatesWorkspaceProps {
  candidates: CandidateProfile[];
  onNavigate: (screen: any) => void;
  onGoToMatch: (type: 'job' | 'resume', id: string) => void;
  onUploadClick?: () => void;
  onRefresh?: () => void;
}

type TabKey = 'overview' | 'experience' | 'skills' | 'documents' | 'activity' | 'notes';

function formatExp(exp: string | number | undefined): string {
  if (exp == null) return '3y';
  if (typeof exp === 'number') return `${exp}y`;
  const match = String(exp).match(/\d+/);
  return match ? `${match[0]}y` : '3y';
}

function calculateBenchAgeShort(dateString?: string): string {
  if (!dateString) return '2w';
  const createdTime = new Date(dateString).getTime();
  if (isNaN(createdTime)) return '2w';
  const now = Date.now();
  const diffDays = Math.max(1, Math.floor((now - createdTime) / (1000 * 60 * 60 * 24)));
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

export const CandidatesWorkspace: React.FC<CandidatesWorkspaceProps> = ({
  candidates,
  onNavigate,
  onGoToMatch,
  onUploadClick,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateProfile | null>(null);
  const [activeDrawerTab, setActiveDrawerTab] = useState<TabKey>('overview');
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [candidateToDelete, setCandidateToDelete] = useState<CandidateProfile | null>(null);
  const [isDeletingSingle, setIsDeletingSingle] = useState(false);

  // Advanced Filters Modal State
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<AdvancedFilterState>(INITIAL_FILTER_STATE);

  // Multi-Selection State
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [isBulkActionsOpen, setIsBulkActionsOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const bulkActionsRef = useRef<HTMLDivElement>(null);

  // Automatically select the first candidate on load if none selected and on desktop
  useEffect(() => {
    if (!selectedCandidate && candidates.length > 0) {
      setSelectedCandidate(candidates[0]);
    }
  }, [candidates]);

  // Keep selectedCandidate synced if candidates array updates
  useEffect(() => {
    if (selectedCandidate) {
      const refreshed = candidates.find((c) => c.id === selectedCandidate.id);
      if (refreshed) {
        setSelectedCandidate(refreshed);
      }
    }
  }, [candidates]);

  // Close bulk actions on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (bulkActionsRef.current && !bulkActionsRef.current.contains(event.target as Node)) {
        setIsBulkActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Calculate active filter count for badge on Filters button
  const activeFilterBadgeCount = useMemo(() => {
    return (
      (appliedFilters.statuses.length > 0 ? 1 : 0) +
      (appliedFilters.freshness.length > 0 ? 1 : 0) +
      (appliedFilters.expRanges.length > 0 || appliedFilters.minExp !== null || appliedFilters.maxExp !== null ? 1 : 0) +
      (appliedFilters.skills.length > 0 ? 1 : 0) +
      (appliedFilters.visas.length > 0 ? 1 : 0) +
      (appliedFilters.locations.length > 0 ? 1 : 0) +
      (appliedFilters.availabilities.length > 0 ? 1 : 0) +
      (appliedFilters.benchTimes.length > 0 ? 1 : 0) +
      (appliedFilters.sources.length > 0 ? 1 : 0) +
      (appliedFilters.placementStatuses.length > 0 ? 1 : 0) +
      (appliedFilters.rateRanges.length > 0 || appliedFilters.minRate !== null || appliedFilters.maxRate !== null ? 1 : 0)
    );
  }, [appliedFilters]);

  // Candidate Pool Counts
  const activePoolCount = useMemo(() => candidates.filter(c => (c.poolStatus || 'Active') === 'Active').length, [candidates]);
  const passivePoolCount = useMemo(() => candidates.filter(c => (c.poolStatus || 'Active') === 'Passive').length, [candidates]);

  // Clear all filters
  const handleClearAllFilters = () => {
    setAppliedFilters(INITIAL_FILTER_STATE);
    setCurrentPage(1);
  };

  // Filtered Candidates (Combining Search + Advanced Filters with AND logic)
  const filteredCandidates = useMemo(() => {
    return candidates.filter((cand) => {
      // 1. Text Search Filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase().trim();
        const fileName = (cand.fileName || '').toLowerCase();
        const candSkills = (cand.matchedSkills || []).join(' ').toLowerCase();
        const candLocation = (cand.location || '').toLowerCase();
        const candEmail = (cand.email || '').toLowerCase();
        const candTitle = (cand.title || '').toLowerCase();
        const candName = cand.name.toLowerCase();

        const matchesSearch =
          fileName.includes(query) ||
          candName.includes(query) ||
          candTitle.includes(query) ||
          cand.id.toLowerCase().includes(query) ||
          candSkills.includes(query) ||
          candLocation.includes(query) ||
          candEmail.includes(query);

        if (!matchesSearch) return false;
      }

      // 2. Advanced Filters (AND across categories, OR within categories)
      return filterCandidate(cand, appliedFilters);
    });
  }, [candidates, searchQuery, appliedFilters]);

  // Paginated Slices
  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / rowsPerPage));
  const paginatedCandidates = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredCandidates.slice(start, start + rowsPerPage);
  }, [filteredCandidates, currentPage, rowsPerPage]);

  // Selection Handlers
  const allCurrentPageSelected =
    paginatedCandidates.length > 0 && paginatedCandidates.every((c) => selectedCandidateIds.has(c.id));

  const toggleSelectAll = () => {
    if (allCurrentPageSelected) {
      setSelectedCandidateIds((prev) => {
        const next = new Set(prev);
        paginatedCandidates.forEach((c) => next.delete(c.id));
        return next;
      });
    } else {
      setSelectedCandidateIds((prev) => {
        const next = new Set(prev);
        paginatedCandidates.forEach((c) => next.add(c.id));
        return next;
      });
    }
  };

  const toggleSelectCandidate = (id: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Export CSV Handler
  const handleExportCSV = () => {
    if (candidates.length === 0) return;
    const headers = ['Name', 'Title', 'Email', 'Location', 'Experience', 'Visa', 'Status', 'Action Needed', 'Skills'];
    const rows = candidates.map((c) => [
      `"${c.name.replace(/"/g, '""')}"`,
      `"${(c.title || '').replace(/"/g, '""')}"`,
      `"${(c.email || '').replace(/"/g, '""')}"`,
      `"${(c.location || '').replace(/"/g, '""')}"`,
      `"${(c.experience || '').replace(/"/g, '""')}"`,
      `"${(c.visa || '').replace(/"/g, '""')}"`,
      `"${c.orbit_lifecycle_state || 'AVAILABLE'}"`,
      `"${c.action_needed ? 'Yes' : 'No'}"`,
      `"${(c.matchedSkills || []).join('; ').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `orbit_candidates_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Lifecycle Update Handler
  const handleStateUpdated = (newState: OrbitLifecycleState | string) => {
    if (selectedCandidate) {
      setSelectedCandidate({
        ...selectedCandidate,
        orbit_lifecycle_state: newState,
      });
    }
    if (onRefresh) onRefresh();
  };

  // Single Candidate Delete Handler
  const handleConfirmSingleDelete = async () => {
    if (!candidateToDelete) return;
    setIsDeletingSingle(true);
    try {
      const res = await apiFetch(`/candidates/${candidateToDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error('Failed to delete candidate');
      }
      setSelectedCandidateIds((prev) => {
        const next = new Set(prev);
        next.delete(candidateToDelete.id);
        return next;
      });
      if (selectedCandidate?.id === candidateToDelete.id) {
        setSelectedCandidate(null);
      }
      setCandidateToDelete(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setIsDeletingSingle(false);
    }
  };

  // Bulk Delete Handler
  const handleConfirmBulkDelete = async () => {
    if (selectedCandidateIds.size === 0) return;
    setIsBulkDeleting(true);
    try {
      const ids = Array.from(selectedCandidateIds);
      const res = await apiFetch('/candidates/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        throw new Error('Failed to bulk delete candidates');
      }
      if (selectedCandidate && selectedCandidateIds.has(selectedCandidate.id)) {
        setSelectedCandidate(null);
      }
      setSelectedCandidateIds(new Set());
      setShowBulkDeleteModal(false);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Bulk delete error:', err);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const detailTabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <User className="w-3.5 h-3.5" /> },
    { key: 'experience', label: 'Experience', icon: <Briefcase className="w-3.5 h-3.5" /> },
    { key: 'skills', label: 'Skills', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { key: 'documents', label: 'Documents', icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'activity', label: 'Activity', icon: <ActivityIcon className="w-3.5 h-3.5" /> },
    { key: 'notes', label: 'Notes', icon: <StickyNote className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex-1 w-full h-full min-w-0 flex flex-col bg-[#09090b] text-slate-100 font-sans overflow-hidden">
      {/* MAIN CONTENT SPLIT CONTAINER */}
      <div className="flex-1 w-full min-w-0 flex min-h-0 overflow-hidden">
        {/* LEFT / CENTER: CANDIDATES INVENTORY TABLE AREA */}
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-y-auto p-6 md:p-8 space-y-4">
          {/* Top Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                Candidates
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {candidates.length} consultants
              </p>
            </div>

            {/* Top Action Buttons */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={handleExportCSV}
                className="px-3.5 py-2 rounded-xl bg-[#161028] hover:bg-[#1f1833] text-slate-300 border border-purple-500/30 hover:border-purple-400 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5 text-purple-400" />
                <span>Export CSV</span>
              </button>

              <button
                onClick={onUploadClick || (() => onNavigate('upload'))}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-violet-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-purple-900/40 transition cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Upload Resume</span>
              </button>
            </div>
          </div>

          {/* Search & Filters Bar */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-purple-400/70" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by name, title, skills, location..."
                className="w-full pl-10 pr-9 py-2 rounded-xl border border-purple-500/30 bg-[#120c24] text-xs text-slate-100 placeholder-slate-400 hover:border-purple-400/60 focus:border-purple-400 focus:outline-none transition shadow-inner"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Active / Passive Pool Toggles */}
            <div className="flex items-center gap-1.5 bg-[#120c24] border border-purple-500/30 rounded-xl p-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAppliedFilters(prev => ({
                    ...prev,
                    poolStatuses: prev.poolStatuses.includes('Active') ? [] : ['Active']
                  }));
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  appliedFilters.poolStatuses.includes('Active')
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/20'
                    : 'text-slate-400 hover:text-emerald-300 hover:bg-[#18112e]'
                }`}
              >
                Active
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${appliedFilters.poolStatuses.includes('Active') ? 'bg-emerald-500/30 text-white' : 'bg-white/5 text-slate-500'}`}>
                  {activePoolCount}
                </span>
              </button>
              
              <button
                type="button"
                onClick={() => {
                  setAppliedFilters(prev => ({
                    ...prev,
                    poolStatuses: prev.poolStatuses.includes('Passive') ? [] : ['Passive']
                  }));
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  appliedFilters.poolStatuses.includes('Passive')
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-900/20'
                    : 'text-slate-400 hover:text-purple-300 hover:bg-[#18112e]'
                }`}
              >
                Passive
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${appliedFilters.poolStatuses.includes('Passive') ? 'bg-purple-500/30 text-white' : 'bg-white/5 text-slate-500'}`}>
                  {passivePoolCount}
                </span>
              </button>
            </div>

            {/* Advanced Filters Trigger Button */}
            <button
              type="button"
              onClick={() => setIsAdvancedFiltersOpen(true)}
              className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                activeFilterBadgeCount > 0
                  ? 'border-purple-400 bg-purple-600/30 text-purple-200 shadow-md shadow-purple-900/30 font-bold'
                  : 'border-purple-500/30 bg-[#120c24] text-slate-300 hover:border-purple-400/60 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-purple-400" />
              <span>Filters</span>
              {activeFilterBadgeCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {activeFilterBadgeCount}
                </span>
              )}
            </button>
          </div>

          {/* ACTIVE FILTER CHIPS ROW */}
          {activeFilterBadgeCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs shrink-0">
              {appliedFilters.statuses.length > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-[#161028] border border-purple-500/30 text-slate-200 flex items-center gap-1.5">
                  <span className="text-slate-400">Status:</span>
                  <span className="font-semibold text-purple-300">{appliedFilters.statuses.join(', ')}</span>
                  <button
                    onClick={() => {
                      setAppliedFilters((p) => ({ ...p, statuses: [] }));
                      setCurrentPage(1);
                    }}
                    className="text-slate-400 hover:text-white ml-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {appliedFilters.locations.length > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-[#161028] border border-purple-500/30 text-slate-200 flex items-center gap-1.5">
                  <span className="text-slate-400">Location:</span>
                  <span className="font-semibold text-purple-300">{appliedFilters.locations.join(', ')}</span>
                  <button
                    onClick={() => {
                      setAppliedFilters((p) => ({ ...p, locations: [] }));
                      setCurrentPage(1);
                    }}
                    className="text-slate-400 hover:text-white ml-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {appliedFilters.visas.length > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-[#161028] border border-purple-500/30 text-slate-200 flex items-center gap-1.5">
                  <span className="text-slate-400">Visa:</span>
                  <span className="font-semibold text-purple-300">{appliedFilters.visas.join(', ')}</span>
                  <button
                    onClick={() => {
                      setAppliedFilters((p) => ({ ...p, visas: [] }));
                      setCurrentPage(1);
                    }}
                    className="text-slate-400 hover:text-white ml-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {appliedFilters.skills.length > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-[#161028] border border-purple-500/30 text-slate-200 flex items-center gap-1.5">
                  <span className="text-slate-400">Skills:</span>
                  <span className="font-semibold text-purple-300">{appliedFilters.skills.slice(0, 3).join(', ')}{appliedFilters.skills.length > 3 ? ` +${appliedFilters.skills.length - 3}` : ''}</span>
                  <button
                    onClick={() => {
                      setAppliedFilters((p) => ({ ...p, skills: [] }));
                      setCurrentPage(1);
                    }}
                    className="text-slate-400 hover:text-white ml-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {appliedFilters.freshness.length > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-[#161028] border border-purple-500/30 text-slate-200 flex items-center gap-1.5">
                  <span className="text-slate-400">Freshness:</span>
                  <span className="font-semibold text-purple-300">{appliedFilters.freshness.join(', ')}</span>
                  <button
                    onClick={() => {
                      setAppliedFilters((p) => ({ ...p, freshness: [] }));
                      setCurrentPage(1);
                    }}
                    className="text-slate-400 hover:text-white ml-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              {appliedFilters.expRanges.length > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-[#161028] border border-purple-500/30 text-slate-200 flex items-center gap-1.5">
                  <span className="text-slate-400">Exp:</span>
                  <span className="font-semibold text-purple-300">{appliedFilters.expRanges.join(', ')}</span>
                  <button
                    onClick={() => {
                      setAppliedFilters((p) => ({ ...p, expRanges: [] }));
                      setCurrentPage(1);
                    }}
                    className="text-slate-400 hover:text-white ml-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

              <button
                onClick={handleClearAllFilters}
                className="text-xs text-purple-400 hover:text-purple-300 font-semibold px-2 py-1 transition cursor-pointer underline"
              >
                Clear all
              </button>
            </div>
          )}

          {/* SELECTION BAR & BULK ACTIONS */}
          <div className="flex items-center justify-between gap-3 pt-1 shrink-0">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={allCurrentPageSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900/50 text-purple-600 focus:ring-purple-500 accent-purple-600 cursor-pointer"
                title="Select all visible candidates"
              />
              {selectedCandidateIds.size > 0 && (
                <span className="text-xs text-slate-300 font-semibold">
                  {selectedCandidateIds.size} selected
                </span>
              )}

              {selectedCandidateIds.size > 0 && (
                <div className="relative" ref={bulkActionsRef}>
                  <button
                    type="button"
                    onClick={() => setIsBulkActionsOpen(!isBulkActionsOpen)}
                    className="px-3 py-1.5 rounded-lg bg-[#161028] hover:bg-[#1f1833] text-slate-200 border border-purple-500/30 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                  >
                    <span>Bulk Actions</span>
                    <MoreVertical className="w-3.5 h-3.5 text-slate-400" />
                  </button>

                  {isBulkActionsOpen && (
                    <div className="absolute left-0 top-9 z-30 w-44 rounded-xl bg-[#120c24] border border-purple-500/30 shadow-xl py-1 text-xs text-slate-200">
                      <button
                        type="button"
                        onClick={() => {
                          setIsBulkActionsOpen(false);
                          setShowBulkDeleteModal(true);
                        }}
                        className="w-full px-3.5 py-2 text-left text-red-400 hover:bg-red-500/15 flex items-center gap-2 font-semibold transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Selected</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* CANDIDATES INVENTORY TABLE CONTAINER */}
          <div className="w-full rounded-2xl border border-[#261e38] bg-[#0c0916]/80 glass-card overflow-hidden">
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#261e38] bg-[#150f27] text-[#94a3b8] font-semibold text-[11px] uppercase tracking-wider sticky top-0 z-10">
                    <th className="py-3 px-3 w-10 text-center shrink-0">
                      <input
                        type="checkbox"
                        checked={allCurrentPageSelected}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900/50 text-purple-600 focus:ring-purple-500 accent-purple-600 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-4 min-w-[200px] max-w-[240px]">CANDIDATE</th>
                    <th className="py-3 px-4 min-w-[150px] max-w-[200px]">TITLE</th>
                    <th className="py-3 px-4 min-w-[160px] max-w-[220px]">PRIMARY SKILLS</th>
                    <th className="py-3 px-3 w-16 text-center shrink-0">EXP</th>
                    <th className="py-3 px-4 min-w-[110px] max-w-[140px]">LOCATION</th>
                    <th className="py-3 px-3 w-24 shrink-0">STATUS</th>
                    <th className="py-3 px-3 w-20 text-center shrink-0">VISA</th>
                    <th className="py-3 px-3 w-16 text-center shrink-0">BENCH</th>
                    <th className="py-3 px-4 w-24 text-right shrink-0 whitespace-nowrap">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#261e38]/60 text-xs text-slate-300">
                  {paginatedCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-16 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <p className="font-semibold text-sm text-slate-300">No matching candidates found</p>
                          <p className="text-xs text-slate-500">Try adjusting your search query or advanced filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedCandidates.map((cand) => {
                      const isSelected = selectedCandidate?.id === cand.id;
                      const isChecked = selectedCandidateIds.has(cand.id);
                      const skillsList = cand.matchedSkills || [];
                      const expShort = formatExp(cand.experience || cand.expYears);
                      const benchAge = calculateBenchAgeShort(cand.uploadedDate);
                      const candidateEmail = cand.email || `${cand.name.toLowerCase().replace(/\s+/g, '.')}@email.com`;
                      const initials = cand.name
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase() || 'C';

                      // Real Action Needed calculation from backend
                      const hasActionNeeded =
                        cand.action_needed === true ||
                        (Array.isArray(cand.missing_fields) && cand.missing_fields.length > 0);

                      return (
                        <tr
                          key={cand.id}
                          onClick={() => setSelectedCandidate(cand)}
                          className={`transition-colors duration-150 group cursor-pointer ${
                            isSelected
                              ? 'bg-purple-900/25 border-l-2 border-purple-500'
                              : 'hover:bg-purple-900/10'
                          }`}
                        >
                          {/* 1. CHECKBOX */}
                          <td className="py-3 px-3 text-center shrink-0" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelectCandidate(cand.id)}
                              className="w-4 h-4 rounded border-slate-700 bg-slate-900/50 text-purple-600 focus:ring-purple-500 accent-purple-600 cursor-pointer"
                            />
                          </td>

                          {/* 2. CANDIDATE (Avatar + Name + Action Needed badge + Email) */}
                          <td className="py-3 px-4 min-w-[200px] max-w-[240px]">
                            <div className="flex items-center gap-2.5">
                              {/* Avatar tile */}
                              <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-xs font-bold text-purple-300 shrink-0">
                                {initials}
                              </div>

                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-slate-100 font-bold leading-tight group-hover:text-purple-300 transition truncate">
                                    {cand.name}
                                  </span>

                                  {/* COMPACT ACTION NEEDED BADGE BESIDE CANDIDATE NAME */}
                                  {hasActionNeeded && (
                                    <span
                                      className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-rose-500/20 text-rose-300 border border-rose-500/35 tracking-tight shrink-0"
                                      title={`Missing: ${cand.missing_fields?.join(', ') || 'profile data'}`}
                                    >
                                      Action Needed
                                    </span>
                                  )}
                                </div>
                                <span className="text-slate-500 text-[11px] truncate mt-0.5">
                                  {candidateEmail}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* 3. TITLE */}
                          <td className="py-3 px-4 text-slate-300 font-medium truncate min-w-[150px] max-w-[200px]" title={cand.title}>
                            {cand.title || 'Software Professional'}
                          </td>

                          {/* 4. PRIMARY SKILLS */}
                          <td className="py-3 px-4 min-w-[160px] max-w-[220px]">
                            <div className="flex flex-wrap gap-1">
                              {skillsList.slice(0, 3).map((skill, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[10px] font-medium truncate max-w-[85px]"
                                  title={skill}
                                >
                                  {skill}
                                </span>
                              ))}
                              {skillsList.length > 3 && (
                                <span
                                  className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 text-[10px] font-medium"
                                  title={skillsList.slice(3).join(', ')}
                                >
                                  +{skillsList.length - 3}
                                </span>
                              )}
                              {skillsList.length === 0 && (
                                <span className="text-slate-500 text-[10px] italic">—</span>
                              )}
                            </div>
                          </td>

                          {/* 5. EXP */}
                          <td className="py-3 px-3 text-center text-slate-300 font-medium whitespace-nowrap w-16 shrink-0">
                            {expShort}
                          </td>

                          {/* 6. LOCATION */}
                          <td className="py-3 px-4 text-slate-300 font-medium whitespace-nowrap truncate min-w-[110px] max-w-[140px]" title={cand.location || 'Remote'}>
                            {cand.location && cand.location !== 'N/A' ? cand.location : 'Remote'}
                          </td>

                          {/* 7. STATUS */}
                          <td className="py-3 px-3 whitespace-nowrap w-24 shrink-0">
                            <StatusBadge state={cand.orbit_lifecycle_state} size="sm" />
                          </td>

                          {/* 8. VISA */}
                          <td className="py-3 px-3 text-center whitespace-nowrap w-20 shrink-0">
                            <span className="text-[11px] text-slate-400 font-medium">
                              {cand.visa && cand.visa !== 'N/A' ? cand.visa : 'OPT'}
                            </span>
                          </td>

                          {/* 9. BENCH */}
                          <td className="py-3 px-3 text-center whitespace-nowrap w-16 shrink-0">
                            <span className="text-[11px] text-slate-400 font-medium">
                              {benchAge}
                            </span>
                          </td>

                          {/* 10. ACTIONS */}
                          <td className="py-3 px-4 text-right whitespace-nowrap w-24 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setSelectedCandidate(cand)}
                                className="text-xs font-semibold text-purple-400 hover:text-purple-300 hover:underline transition cursor-pointer"
                              >
                                View
                              </button>

                              <button
                                onClick={() => setCandidateToDelete(cand)}
                                className="text-slate-400 hover:text-red-400 p-1 transition cursor-pointer"
                                title="Delete Candidate"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* TABLE FOOTER / PAGINATION */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 text-xs text-slate-400 font-sans shrink-0">
            <div>
              Showing{' '}
              <span className="font-semibold text-slate-200">
                {filteredCandidates.length === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1}
              </span>{' '}
              to{' '}
              <span className="font-semibold text-slate-200">
                {Math.min(currentPage * rowsPerPage, filteredCandidates.length)}
              </span>{' '}
              of{' '}
              <span className="font-semibold text-slate-200">
                {filteredCandidates.length}
              </span>{' '}
              results
            </div>

            <div className="flex items-center gap-4">
              {/* Page buttons */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="w-7 h-7 rounded-lg bg-[#161028] border border-purple-500/20 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => idx + 1).map((pageNum) => (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-7 h-7 rounded-lg font-bold text-xs transition cursor-pointer ${
                      currentPage === pageNum
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'bg-[#161028] border border-purple-500/20 text-slate-300 hover:bg-[#1f1833]'
                    }`}
                  >
                    {pageNum}
                  </button>
                ))}

                {totalPages > 5 && (
                  <>
                    <span className="px-1 text-slate-500">...</span>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      className={`w-7 h-7 rounded-lg font-bold text-xs transition cursor-pointer ${
                        currentPage === totalPages
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'bg-[#161028] border border-purple-500/20 text-slate-300 hover:bg-[#1f1833]'
                      }`}
                    >
                      {totalPages}
                    </button>
                  </>
                )}

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="w-7 h-7 rounded-lg bg-[#161028] border border-purple-500/20 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Rows per page dropdown */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Rows per page</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    setRowsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-[#161028] border border-purple-500/30 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-purple-400 cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: CANDIDATE DETAIL DRAWER */}
        {selectedCandidate && (
          <div className="w-[440px] xl:w-[500px] shrink-0 border-l border-[#261e38] bg-[#0c0916] flex flex-col h-full overflow-hidden shadow-2xl relative">
            {/* Candidate Header */}
            <div className="p-5 border-b border-[#261e38] bg-[#120c24] space-y-3 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-extrabold text-white truncate">{selectedCandidate.name}</h2>
                    <StatusBadge state={selectedCandidate.orbit_lifecycle_state} size="sm" />
                  </div>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{selectedCandidate.title || 'Software Professional'}</p>
                </div>

                <button
                  onClick={() => setSelectedCandidate(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer shrink-0"
                  title="Close panel"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Action Buttons Row: Run Match | Update Status | Delete */}
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button
                  onClick={() => onGoToMatch('resume', selectedCandidate.id)}
                  className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-purple-900/40 transition cursor-pointer"
                >
                  <Target className="w-3.5 h-3.5" />
                  <span>Run Match</span>
                </button>

                <button
                  onClick={() => setShowTransitionModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 text-xs font-semibold transition cursor-pointer"
                >
                  Update Status
                </button>

                {/* DELETE BUTTON PLACED IMMEDIATELY NEXT TO UPDATE STATUS */}
                <button
                  onClick={() => setCandidateToDelete(selectedCandidate)}
                  className="px-3.5 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>Delete</span>
                </button>
              </div>
            </div>

            {/* Tabs Row */}
            <div className="flex items-center px-4 border-b border-[#261e38] bg-[#0e0a1b] overflow-x-auto no-scrollbar shrink-0">
              {detailTabs.map((tab) => {
                const isActive = activeDrawerTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveDrawerTab(tab.key)}
                    className={`flex items-center gap-1.5 py-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'border-purple-500 text-purple-300 bg-purple-500/5'
                        : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 font-sans">
              {activeDrawerTab === 'overview' && (
                <OverviewTab
                  candidate={selectedCandidate}
                  onOpenTransition={() => setShowTransitionModal(true)}
                />
              )}
              {activeDrawerTab === 'experience' && <ExperienceTab candidate={selectedCandidate} />}
              {activeDrawerTab === 'skills' && <SkillsTab candidate={selectedCandidate} />}
              {activeDrawerTab === 'documents' && <DocumentsTab candidate={selectedCandidate} />}
              {activeDrawerTab === 'activity' && <ActivityTab candidate={selectedCandidate} />}
              {activeDrawerTab === 'notes' && <NotesTab candidate={selectedCandidate} />}
            </div>
          </div>
        )}
      </div>

      {/* Advanced Filters Large Modal */}
      <AdvancedFiltersModal
        isOpen={isAdvancedFiltersOpen}
        onClose={() => setIsAdvancedFiltersOpen(false)}
        appliedFilters={appliedFilters}
        onApplyFilters={(newFilters) => {
          setAppliedFilters(newFilters);
          setCurrentPage(1);
        }}
        candidates={candidates}
      />

      {/* Status Transition Modal */}
      {showTransitionModal && selectedCandidate && (
        <TransitionModal
          candidate={selectedCandidate}
          currentState={selectedCandidate.orbit_lifecycle_state || 'AVAILABLE'}
          onClose={() => setShowTransitionModal(false)}
          onSuccess={handleStateUpdated}
        />
      )}

      {/* Single Candidate Delete Confirmation Modal */}
      {candidateToDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#150f27] border border-red-500/30 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl relative">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-white">Delete Candidate?</h3>
                <p className="text-xs text-slate-400 truncate max-w-[280px]">
                  {candidateToDelete.name}
                </p>
              </div>
            </div>

            <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
              This candidate profile, resume, and associated matching records will be permanently deleted from the database. This action cannot be undone.
            </p>

            <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCandidateToDelete(null)}
                disabled={isDeletingSingle}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSingleDelete}
                disabled={isDeletingSingle}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-red-900/40 transition cursor-pointer disabled:opacity-50"
              >
                {isDeletingSingle ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#150f27] border border-red-500/30 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl relative">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-white">Delete Selected Candidates?</h3>
                <p className="text-xs text-slate-400">
                  {selectedCandidateIds.size} candidates selected
                </p>
              </div>
            </div>

            <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
              All {selectedCandidateIds.size} selected candidate profiles, resumes, and associated matching records will be permanently deleted from the database. This action cannot be undone.
            </p>

            <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={isBulkDeleting}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                disabled={isBulkDeleting}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-red-900/40 transition cursor-pointer disabled:opacity-50"
              >
                {isBulkDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete All Selected</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
