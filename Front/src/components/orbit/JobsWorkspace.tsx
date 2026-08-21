import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  Search,
  X,
  FileText,
  Eye,
  Target,
  Trash2,
  AlertTriangle,
  Loader2,
  Filter,
  Check,
  Tag,
  Mail,
  Globe,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  Briefcase,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { NavigationScreen, JobRequirement, FetchedJDItem } from '../../types';
import { cleanJobTitle, cleanFileName, calculateSeniority } from '../../utils';
import { apiFetch } from '../../services/api';


interface JobsWorkspaceProps {
  jobs: JobRequirement[];
  onNavigate: (screen: NavigationScreen) => void;
  onGoToMatch: (mode: 'job' | 'resume', id: string) => void;
  onUploadClick?: (type: 'jd' | 'resume') => void;
  onRefresh?: () => void;
  onThresholdChange?: (jobId: string, newThreshold: number) => void;
}

interface DeleteModalState {
  isOpen: boolean;
  type: 'job';
  mode: 'single' | 'bulk';
  targetId?: string;
  targetTitle?: string;
  targetCount?: number;
  isDeleting?: boolean;
  error?: string | null;
}

export const JobsWorkspace: React.FC<JobsWorkspaceProps> = ({
  jobs,
  onNavigate,
  onGoToMatch,
  onUploadClick,
  onRefresh,
  onThresholdChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter state
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');

  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedWorkModes, setSelectedWorkModes] = useState<string[]>([]);
  const [selectedVisas, setSelectedVisas] = useState<string[]>([]);
  const [minExp, setMinExp] = useState<number | null>(null);
  const [maxExp, setMaxExp] = useState<number | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedSeniorities, setSelectedSeniorities] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  // Close filter popover on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    };
    if (isFilterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFilterOpen]);

  const parseExpYears = (exp: string | number | undefined): number => {
    if (exp == null) return 0;
    if (typeof exp === 'number') return exp;
    const match = String(exp).match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  const activeFilterCount =
    (selectedLocations.length > 0 ? 1 : 0) +
    (selectedWorkModes.length > 0 ? 1 : 0) +
    (selectedVisas.length > 0 ? 1 : 0) +
    (minExp !== null || maxExp !== null ? 1 : 0) +
    (selectedSkills.length > 0 ? 1 : 0) +
    (selectedSeniorities.length > 0 ? 1 : 0) +
    (selectedSources.length > 0 ? 1 : 0);

  const clearAllFilters = () => {
    setSelectedLocations([]);
    setSelectedWorkModes([]);
    setSelectedVisas([]);
    setMinExp(null);
    setMaxExp(null);
    setSelectedSkills([]);
    setSelectedSeniorities([]);
    setSelectedSources([]);
    setSkillSearchQuery('');
  };

  const [rowThresholds, setRowThresholds] = useState<Record<string, number>>({});
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  // Delete Confirmation Modal State
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    isOpen: false,
    type: 'job',
    mode: 'single',
  });

  // Modal View State
  const [viewingJob, setViewingJob] = useState<JobRequirement | null>(null);
  const [viewingJobLoading, setViewingJobLoading] = useState(false);

  // --- ASTRA INTAKE STATE ---
  const [isFetchDropdownOpen, setIsFetchDropdownOpen] = useState(false);
  const fetchDropdownRef = useRef<HTMLDivElement>(null);

  // Email Modal State
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isPollingEmail, setIsPollingEmail] = useState(false);
  const [emailAccount, setEmailAccount] = useState('sravankumarerra21@gmail.com');
  const [emailFetchError, setEmailFetchError] = useState<string | null>(null);

  // Job Board Modal State
  const [isJobBoardModalOpen, setIsJobBoardModalOpen] = useState(false);
  const [selectedJobBoard, setSelectedJobBoard] = useState<'Adzuna' | 'Jooble' | 'Indeed' | 'JobPipe' | 'Monster'>('Adzuna');
  const [jobBoardKeyword, setJobBoardKeyword] = useState('Python Developer');
  const [jobBoardLocation, setJobBoardLocation] = useState('Dallas, TX');
  const [isFetchingJobBoard, setIsFetchingJobBoard] = useState(false);
  const [jobBoardError, setJobBoardError] = useState<string | null>(null);

  // Fetched Results Modal State
  const [fetchedResultsModal, setFetchedResultsModal] = useState<{
    isOpen: boolean;
    source: string;
    items: FetchedJDItem[];
  }>({
    isOpen: false,
    source: '',
    items: [],
  });
  const [fetchedResultsFilter, setFetchedResultsFilter] = useState<'all' | 'new' | 'duplicate' | 'failed'>('all');
  const [selectedFetchedIndexes, setSelectedFetchedIndexes] = useState<Set<number>>(new Set());

  // JD Preview Modal State
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    item: FetchedJDItem | null;
    activeTab: 'overview' | 'details' | 'skills' | 'raw';
  }>({
    isOpen: false,
    item: null,
    activeTab: 'overview',
  });

  // Save Success Modal State
  const [saveSuccessModal, setSaveSuccessModal] = useState<{
    isOpen: boolean;
    count: number;
  }>({
    isOpen: false,
    count: 0,
  });

  // Close fetch dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fetchDropdownRef.current && !fetchDropdownRef.current.contains(event.target as Node)) {
        setIsFetchDropdownOpen(false);
      }
    };
    if (isFetchDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFetchDropdownOpen]);

  // Load Email config when opening email modal
  const openEmailModal = async () => {
    setIsEmailModalOpen(true);
    setEmailFetchError(null);
    try {
      const res = await apiFetch('/api/astra/email-status');
      if (res.ok) {
        const data = await res.json();
        if (data.emailAccount && data.emailAccount !== 'Not configured') {
          setEmailAccount(data.emailAccount);
        }
      }
    } catch (_) {
      // Keep default email account
    }
  };

  const handleFetchEmails = async () => {
    setIsPollingEmail(true);
    setEmailFetchError(null);
    try {
      const res = await apiFetch('/api/astra/poll-emails', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'Failed to poll email inbox.');
      }
      const json = await res.json();
      const stats = json.data || json;
      setIsEmailModalOpen(false);

      if (onRefresh) onRefresh();

      const createdCount = stats.created || 0;
      setSaveSuccessModal({
        isOpen: true,
        count: createdCount,
      });
    } catch (err: any) {
      setEmailFetchError(err.message || 'Error connecting to email inbox.');
    } finally {
      setIsPollingEmail(false);
    }
  };

  const openJobBoardModal = (source: 'Adzuna' | 'Jooble' | 'Indeed' | 'JobPipe' | 'Monster') => {
    setSelectedJobBoard(source);
    setJobBoardError(null);
    setIsJobBoardModalOpen(true);
  };

  const handleFetchJobBoard = async () => {
    if (!jobBoardKeyword.trim()) {
      setJobBoardError('Role / Keyword is required.');
      return;
    }
    setIsFetchingJobBoard(true);
    setJobBoardError(null);

    try {
      const res = await apiFetch('/api/job-boards/fetch-requirements', {
        method: 'POST',
        body: JSON.stringify({
          source: selectedJobBoard.toLowerCase(),
          keyword: jobBoardKeyword.trim(),
          location: jobBoardLocation.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `${selectedJobBoard} is not configured`);
      }

      const json = await res.json();
      const resultData = json.data || {};
      const items: FetchedJDItem[] = resultData.items || [];

      setIsJobBoardModalOpen(false);

      // Select all 'New' items by default
      const initialSelected = new Set<number>();
      items.forEach((item, idx) => {
        if (item.status === 'New') {
          initialSelected.add(idx);
        }
      });
      setSelectedFetchedIndexes(initialSelected);

      setFetchedResultsModal({
        isOpen: true,
        source: selectedJobBoard,
        items,
      });
    } catch (err: any) {
      setJobBoardError(err.message || 'Failed to fetch job board requirements.');
    } finally {
      setIsFetchingJobBoard(false);
    }
  };

  const handleSaveSelectedFetched = () => {
    const selectedItems = fetchedResultsModal.items.filter((_, idx) =>
      selectedFetchedIndexes.has(idx)
    );
    const newCount = selectedItems.filter((i) => i.status === 'New').length;

    setFetchedResultsModal({ isOpen: false, source: '', items: [] });
    if (onRefresh) onRefresh();

    setSaveSuccessModal({
      isOpen: true,
      count: newCount > 0 ? newCount : selectedItems.length,
    });
  };

  const openJobDetail = async (job: JobRequirement) => {
    setViewingJob(job);
    setViewingJobLoading(true);
    try {
      const res = await apiFetch(`/jobs/${job.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const detail = data.job;
      if (!detail) return;
      setViewingJob({
        ...job,
        title: detail.title || job.title,
        company: detail.companyName || job.company,
        description: detail.summary || detail.jdSummary || job.description || '',
        skills:
          Array.isArray(detail.requiredSkills) && detail.requiredSkills.length
            ? detail.requiredSkills
            : job.skills,
        roleTag: detail.primaryRole || job.roleTag,
        location: detail.location || job.location,
        sourceName: detail.sourceName || job.sourceName,
        sourceUrl: detail.sourceUrl || job.sourceUrl,
        sourceEmail: detail.sourceEmail || job.sourceEmail,
        messageId: detail.messageId || job.messageId,
        employmentType: detail.employmentType || job.employmentType,
        visaRequirement: detail.visaRequirement || job.visaRequirement,
        remotePolicy: detail.remotePolicy || job.remotePolicy,
        minExperience: detail.minExperience ?? job.minExperience,
        maxExperience: detail.maxExperience ?? job.maxExperience,
      });
    } catch (err) {
      console.error('Failed to load job detail:', err);
    } finally {
      setViewingJobLoading(false);
    }
  };

  const renderSourceBadge = (sourceName?: string, sourceEmail?: string | null) => {
    const s = (sourceName || (sourceEmail ? 'email' : 'manual')).toLowerCase();
    if (s === 'email' || sourceEmail) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-semibold">
          <Mail className="w-3 h-3 text-purple-400" />
          <span>Email</span>
        </span>
      );
    }
    if (s === 'adzuna') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
          <Globe className="w-3 h-3 text-emerald-400" />
          <span>Adzuna</span>
        </span>
      );
    }
    if (s === 'jooble') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs font-semibold">
          <Briefcase className="w-3 h-3 text-blue-400" />
          <span>Jooble</span>
        </span>
      );
    }
    if (s === 'indeed') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
          <Target className="w-3 h-3 text-indigo-400" />
          <span>Indeed</span>
        </span>
      );
    }
    if (s === 'jobpipe') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-semibold">
          <Layers className="w-3 h-3 text-cyan-400" />
          <span>JobPipe</span>
        </span>
      );
    }
    if (s === 'monster') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-300 text-xs font-semibold">
          <Sparkles className="w-3 h-3 text-fuchsia-400" />
          <span>Monster</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-500/15 border border-slate-500/30 text-slate-300 text-xs font-semibold">
        <FileText className="w-3 h-3 text-slate-400" />
        <span>Manual</span>
      </span>
    );
  };

  const getRoleBadgeStyle = (role: string = '') => {
    const r = role.toLowerCase();
    if (r.includes('java')) return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    if (r.includes('react') || r.includes('frontend')) return 'bg-pink-500/15 text-pink-300 border-pink-500/30';
    if (r.includes('devops') || r.includes('sre') || r.includes('platform')) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    if (r.includes('analyst') || r.includes('data')) return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    if (r.includes('python')) return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
    return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
  };

  // Filter Jobs
  const filteredJobs = jobs.filter((job) => {
    const fileName = job.fileName || `${job.title.toLowerCase().replace(/\s+/g, '_')}_jd.pdf`;
    const matchesSearch =
      searchQuery === '' ||
      fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.id.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (selectedLocations.length > 0) {
      const jobLoc = (job.location || '').toLowerCase();
      const match = selectedLocations.some((loc) => jobLoc.includes(loc.toLowerCase()));
      if (!match) return false;
    }

    if (selectedWorkModes.length > 0) {
      const jobWm = (job.workMode || '').toLowerCase();
      const match = selectedWorkModes.some((wm) => jobWm.includes(wm.toLowerCase()));
      if (!match) return false;
    }

    if (selectedVisas.length > 0) {
      const jobVisa = (job.visa || '').toLowerCase();
      const match = selectedVisas.some((v) => jobVisa.includes(v.toLowerCase()));
      if (!match) return false;
    }

    const jobExp = parseExpYears(job.experience);
    if (minExp !== null && jobExp < minExp) return false;
    if (maxExp !== null && jobExp > maxExp) return false;

    if (selectedSeniorities.length > 0) {
      const jobSen = (job.seniority || calculateSeniority(job.title, job.experience)).toLowerCase();
      const match = selectedSeniorities.some((s) => jobSen.includes(s.toLowerCase()));
      if (!match) return false;
    }

    if (selectedSkills.length > 0) {
      const jobSkills = (job.skills || []).map((s) => s.toLowerCase());
      const match = selectedSkills.every((reqSkill) =>
        jobSkills.some((js) => js.includes(reqSkill.toLowerCase()) || reqSkill.toLowerCase().includes(js))
      );
      if (!match) return false;
    }

    if (selectedSources.length > 0) {
      const jobSrc = (job.sourceName || (job.sourceEmail ? 'email' : 'manual')).toLowerCase();
      const match = selectedSources.some((src) => {
        if (src.toLowerCase() === 'email') return jobSrc === 'email' || Boolean(job.sourceEmail);
        if (src.toLowerCase() === 'manual') return jobSrc === 'manual' || !job.sourceName;
        return jobSrc.includes(src.toLowerCase());
      });
      if (!match) return false;
    }

    return true;
  });

  const allFilteredJobsSelected =
    filteredJobs.length > 0 && filteredJobs.every((j) => selectedJobIds.has(j.id));

  const toggleSelectAllJobs = () => {
    if (allFilteredJobsSelected) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(filteredJobs.map((j) => j.id)));
    }
  };

  const toggleSelectJob = (id: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openSingleDelete = (id: string, title: string) => {
    setDeleteModal({
      isOpen: true,
      type: 'job',
      mode: 'single',
      targetId: id,
      targetTitle: title,
      error: null,
      isDeleting: false,
    });
  };

  const openBulkDelete = () => {
    if (selectedJobIds.size === 0) return;
    setDeleteModal({
      isOpen: true,
      type: 'job',
      mode: 'bulk',
      targetCount: selectedJobIds.size,
      error: null,
      isDeleting: false,
    });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, type: 'job', mode: 'single' });
  };

  const handleConfirmDelete = async () => {
    setDeleteModal((prev) => ({ ...prev, isDeleting: true, error: null }));
    try {
      if (deleteModal.mode === 'single' && deleteModal.targetId) {
        const res = await apiFetch(`/jobs/${deleteModal.targetId}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Failed to delete job description.');
        }
        setSelectedJobIds((prev) => {
          const next = new Set(prev);
          next.delete(deleteModal.targetId!);
          return next;
        });
      } else if (deleteModal.mode === 'bulk') {
        const ids = Array.from(selectedJobIds);
        const res = await apiFetch('/jobs/bulk-delete', {
          method: 'POST',
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Failed to delete selected jobs.');
        }
        setSelectedJobIds(new Set());
      }

      setDeleteModal({ isOpen: false, type: 'job', mode: 'single' });
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error('Delete error:', err);
      setDeleteModal((prev) => ({
        ...prev,
        isDeleting: false,
        error: err.message || 'An error occurred while deleting the record(s).',
      }));
    }
  };

  // Filtered fetched items for the results modal
  const filteredFetchedItems = fetchedResultsModal.items.filter((item) => {
    if (fetchedResultsFilter === 'new') return item.status === 'New';
    if (fetchedResultsFilter === 'duplicate') return item.status === 'Duplicate';
    if (fetchedResultsFilter === 'failed') return item.status === 'Failed';
    return true;
  });

  const countNew = fetchedResultsModal.items.filter((i) => i.status === 'New').length;
  const countDup = fetchedResultsModal.items.filter((i) => i.status === 'Duplicate').length;
  const countFailed = fetchedResultsModal.items.filter((i) => i.status === 'Failed').length;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-[1600px] mx-auto font-sans">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Job Descriptions
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold">
              {jobs.length}
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-400 mt-1">
            Upload and manage the job descriptions Syntra matches against.
          </p>
        </div>

        {/* Top-right Actions */}
        <div className="flex items-center gap-3 self-start sm:self-auto">
          {selectedJobIds.size > 0 && (
            <button
              onClick={openBulkDelete}
              className="px-4 py-2.5 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/40 font-bold text-xs md:text-sm flex items-center justify-center gap-2 shadow-lg transition cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-red-400" />
              <span>Delete Selected ({selectedJobIds.size})</span>
            </button>
          )}

          <button
            onClick={() => {
              if (onUploadClick) onUploadClick('jd');
              else onNavigate('upload');
            }}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-violet-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs md:text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-900/40 transition cursor-pointer shrink-0 hover:scale-[1.02] active:scale-[0.98]"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload Job Description</span>
          </button>
        </div>
      </div>

      {/* SEARCH & FILTERS & FETCH CONTROLS */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1 md:justify-start">
            {/* Search Input */}
            <div className="relative flex-1 max-w-sm min-w-[240px]">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-purple-400/80" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title, role, company..."
                className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-purple-500/40 bg-[#161028] text-xs md:text-sm text-slate-100 placeholder-slate-400 hover:border-purple-400/60 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400/40 transition shadow-inner shadow-black/20"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-3 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filters Button */}
            <div className="relative" ref={filterPanelRef}>
              <button
                type="button"
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className={`px-4 py-2.5 rounded-xl border font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition cursor-pointer shrink-0 ${
                  activeFilterCount > 0
                    ? 'border-purple-400 bg-purple-600/30 text-purple-200 shadow-md shadow-purple-900/30'
                    : 'border-purple-500/40 bg-[#161028] text-slate-300 hover:border-purple-400/60 hover:text-white'
                }`}
              >
                <Filter className="w-4 h-4 text-purple-400" />
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-purple-500 text-white text-[11px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {/* Filter Dropdown Popover */}
              {isFilterOpen && (
                <div className="absolute right-0 top-12 z-40 w-80 md:w-96 rounded-2xl bg-[#120c24] border border-purple-500/30 shadow-2xl p-5 space-y-4 text-slate-200 text-xs animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto font-sans">
                  <div className="flex items-center justify-between pb-3 border-b border-purple-500/20">
                    <div className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-purple-400" />
                      <span className="font-bold text-white text-sm">Advanced Filters</span>
                    </div>
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={clearAllFilters}
                        className="text-xs text-purple-400 hover:text-purple-300 font-semibold underline cursor-pointer"
                      >
                        Reset All
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    {/* Source Filter */}
                    <div>
                      <label className="font-bold text-purple-300 uppercase tracking-wider text-xs block mb-2">
                        Source
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {['Email', 'Adzuna', 'Jooble', 'Indeed', 'JobPipe', 'Monster', 'Manual'].map((src) => {
                          const isSelected = selectedSources.includes(src);
                          return (
                            <button
                              key={src}
                              type="button"
                              onClick={() => {
                                setSelectedSources((prev) =>
                                  isSelected ? prev.filter((s) => s !== src) : [...prev, src]
                                );
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer border ${
                                isSelected
                                  ? 'bg-purple-600 text-white border-purple-500'
                                  : 'bg-[#1a142c] text-slate-300 border-[#2b2144] hover:border-purple-500/50'
                              }`}
                            >
                              {src}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Location */}
                    <div>
                      <label className="font-bold text-purple-300 uppercase tracking-wider text-xs block mb-2">
                        Location
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {['Remote', 'New York', 'San Francisco', 'Dallas', 'Austin', 'Chicago', 'Atlanta', 'Seattle'].map((loc) => {
                          const isSelected = selectedLocations.includes(loc);
                          return (
                            <button
                              key={loc}
                              type="button"
                              onClick={() => {
                                setSelectedLocations((prev) =>
                                  isSelected ? prev.filter((l) => l !== loc) : [...prev, loc]
                                );
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer border ${
                                isSelected
                                  ? 'bg-purple-600 text-white border-purple-500'
                                  : 'bg-[#1a142c] text-slate-300 border-[#2b2144] hover:border-purple-500/50'
                              }`}
                            >
                              {loc}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Work Mode */}
                    <div>
                      <label className="font-bold text-purple-300 uppercase tracking-wider text-xs block mb-2">
                        Work Mode
                      </label>
                      <div className="flex gap-2">
                        {['Remote', 'Hybrid', 'Onsite'].map((wm) => {
                          const isSelected = selectedWorkModes.includes(wm);
                          return (
                            <button
                              key={wm}
                              type="button"
                              onClick={() => {
                                setSelectedWorkModes((prev) =>
                                  isSelected ? prev.filter((m) => m !== wm) : [...prev, wm]
                                );
                              }}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer border text-center ${
                                isSelected
                                  ? 'bg-purple-600 text-white border-purple-500'
                                  : 'bg-[#1a142c] text-slate-300 border-[#2b2144] hover:border-purple-500/50'
                              }`}
                            >
                              {wm}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Visa */}
                    <div>
                      <label className="font-bold text-purple-300 uppercase tracking-wider text-xs block mb-2">
                        Visa / Work Authorization
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {['US Citizen', 'Green Card', 'H1B', 'OPT', 'CPT', 'C2C', 'W2'].map((visa) => {
                          const isSelected = selectedVisas.includes(visa);
                          return (
                            <button
                              key={visa}
                              type="button"
                              onClick={() => {
                                setSelectedVisas((prev) =>
                                  isSelected ? prev.filter((v) => v !== visa) : [...prev, visa]
                                );
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer border ${
                                isSelected
                                  ? 'bg-purple-600 text-white border-purple-500'
                                  : 'bg-[#1a142c] text-slate-300 border-[#2b2144] hover:border-purple-500/50'
                              }`}
                            >
                              {visa}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Experience */}
                    <div>
                      <label className="font-bold text-purple-300 uppercase tracking-wider text-xs block mb-2">
                        Experience (Years)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          min="0"
                          max="30"
                          value={minExp ?? ''}
                          onChange={(e) => setMinExp(e.target.value === '' ? null : Number(e.target.value))}
                          placeholder="Min Yrs"
                          className="w-full px-3 py-1.5 rounded-lg bg-[#1a142c] border border-[#2b2144] text-xs text-white placeholder-slate-400 focus:border-purple-400 focus:outline-none"
                        />
                        <input
                          type="number"
                          min="0"
                          max="30"
                          value={maxExp ?? ''}
                          onChange={(e) => setMaxExp(e.target.value === '' ? null : Number(e.target.value))}
                          placeholder="Max Yrs"
                          className="w-full px-3 py-1.5 rounded-lg bg-[#1a142c] border border-[#2b2144] text-xs text-white placeholder-slate-400 focus:border-purple-400 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Seniority */}
                    <div>
                      <label className="font-bold text-purple-300 uppercase tracking-wider text-xs block mb-2">
                        Seniority Level
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {['Junior', 'Mid-Level', 'Senior', 'Lead', 'Principal', 'Architect'].map((sen) => {
                          const isSelected = selectedSeniorities.includes(sen);
                          return (
                            <button
                              key={sen}
                              type="button"
                              onClick={() => {
                                setSelectedSeniorities((prev) =>
                                  isSelected ? prev.filter((s) => s !== sen) : [...prev, sen]
                                );
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer border ${
                                isSelected
                                  ? 'bg-purple-600 text-white border-purple-500'
                                  : 'bg-[#1a142c] text-slate-300 border-[#2b2144] hover:border-purple-500/50'
                              }`}
                            >
                              {sen}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Skills */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="font-bold text-purple-300 uppercase tracking-wider text-xs">
                          Skills
                        </label>
                        {selectedSkills.length > 0 && (
                          <span className="text-[11px] font-bold text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                            {selectedSkills.length} selected
                          </span>
                        )}
                      </div>
                      <div className="relative mb-2.5">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-purple-400/80" />
                        <input
                          type="text"
                          value={skillSearchQuery}
                          onChange={(e) => setSkillSearchQuery(e.target.value)}
                          placeholder="Search skills (e.g. React, Java, AWS)..."
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#18112e] border border-purple-500/30 text-xs text-white placeholder-slate-400 focus:border-purple-400 focus:outline-none transition"
                        />
                      </div>

                      {selectedSkills.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {selectedSkills.map((skill) => (
                            <span
                              key={skill}
                              className="px-2 py-0.5 rounded bg-purple-600 text-white text-[11px] font-medium flex items-center gap-1 shadow-sm"
                            >
                              <span>{skill}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedSkills((prev) => prev.filter((s) => s !== skill))
                                }
                                className="hover:text-purple-200 cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                        {Array.from(
                          new Set([
                            ...jobs.flatMap((j) => j.skills || []),
                            'React',
                            'Node.js',
                            'TypeScript',
                            'Python',
                            'AWS',
                            'Java',
                            'Docker',
                            'Kubernetes',
                            'SQL',
                            'PostgreSQL',
                            'Spring Boot',
                          ])
                        )
                          .filter(
                            (skill) =>
                              skillSearchQuery === '' ||
                              skill.toLowerCase().includes(skillSearchQuery.toLowerCase())
                          )
                          .slice(0, 16)
                          .map((skill) => {
                            const isSelected = selectedSkills.includes(skill);
                            return (
                              <button
                                key={skill}
                                type="button"
                                onClick={() => {
                                  setSelectedSkills((prev) =>
                                    isSelected ? prev.filter((s) => s !== skill) : [...prev, skill]
                                  );
                                }}
                                className={`px-2.5 py-0.5 rounded-md border text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                                  isSelected
                                    ? 'bg-purple-600 text-white border-purple-500 font-semibold'
                                    : 'bg-[#1a142c] text-slate-300 border-[#2b2144] hover:border-purple-500/50'
                                }`}
                              >
                                {isSelected ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Tag className="w-2.5 h-2.5 text-slate-500" />
                                )}
                                <span>{skill}</span>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-purple-500/20 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      disabled={activeFilterCount === 0}
                      className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      Clear All
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsFilterOpen(false)}
                      className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-900/40 transition cursor-pointer"
                    >
                      Apply Filters
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ASTRA PRIMARY ACTION: Fetch JDs ▼ */}
            <div className="relative" ref={fetchDropdownRef}>
              <button
                type="button"
                onClick={() => setIsFetchDropdownOpen(!isFetchDropdownOpen)}
                className="px-4 py-2.5 rounded-xl bg-[#1d1435] hover:bg-[#271b47] text-purple-200 border border-purple-500/40 font-bold text-xs md:text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-950/40 transition cursor-pointer hover:border-purple-400/70"
              >
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>Fetch JDs</span>
                <ChevronDown className={`w-3.5 h-3.5 text-purple-300 transition-transform ${isFetchDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isFetchDropdownOpen && (
                <div className="absolute left-0 top-12 z-50 w-60 rounded-2xl bg-[#140e26] border border-purple-500/30 shadow-2xl p-2 space-y-1 text-slate-200 text-xs animate-in fade-in zoom-in-95 duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setIsFetchDropdownOpen(false);
                      openEmailModal();
                    }}
                    className="w-full px-3 py-2.5 rounded-xl hover:bg-purple-600/20 text-slate-200 hover:text-white text-left flex items-center gap-2.5 transition cursor-pointer"
                  >
                    <Mail className="w-4 h-4 text-purple-400" />
                    <span className="font-semibold text-xs">From Email (IMAP)</span>
                  </button>

                  <div className="pt-2 pb-1 px-3 border-t border-purple-500/20">
                    <span className="text-[10px] font-bold text-purple-400/80 uppercase tracking-wider">
                      Job Boards
                    </span>
                  </div>

                  {[
                    { name: 'Adzuna', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
                    { name: 'Jooble', color: 'text-blue-400', bg: 'bg-blue-500/20' },
                    { name: 'Indeed', color: 'text-indigo-400', bg: 'bg-indigo-500/20' },
                    { name: 'JobPipe', color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
                    { name: 'Monster', color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/20' },
                  ].map((jb) => (
                    <button
                      key={jb.name}
                      type="button"
                      onClick={() => {
                        setIsFetchDropdownOpen(false);
                        openJobBoardModal(jb.name as any);
                      }}
                      className="w-full px-3 py-2 rounded-xl hover:bg-purple-600/20 text-slate-300 hover:text-white text-left flex items-center justify-between transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2 h-2 rounded-full ${jb.bg} border border-current ${jb.color}`} />
                        <span className="font-medium text-xs">{jb.name}</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* JOB DESCRIPTIONS TABLE */}
      <div className="rounded-2xl overflow-hidden border border-[#261e38] bg-[#0c0916]/80 glass-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#261e38] bg-[#150f27] text-[#94a3b8] font-semibold text-xs uppercase tracking-wider sticky top-0 z-10">
                <th className="py-4 px-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={allFilteredJobsSelected}
                    onChange={toggleSelectAllJobs}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900/50 text-purple-600 focus:ring-purple-500 accent-purple-600 cursor-pointer"
                    title="Select all jobs"
                  />
                </th>
                <th className="py-4 px-5">FILE</th>
                <th className="py-4 px-5">ROLE</th>
                <th className="py-4 px-5">SOURCE</th>
                <th className="py-4 px-5">COMPANY</th>
                <th className="py-4 px-5">SENIORITY</th>
                <th className="py-4 px-5 w-32">THRESHOLD</th>
                <th className="py-4 px-5" title="Resumes with semantic vector similarity >= threshold">
                  <div className="flex flex-col">
                    <span>MATCHES</span>
                    <span className="text-[9px] text-purple-400/80 font-normal lowercase tracking-normal">
                      ≥ threshold semantic
                    </span>
                  </div>
                </th>
                <th className="py-4 px-5">UPLOADED</th>
                <th className="py-4 px-5 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#261e38]/60 text-xs text-slate-300">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    No matching Job Descriptions found.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => {
                  const fileName = cleanFileName(
                    job.fileName || `${(job.title || 'job').toLowerCase().replace(/\s+/g, '_')}_jd.pdf`
                  );
                  const roleTag = job.roleTag || job.title;
                  const seniorityTag = job.seniority || calculateSeniority(job.title, job.experience);
                  const uploadedDate = job.uploadedDate || 'Jul 20, 2026';
                  const isSelected = selectedJobIds.has(job.id);
                  const currentThreshold = rowThresholds[job.id] ?? job.scoreThreshold ?? 50;

                  return (
                    <tr
                      key={job.id}
                      className={`transition-colors duration-150 group ${
                        isSelected ? 'bg-purple-900/20' : 'hover:bg-purple-900/10'
                      }`}
                    >
                      {/* CHECKBOX */}
                      <td className="py-4 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectJob(job.id)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900/50 text-purple-600 focus:ring-purple-500 accent-purple-600 cursor-pointer"
                        />
                      </td>

                      {/* FILE */}
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-2 max-w-[220px]">
                          <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                          <span className="truncate font-medium text-slate-200" title={fileName}>
                            {fileName}
                          </span>
                        </div>
                      </td>

                      {/* ROLE */}
                      <td className="py-4 px-5">
                        <span
                          className={`px-2.5 py-1 rounded-lg border font-semibold text-xs inline-block max-w-[180px] truncate ${getRoleBadgeStyle(
                            roleTag
                          )}`}
                          title={roleTag}
                        >
                          {roleTag}
                        </span>
                      </td>

                      {/* SOURCE */}
                      <td className="py-4 px-5">
                        {renderSourceBadge(job.sourceName, job.sourceEmail)}
                      </td>

                      {/* COMPANY */}
                      <td className="py-4 px-5 font-medium text-slate-300">
                        {job.company || ''}
                      </td>

                      {/* SENIORITY */}
                      <td className="py-4 px-5">
                        <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300 text-xs font-semibold">
                          {seniorityTag}
                        </span>
                      </td>

                      {/* THRESHOLD SLIDER */}
                      <td className="py-4 px-5">
                        <div className="space-y-1 w-28">
                          <div className="flex justify-between items-center text-[10px] text-slate-400">
                            <span>Cutoff</span>
                            <span className="font-bold text-purple-300 font-mono">
                              {currentThreshold}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={currentThreshold}
                            onChange={(e) => {
                              const newVal = Number(e.target.value);
                              setRowThresholds((prev) => ({
                                ...prev,
                                [job.id]: newVal,
                              }));
                              if (onThresholdChange) {
                                onThresholdChange(job.id, newVal);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${currentThreshold}%, #23193d ${currentThreshold}%, #23193d 100%)`,
                            }}
                            className="w-full accent-purple-400 cursor-pointer h-1.5 rounded-full appearance-none outline-none"
                          />
                        </div>
                      </td>

                      {/* MATCHES */}
                      <td className="py-4 px-5">
                        <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold">
                          {job.matchScores && job.matchScores.length > 0
                            ? job.matchScores.filter((s) => s >= currentThreshold).length
                            : job.matchCount ?? 0}
                        </span>
                      </td>

                      {/* UPLOADED */}
                      <td className="py-4 px-5 text-slate-400 font-medium">{uploadedDate}</td>

                      {/* ACTIONS */}
                      <td className="py-4 px-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* View Button */}
                          <button
                            onClick={() => openJobDetail(job)}
                            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer"
                            title="View Job Description Details"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-400" />
                            <span>View</span>
                          </button>

                          {/* Go to Match Button */}
                          <button
                            onClick={() => onGoToMatch('job', job.id)}
                            className="px-3.5 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/40 font-bold text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer hover:scale-105 active:scale-95"
                            title="Open AI Matching Workspace"
                          >
                            <Target className="w-3.5 h-3.5 text-purple-400" />
                            <span>Go to Match</span>
                          </button>

                          {/* Delete Button */}
                          <button
                            onClick={() => openSingleDelete(job.id, cleanJobTitle(job.title))}
                            className="p-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40 transition cursor-pointer"
                            title="Delete permanently"
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

        {/* Table Footer / Pagination */}
        <div className="p-4 border-t border-[#261e38] bg-[#0d0918]/60 flex items-center justify-between text-xs text-slate-400 flex-wrap gap-3">
          <div>
            Showing{' '}
            <span className="font-semibold text-slate-200">
              {filteredJobs.length === 0 ? 0 : 1}
            </span>{' '}
            -{' '}
            <span className="font-semibold text-slate-200">
              {filteredJobs.length}
            </span>{' '}
            of{' '}
            <span className="font-semibold text-slate-200">
              {jobs.length}
            </span>{' '}
            job descriptions
          </div>

          <div className="flex items-center gap-1.5">
            <button
              disabled
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-slate-500 cursor-not-allowed text-xs font-medium"
            >
              Previous
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-purple-600 text-white font-bold text-xs shadow">
              1
            </button>
            <button
              disabled
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-slate-500 cursor-not-allowed text-xs font-medium"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* PERMANENT DELETE CONFIRMATION MODAL */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#150f27] border border-red-500/30 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl relative animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-white">Delete permanently?</h3>
                {deleteModal.targetTitle && (
                  <p className="text-xs text-slate-400 truncate max-w-[280px]">
                    {deleteModal.targetTitle}
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
              This job description and all associated data will be permanently deleted from the database. This action cannot be undone.
            </p>

            {deleteModal.error && (
              <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{deleteModal.error}</span>
              </div>
            )}

            <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeDeleteModal}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteModal.isDeleting}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-red-900/40 transition cursor-pointer disabled:opacity-50"
              >
                {deleteModal.isDeleting ? (
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

      {/* JOB DETAIL VIEW MODAL (WITH ASTRA SOURCE INFO) */}
      {viewingJob && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#120c24] border border-purple-500/30 rounded-2xl p-6 max-w-2xl w-full space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
            <button
              onClick={() => setViewingJob(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-start justify-between gap-4 pr-8">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-purple-400 font-bold">{viewingJob.id}</span>
                    {renderSourceBadge(viewingJob.sourceName, viewingJob.sourceEmail)}
                  </div>
                  <h3 className="text-xl font-extrabold text-white mt-1">{cleanJobTitle(viewingJob.title)}</h3>
                  <p className="text-xs text-slate-400">{viewingJob.company}</p>
                </div>
              </div>

              {/* View Original Job Button */}
              {viewingJob.sourceUrl && (
                <a
                  href={viewingJob.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/40 text-purple-200 border border-purple-500/40 text-xs font-bold flex items-center gap-1.5 transition shrink-0 hover:scale-105 active:scale-95"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-purple-300" />
                  <span>View Original Job</span>
                </a>
              )}
            </div>

            {/* ASTRA Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Work Mode</span>
                <span className="font-semibold text-slate-100">{viewingJob.workMode || 'Remote'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Experience</span>
                <span className="font-semibold text-slate-100">{viewingJob.experience || '3+ Years'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Employment Type</span>
                <span className="font-semibold text-slate-100">{viewingJob.employmentType || 'Full-time'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Visa Requirement</span>
                <span className="font-semibold text-slate-100">{viewingJob.visaRequirement || viewingJob.visa || 'Any'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Location</span>
                <span className="font-semibold text-slate-100">{viewingJob.location || 'USA'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Source</span>
                <span className="font-semibold text-purple-300 capitalize">{viewingJob.sourceName || (viewingJob.sourceEmail ? 'Email' : 'Manual')}</span>
              </div>
              {viewingJob.sourceEmail ? (
                <div className="col-span-2">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Sender Email</span>
                  <span className="font-semibold text-purple-300 truncate block">{viewingJob.sourceEmail}</span>
                </div>
              ) : (
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Processing</span>
                  <span className="font-semibold text-emerald-300 capitalize">{viewingJob.processingStatus || 'processed'}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Description / AI Summary</span>
              <p className="text-xs text-slate-300 leading-relaxed bg-white/5 p-3.5 rounded-xl border border-white/5 font-normal whitespace-pre-wrap min-h-[3.5rem]">
                {viewingJobLoading
                  ? 'Loading AI summary…'
                  : viewingJob.description?.trim()
                  ? viewingJob.description
                  : 'No AI summary yet — job may still be processing.'}
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Required Skills</span>
              <div className="flex flex-wrap gap-2">
                {viewingJob.skills && viewingJob.skills.length > 0 ? (
                  viewingJob.skills.map((s) => (
                    <span key={s} className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
                      {s}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-400 italic">No specific skills parsed</span>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                onClick={() => setViewingJob(null)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => {
                  const jobId = viewingJob.id;
                  setViewingJob(null);
                  onGoToMatch('job', jobId);
                }}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-purple-900/50 transition cursor-pointer hover:scale-105 active:scale-95"
              >
                <Target className="w-4 h-4" />
                <span>Go to Match</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ASTRA MODAL 1: FETCH JDs FROM EMAIL (IMAP) */}
      {isEmailModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#150f27] border border-purple-500/30 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setIsEmailModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-white">Fetch JDs from Email</h3>
                <p className="text-xs text-slate-400">Poll configured IMAP inbox for incoming JD requirements</p>
              </div>
            </div>

            <div className="space-y-3 p-4 rounded-xl bg-white/5 border border-white/10 text-xs">
              <div>
                <label className="text-[10px] font-bold text-purple-300 uppercase tracking-wider block mb-1">
                  Email Account
                </label>
                <div className="p-2.5 rounded-lg bg-[#1a142c] border border-[#2b2144] text-slate-200 font-mono text-xs">
                  {emailAccount}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-purple-300 uppercase tracking-wider block mb-1">
                    Folder
                  </label>
                  <div className="p-2.5 rounded-lg bg-[#1a142c] border border-[#2b2144] text-slate-200 text-xs">
                    INBOX
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-purple-300 uppercase tracking-wider block mb-1">
                    Status
                  </label>
                  <div className="p-2.5 rounded-lg bg-[#1a142c] border border-[#2b2144] text-emerald-400 font-semibold text-xs flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Connected</span>
                  </div>
                </div>
              </div>
            </div>

            {emailFetchError && (
              <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{emailFetchError}</span>
              </div>
            )}

            <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsEmailModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFetchEmails}
                disabled={isPollingEmail}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-900/50 transition cursor-pointer disabled:opacity-50 hover:scale-105 active:scale-95"
              >
                {isPollingEmail ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Polling Inbox...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>Fetch Emails</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ASTRA MODAL 2: FETCH FROM JOB BOARD */}
      {isJobBoardModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#150f27] border border-purple-500/30 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setIsJobBoardModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-white">Fetch JDs — {selectedJobBoard}</h3>
                <p className="text-xs text-slate-400">Search and intake live job board listings</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-purple-300 uppercase tracking-wider text-[10px] block mb-1.5">
                  Source
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Adzuna', 'Jooble', 'Indeed', 'JobPipe', 'Monster'] as const).map((source) => (
                    <button
                      key={source}
                      type="button"
                      onClick={() => setSelectedJobBoard(source)}
                      className={`py-2 px-3 rounded-xl border text-xs font-semibold transition cursor-pointer text-center ${
                        selectedJobBoard === source
                          ? 'bg-purple-600 text-white border-purple-400 shadow-md shadow-purple-900/30'
                          : 'bg-[#1a142c] text-slate-300 border-[#2b2144] hover:border-purple-500/50'
                      }`}
                    >
                      {source}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-bold text-purple-300 uppercase tracking-wider text-[10px] block mb-1.5">
                  Role / Keyword <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={jobBoardKeyword}
                  onChange={(e) => setJobBoardKeyword(e.target.value)}
                  placeholder="e.g. Python Developer, React Engineer"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a142c] border border-[#2b2144] text-white placeholder-slate-500 text-xs focus:border-purple-400 focus:outline-none transition"
                />
              </div>

              <div>
                <label className="font-bold text-purple-300 uppercase tracking-wider text-[10px] block mb-1.5">
                  Location (Optional)
                </label>
                <input
                  type="text"
                  value={jobBoardLocation}
                  onChange={(e) => setJobBoardLocation(e.target.value)}
                  placeholder="e.g. Dallas, TX, Remote, Austin"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a142c] border border-[#2b2144] text-white placeholder-slate-500 text-xs focus:border-purple-400 focus:outline-none transition"
                />
              </div>

              <p className="text-[11px] text-slate-400 italic">
                This will search and fetch latest JDs from {selectedJobBoard}.
              </p>
            </div>

            {jobBoardError && (
              <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{jobBoardError}</span>
              </div>
            )}

            <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsJobBoardModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFetchJobBoard}
                disabled={isFetchingJobBoard}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-900/50 transition cursor-pointer disabled:opacity-50 hover:scale-105 active:scale-95"
              >
                {isFetchingJobBoard ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Searching {selectedJobBoard}...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Fetch JDs</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ASTRA MODAL 3: FETCHED JOB DESCRIPTIONS RESULTS */}
      {fetchedResultsModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#120c24] border border-purple-500/30 rounded-2xl p-6 max-w-4xl w-full space-y-4 shadow-2xl relative max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95">
            <button
              onClick={() => setFetchedResultsModal({ isOpen: false, source: '', items: [] })}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-extrabold text-white">Fetched Job Descriptions</h3>
                <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold">
                  {fetchedResultsModal.items.length} Results
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Source: <span className="text-purple-300 font-semibold">{fetchedResultsModal.source}</span> • Review and select JDs to save into your workspace.
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 border-b border-purple-500/20 pb-2">
              <button
                type="button"
                onClick={() => setFetchedResultsFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  fetchedResultsFilter === 'all'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/5 text-slate-400 hover:text-white'
                }`}
              >
                All Results ({fetchedResultsModal.items.length})
              </button>
              <button
                type="button"
                onClick={() => setFetchedResultsFilter('new')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  fetchedResultsFilter === 'new'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white/5 text-slate-400 hover:text-emerald-300'
                }`}
              >
                New ({countNew})
              </button>
              <button
                type="button"
                onClick={() => setFetchedResultsFilter('duplicate')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  fetchedResultsFilter === 'duplicate'
                    ? 'bg-amber-600 text-white'
                    : 'bg-white/5 text-slate-400 hover:text-amber-300'
                }`}
              >
                Duplicates ({countDup})
              </button>
              {countFailed > 0 && (
                <button
                  type="button"
                  onClick={() => setFetchedResultsFilter('failed')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    fetchedResultsFilter === 'failed'
                      ? 'bg-red-600 text-white'
                      : 'bg-white/5 text-slate-400 hover:text-red-300'
                  }`}
                >
                  Failed ({countFailed})
                </button>
              )}
            </div>

            {/* Results Table */}
            <div className="overflow-y-auto flex-1 border border-[#261e38] rounded-xl bg-[#0c0916]/60">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#261e38] bg-[#17102b] text-slate-400 font-semibold sticky top-0 z-10">
                    <th className="py-3 px-3 w-8 text-center">
                      <input
                        type="checkbox"
                        checked={
                          filteredFetchedItems.length > 0 &&
                          filteredFetchedItems.every((_, idx) =>
                            selectedFetchedIndexes.has(
                              fetchedResultsModal.items.indexOf(filteredFetchedItems[idx])
                            )
                          )
                        }
                        onChange={() => {
                          const allSelected = filteredFetchedItems.every((_, idx) =>
                            selectedFetchedIndexes.has(
                              fetchedResultsModal.items.indexOf(filteredFetchedItems[idx])
                            )
                          );
                          const next = new Set(selectedFetchedIndexes);
                          filteredFetchedItems.forEach((_, idx) => {
                            const realIdx = fetchedResultsModal.items.indexOf(filteredFetchedItems[idx]);
                            if (allSelected) {
                              next.delete(realIdx);
                            } else {
                              next.add(realIdx);
                            }
                          });
                          setSelectedFetchedIndexes(next);
                        }}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 accent-purple-600 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-4">TITLE</th>
                    <th className="py-3 px-4">COMPANY</th>
                    <th className="py-3 px-4">LOCATION</th>
                    <th className="py-3 px-4">SOURCE</th>
                    <th className="py-3 px-4">POSTED</th>
                    <th className="py-3 px-4">STATUS</th>
                    <th className="py-3 px-4 text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#261e38]/60 text-slate-300">
                  {filteredFetchedItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        No job descriptions found in this category.
                      </td>
                    </tr>
                  ) : (
                    filteredFetchedItems.map((item) => {
                      const realIndex = fetchedResultsModal.items.indexOf(item);
                      const isSelected = selectedFetchedIndexes.has(realIndex);

                      return (
                        <tr
                          key={realIndex}
                          className={`hover:bg-purple-900/10 transition-colors ${
                            isSelected ? 'bg-purple-900/20' : ''
                          }`}
                        >
                          <td className="py-3 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedFetchedIndexes((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(realIndex)) next.delete(realIndex);
                                  else next.add(realIndex);
                                  return next;
                                });
                              }}
                              className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 accent-purple-600 cursor-pointer"
                            />
                          </td>
                          <td className="py-3 px-4 font-semibold text-white max-w-[200px] truncate" title={item.title}>
                            {item.title}
                          </td>
                          <td className="py-3 px-4 text-slate-300 max-w-[150px] truncate" title={item.company}>
                            {item.company}
                          </td>
                          <td className="py-3 px-4 text-slate-400">{item.location}</td>
                          <td className="py-3 px-4">{renderSourceBadge(item.source)}</td>
                          <td className="py-3 px-4 text-slate-400">
                            {new Date(item.postedAt || Date.now()).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </td>
                          <td className="py-3 px-4">
                            {item.status === 'New' && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold">
                                New
                              </span>
                            )}
                            {item.status === 'Duplicate' && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold">
                                Duplicate
                              </span>
                            )}
                            {item.status === 'Failed' && (
                              <span className="px-2 py-0.5 rounded-md bg-red-500/20 border border-red-500/40 text-red-300 text-[11px] font-bold">
                                Failed
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewModal({
                                  isOpen: true,
                                  item,
                                  activeTab: 'overview',
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-semibold flex items-center gap-1.5 ml-auto transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5 text-purple-400" />
                              <span>Preview</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer Actions */}
            <div className="pt-3 border-t border-purple-500/20 flex items-center justify-between gap-4">
              <span className="text-xs text-slate-400">
                <strong className="text-white">{selectedFetchedIndexes.size}</strong> of {fetchedResultsModal.items.length} selected
              </span>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setFetchedResultsModal({ isOpen: false, source: '', items: [] })}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveSelectedFetched}
                  disabled={selectedFetchedIndexes.size === 0}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-900/50 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Selected ({selectedFetchedIndexes.size})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ASTRA MODAL 4: JD PREVIEW MODAL */}
      {previewModal.isOpen && previewModal.item && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#120c24] border border-purple-500/30 rounded-2xl p-6 max-w-2xl w-full space-y-4 shadow-2xl relative max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
            <button
              onClick={() => setPreviewModal({ isOpen: false, item: null, activeTab: 'overview' })}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">JD Preview</span>
                {previewModal.item.status === 'New' && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold">
                    New
                  </span>
                )}
                {previewModal.item.status === 'Duplicate' && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
                    Duplicate
                  </span>
                )}
              </div>
              <h3 className="text-xl font-extrabold text-white">{previewModal.item.title}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {previewModal.item.company} • {previewModal.item.location} • Source: <strong className="text-purple-300">{previewModal.item.source}</strong>
              </p>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-2 border-b border-purple-500/20 pb-2">
              {(['overview', 'details', 'skills', 'raw'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setPreviewModal((prev) => ({ ...prev, activeTab: tab }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition cursor-pointer ${
                    previewModal.activeTab === tab
                      ? 'bg-purple-600 text-white'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  {tab === 'raw' ? 'Raw Content' : tab}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {previewModal.activeTab === 'overview' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Source</span>
                    <span className="font-semibold text-purple-300">{previewModal.item.source}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Location</span>
                    <span className="font-semibold text-slate-100">{previewModal.item.location}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Experience</span>
                    <span className="font-semibold text-slate-100">{previewModal.item.experience || '3+ Years'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Employment Type</span>
                    <span className="font-semibold text-slate-100">{previewModal.item.employmentType || 'Full-time'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Visa Requirement</span>
                    <span className="font-semibold text-slate-100">{previewModal.item.visa || 'Open'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Remote Policy</span>
                    <span className="font-semibold text-slate-100">{previewModal.item.workMode || 'Remote'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Posted On</span>
                    <span className="font-semibold text-slate-100">
                      {new Date(previewModal.item.postedAt || Date.now()).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  {previewModal.item.sourceUrl && (
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Original URL</span>
                      <a
                        href={previewModal.item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-400 hover:text-purple-300 font-semibold underline flex items-center gap-1 mt-0.5"
                      >
                        <span>View Link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Job Summary</span>
                  <p className="text-xs text-slate-300 leading-relaxed bg-white/5 p-3.5 rounded-xl border border-white/5 whitespace-pre-wrap">
                    {previewModal.item.description || 'No description provided.'}
                  </p>
                </div>

                {previewModal.item.skills && previewModal.item.skills.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Key Skills</span>
                    <div className="flex flex-wrap gap-2">
                      {previewModal.item.skills.map((s) => (
                        <span key={s} className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {previewModal.activeTab === 'details' && (
              <div className="space-y-3 p-4 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300">
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Job Title:</span>
                  <span className="font-semibold text-white">{previewModal.item.title}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Company:</span>
                  <span className="font-semibold text-white">{previewModal.item.company}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Location:</span>
                  <span className="font-semibold text-white">{previewModal.item.location}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Source Platform:</span>
                  <span className="font-semibold text-purple-300">{previewModal.item.source}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Work Mode:</span>
                  <span className="font-semibold text-white">{previewModal.item.workMode || 'Remote'}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Employment Type:</span>
                  <span className="font-semibold text-white">{previewModal.item.employmentType || 'Full-time'}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-400">Visa Requirement:</span>
                  <span className="font-semibold text-white">{previewModal.item.visa || 'Open'}</span>
                </div>
              </div>
            )}

            {previewModal.activeTab === 'skills' && (
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Parsed Skills</span>
                <div className="flex flex-wrap gap-2">
                  {previewModal.item.skills && previewModal.item.skills.length > 0 ? (
                    previewModal.item.skills.map((s) => (
                      <span key={s} className="px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
                        {s}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400 italic">No skills listed</span>
                  )}
                </div>
              </div>
            )}

            {previewModal.activeTab === 'raw' && (
              <div className="p-4 rounded-xl bg-black/40 border border-white/10 max-h-60 overflow-y-auto font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                {previewModal.item.description || 'No raw content available.'}
              </div>
            )}

            {/* Footer */}
            <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3">
              {previewModal.item.sourceUrl ? (
                <a
                  href={previewModal.item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/40 text-purple-200 border border-purple-500/40 text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>View Original Job</span>
                </a>
              ) : <div />}

              <button
                type="button"
                onClick={() => setPreviewModal({ isOpen: false, item: null, activeTab: 'overview' })}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ASTRA MODAL 5: SAVE SUCCESS CONFIRMATION MODAL */}
      {saveSuccessModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#150f27] border border-purple-500/30 rounded-2xl p-6 max-w-md w-full text-center space-y-4 shadow-2xl relative animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-xl font-extrabold text-white">Job Descriptions Saved</h3>
              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                {saveSuccessModal.count > 0
                  ? `✓ ${saveSuccessModal.count} job description(s) were successfully saved and added to your active workspace.`
                  : 'The job descriptions were processed and your active workspace has been updated.'}
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setSaveSuccessModal({ isOpen: false, count: 0 });
                  if (onRefresh) onRefresh();
                }}
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-900/50 transition cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
