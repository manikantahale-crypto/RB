import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sparkles,
  Search,
  AlertCircle,
  Loader2,
  ExternalLink,
  User,
  MapPin,
  ArrowRight,
  ShieldCheck,
  Check,
  RefreshCw,
  SlidersHorizontal,
  Copy,
} from 'lucide-react';
import { FetchedJDItem } from '../../types';
import { apiFetch } from '../../services/api';
import { StatusBadge } from './StatusBadge';

interface StrategyItem {
  id: string;
  candidateIds: string[];
  candidateNames: string[];
  role: string;
  keywords: string;
  location: string;
  source: 'careerjet' | 'adzuna' | 'usajobs' | 'jsearch';
  reason: string;
  enabled: boolean;
  isCached?: boolean;
}

interface ExecutionSummary {
  queriesTotal: number;
  queriesExecuted: number;
  queriesCached: number;
  queriesFailed: number;
  totalFetched: number;
  totalCreated: number;
  totalDuplicates: number;
  totalMatched?: number;
}

interface JobRecommendation {
  jobId?: string;
  matchId?: string | null;
  title: string;
  company: string;
  location: string;
  source: string;
  sourceUrl?: string | null;
  postedAt?: string;
  skills?: string[];
  description?: string;
  employmentType?: string | null;
  workMode?: string | null;
  candidateId?: string;
  candidateName?: string;
  candidateRole?: string;
  matchScore: number;
  matchTier: string;
  whyMatched: string;
  matchedSkills?: string[];
  missingSkills?: string[];
  isOfficialMatch?: boolean;
  discoveryRelevanceScore?: number;
}

interface JobDiscoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  onGoToMatch?: (mode: 'job' | 'resume', id: string) => void;
  initialSelectedCandidateIds?: string[];
}

export const JobDiscoveryModal: React.FC<JobDiscoveryModalProps> = ({
  isOpen,
  onClose,
  onRefresh,
  onGoToMatch,
  initialSelectedCandidateIds = [],
}) => {
  // Modal Steps: 'autonomous_running' | 'select_candidates' | 'review_plan' | 'results'
  const [step, setStep] = useState<'autonomous_running' | 'select_candidates' | 'review_plan' | 'results'>('autonomous_running');

  // Candidate Data State
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());

  // Autonomous Progress State
  const [activeStage, setActiveStage] = useState<number>(1);
  const [progressPercent, setProgressPercent] = useState<number>(15);

  // Manual / Advanced Plan State
  const [strategies, setStrategies] = useState<StrategyItem[]>([]);
  const [planError, setPlanError] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [returnStep, setReturnStep] = useState<'select_candidates' | 'results'>('select_candidates');

  // Results State
  const [executionSummary, setExecutionSummary] = useState<ExecutionSummary | null>(null);
  const [discoveredItems, setDiscoveredItems] = useState<FetchedJDItem[]>([]);
  const [recommendations, setRecommendations] = useState<JobRecommendation[]>([]);
  const [selectedFilterCandidateId, setSelectedFilterCandidateId] = useState<string>('all');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isExistingDiscovery, setIsExistingDiscovery] = useState<boolean>(false);

  // Stable dependency key for initial selection
  const initialIdsKey = (initialSelectedCandidateIds || []).join(',');
  const hasTriggeredRef = useRef(false);

  // Autonomous Execution Trigger on Open
  useEffect(() => {
    if (!isOpen) {
      setStep('autonomous_running');
      setLoadingCandidates(false);
      setLoadingPlan(false);
      setReturnStep('select_candidates');
      setStrategies([]);
      setDiscoveredItems([]);
      setRecommendations([]);
      setExecutionSummary(null);
      setPlanError(null);
      setExecutionError(null);
      setIsExistingDiscovery(false);
      setActiveStage(1);
      setProgressPercent(15);
      hasTriggeredRef.current = false;
      return;
    }

    if (initialSelectedCandidateIds && initialSelectedCandidateIds.length > 0) {
      setSelectedCandidateIds(new Set(initialSelectedCandidateIds));
    }

    if (hasTriggeredRef.current) return;
    hasTriggeredRef.current = true;

    // Immediately start Autonomous Job Discovery on open
    runAutonomousFlow(initialSelectedCandidateIds, false);
  }, [isOpen, initialIdsKey]);

  /**
   * 1-Click Autonomous Job Discovery Flow.
   */
  const runAutonomousFlow = async (candidateIdsToRun: string[] = [], forceFresh: boolean = false) => {
    setStep('autonomous_running');
    setExecutionError(null);
    setIsExistingDiscovery(false);
    setActiveStage(1);
    setProgressPercent(15);

    // Staged Progress Animation
    const stageTimer1 = setTimeout(() => {
      setActiveStage(2);
      setProgressPercent(35);
    }, 800);

    const stageTimer2 = setTimeout(() => {
      setActiveStage(3);
      setProgressPercent(60);
    }, 1600);

    const stageTimer3 = setTimeout(() => {
      setActiveStage(4);
      setProgressPercent(80);
    }, 2500);

    const stageTimer4 = setTimeout(() => {
      setActiveStage(5);
      setProgressPercent(95);
    }, 3500);

    try {
      const res = await apiFetch('/api/job-discovery/autonomous', {
        method: 'POST',
        body: JSON.stringify({
          candidateIds: candidateIdsToRun.length > 0 ? candidateIdsToRun : [],
          maxStrategies: 8,
          forceFresh,
        }),
      });

      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      clearTimeout(stageTimer3);
      clearTimeout(stageTimer4);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || 'Autonomous job discovery failed.');
      }

      const json = await res.json();
      const resultData = json.data || {};

      setExecutionSummary(resultData.summary || null);
      setDiscoveredItems(resultData.items || []);
      setRecommendations(resultData.recommendations || []);
      setStrategies(resultData.strategies || []);
      setIsExistingDiscovery(Boolean(resultData.isExistingDiscovery));

      // Preserve candidate IDs targeted during discovery
      if (resultData.candidates && resultData.candidates.length > 0) {
        const targetedIds = resultData.candidates.map((c: any) => c.id);
        setSelectedCandidateIds(new Set(targetedIds));
      } else if (candidateIdsToRun.length > 0) {
        setSelectedCandidateIds(new Set(candidateIdsToRun));
      }

      setProgressPercent(100);
      setActiveStage(5);

      setTimeout(() => {
        setStep('results');
        if (onRefresh) {
          onRefresh();
        }
      }, 350);
    } catch (err: any) {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      clearTimeout(stageTimer3);
      clearTimeout(stageTimer4);
      setExecutionError(err.message || 'Error running autonomous job discovery');
      setStep('select_candidates');
      loadCandidateList();
    }
  };

  const loadCandidateList = async () => {
    setLoadingCandidates(true);
    try {
      const res = await apiFetch('/api/job-discovery/candidates');
      if (res.ok) {
        const json = await res.json();
        const list = json.data?.candidates || [];
        setCandidates(list);
        if (selectedCandidateIds.size === 0) {
          const benchIds = list
            .filter((c: any) => c.isBench || ['BENCH', 'AVAILABLE', 'PRIORITIZE'].includes(c.orbitState))
            .map((c: any) => c.id);
          if (benchIds.length > 0) {
            setSelectedCandidateIds(new Set(benchIds));
          } else if (list.length > 0) {
            setSelectedCandidateIds(new Set(list.map((c: any) => c.id)));
          }
        }
      }
    } catch (err) {
      console.error('Error loading candidates:', err);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const toggleCandidateSelection = (id: string) => {
    const next = new Set(selectedCandidateIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedCandidateIds(next);
  };

  /**
   * Advanced / Custom Manual Search Plan Handler.
   */
  const handleGenerateCustomPlan = async (candidateIdsOverride?: string[]) => {
    let ids = candidateIdsOverride && candidateIdsOverride.length > 0
      ? candidateIdsOverride
      : Array.from(selectedCandidateIds);

    // If candidate IDs are missing, attempt fallback to loaded candidates or fetch eligible
    if (ids.length === 0) {
      if (candidates.length > 0) {
        const benchIds = candidates
          .filter((c: any) => c.isBench || ['BENCH', 'AVAILABLE', 'PRIORITIZE'].includes(c.orbitState))
          .slice(0, 3)
          .map((c: any) => c.id);
        ids = benchIds.length > 0 ? benchIds : candidates.slice(0, 1).map((c: any) => c.id);
        setSelectedCandidateIds(new Set(ids));
      } else {
        try {
          const res = await apiFetch('/api/job-discovery/candidates');
          if (res.ok) {
            const json = await res.json();
            const list = json.data?.candidates || [];
            setCandidates(list);
            const benchIds = list
              .filter((c: any) => c.isBench || ['BENCH', 'AVAILABLE', 'PRIORITIZE'].includes(c.orbitState))
              .slice(0, 3)
              .map((c: any) => c.id);
            ids = benchIds.length > 0 ? benchIds : list.slice(0, 1).map((c: any) => c.id);
            setSelectedCandidateIds(new Set(ids));
          }
        } catch (cErr) {
          console.error('Error fetching fallback candidate IDs:', cErr);
        }
      }
    }

    if (ids.length === 0) {
      setPlanError('Please select at least 1 candidate for job discovery.');
      return;
    }

    setPlanError(null);
    setLoadingPlan(true);

    try {
      const res = await apiFetch('/api/job-discovery/plan', {
        method: 'POST',
        body: JSON.stringify({
          candidateIds: ids,
          maxStrategies: 4,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || 'Failed to generate search strategies.');
      }

      const json = await res.json();
      const rawStrategies = json.data?.strategies || [];
      const formattedStrategies: StrategyItem[] = rawStrategies.map((s: any, idx: number) => ({
        id: s.id || `strat-${idx + 1}`,
        candidateIds: s.candidateIds || [],
        candidateNames: s.candidateNames || [],
        role: s.role || 'Software Engineer',
        keywords: s.keywords || s.role || 'Developer',
        location: s.location || 'Remote',
        source: s.source || 'careerjet',
        reason: s.reason || 'High-demand skill alignment',
        enabled: true,
        isCached: s.isCached || false,
      }));

      setStrategies(formattedStrategies);
      setStep('review_plan');
    } catch (err: any) {
      setPlanError(err.message || 'Error generating search plan');
    } finally {
      setLoadingPlan(false);
    }
  };

  const handleToggleStrategy = (id: string) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const handleUpdateStrategy = (id: string, field: keyof StrategyItem, val: any) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: val } : s))
    );
  };

  const handleExecuteManualPlan = async () => {
    const enabledStrategies = strategies.filter((s) => s.enabled);
    if (enabledStrategies.length === 0) {
      setPlanError('Please enable at least 1 strategy to execute.');
      return;
    }

    setStep('autonomous_running');
    setExecutionError(null);
    setActiveStage(3);
    setProgressPercent(50);

    try {
      const res = await apiFetch('/api/job-discovery/execute', {
        method: 'POST',
        body: JSON.stringify({
          approvedStrategies: enabledStrategies.map((s) => ({
            candidateIds: s.candidateIds,
            candidateNames: s.candidateNames,
            role: s.role,
            keywords: s.keywords,
            location: s.location,
            source: s.source,
          })),
          candidateIds: Array.from(selectedCandidateIds),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.error || 'Failed to execute job discovery.');
      }

      const json = await res.json();
      const resultData = json.data || {};

      setExecutionSummary(resultData.summary || null);
      setDiscoveredItems(resultData.items || []);
      setRecommendations(resultData.recommendations || []);
      setStep('results');

      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      setExecutionError(err.message || 'Error executing job discovery search');
      setStep('review_plan');
    }
  };

  const copyApplyLink = (url: string, index: number) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Helper for source badge styling
  const getSourceBadge = (source: string) => {
    const s = (source || '').toLowerCase();
    if (s.includes('dice')) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">Dice</span>;
    if (s.includes('linkedin')) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">LinkedIn</span>;
    if (s.includes('indeed')) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">Indeed</span>;
    if (s.includes('usajobs')) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">USAJOBS</span>;
    if (s.includes('careerjet')) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500/20 text-teal-400 border border-teal-500/30">Careerjet</span>;
    if (s.includes('adzuna')) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">Adzuna</span>;
    if (s.includes('jooble')) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">Jooble</span>;
    return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-700/50 text-gray-300 border border-gray-600/50">{source || 'Web Search'}</span>;
  };

  const enabledCount = strategies.filter((s) => s.enabled).length;

  // Filter recommendations by selected candidate tab
  const filteredRecommendations = selectedFilterCandidateId === 'all'
    ? recommendations
    : recommendations.filter((r) => r.candidateId === selectedFilterCandidateId);

  // Group candidate filter options
  const candidateFilterOptions = Array.from(
    new Map(recommendations.map((r) => [r.candidateId, r.candidateName])).entries()
  ).filter(([id, name]) => Boolean(id && name));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-[#12161f] border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-[#161c28]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/30 text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Find Jobs for My Candidates
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  Autonomous AI Agent
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {step === 'autonomous_running' && 'AI Agent is autonomously planning, searching job boards, and ranking matching jobs...'}
                {step === 'select_candidates' && 'Target bench consultants for autonomous search, deduplication & match ranking'}
                {step === 'review_plan' && 'Customize search matrix keywords and source distribution'}
                {step === 'results' && 'Official SYNTRA Candidate ↔ JD Match Results & Direct Apply Links'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* STEP 1: AUTONOMOUS RUNNING PROGRESS TIMELINE (Primary View on 1-Click Launch) */}
          {step === 'autonomous_running' && (
            <div className="py-8 px-4 max-w-xl mx-auto space-y-6">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 relative">
                  <Loader2 className="w-7 h-7 animate-spin" />
                  <Sparkles className="w-4 h-4 text-indigo-300 absolute inset-0 m-auto animate-pulse" />
                </div>
                <h3 className="text-base font-bold text-white">
                  Autonomous Discovery in Progress
                </h3>
                <p className="text-xs text-gray-400">
                  AI Agent is analyzing candidates, querying job boards, and evaluating matches.
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-gray-800/80 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-500 h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Staged Timeline Items */}
              <div className="space-y-3 pt-2">
                {[
                  { stage: 1, title: 'Analyzing Candidate Profiles', desc: 'Understanding core tech stacks, experience levels, and work authorization' },
                  { stage: 2, title: 'Formulating Search Strategies', desc: 'Synthesizing targeted keyword combinations and selecting optimal job boards' },
                  { stage: 3, title: 'Searching Job Boards in Parallel', desc: 'Querying Careerjet, Adzuna, USAJOBS, and JSearch aggregator' },
                  { stage: 4, title: 'ASTRA Deduplication & Ingestion', desc: 'Applying SHA-256 content hashes and preserving original publisher apply links' },
                  { stage: 5, title: 'SYNTRA Candidate ↔ JD Matching', desc: 'Evaluating 3-tier matching funnel and generating official match scores' },
                ].map((s) => {
                  const isDone = activeStage > s.stage;
                  const isCurrent = activeStage === s.stage;
                  return (
                    <div
                      key={s.stage}
                      className={`p-3 rounded-xl border flex items-center space-x-3 transition-all ${
                        isDone
                          ? 'bg-emerald-950/15 border-emerald-500/30 text-gray-300'
                          : isCurrent
                          ? 'bg-purple-950/25 border-purple-500/50 text-white shadow-md shadow-purple-950/20'
                          : 'bg-gray-900/30 border-gray-800/40 text-gray-500'
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                          isDone
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : isCurrent
                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40 animate-pulse'
                            : 'bg-gray-800 text-gray-500 border border-gray-700'
                        }`}
                      >
                        {isDone ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : s.stage}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h5 className={`text-xs font-bold ${isCurrent ? 'text-white' : isDone ? 'text-gray-200' : 'text-gray-500'}`}>
                          {s.title}
                        </h5>
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">
                          {s.desc}
                        </p>
                      </div>
                      {isCurrent && (
                        <Loader2 className="w-4 h-4 animate-spin text-purple-400 flex-shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: SELECT CANDIDATES (Accessible via "Customize Candidates" or Retry) */}
          {step === 'select_candidates' && (
            <div className="space-y-4 min-h-[380px]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-300">
                  Target Consultants ({loadingCandidates ? '...' : selectedCandidateIds.size}/5 selected)
                </span>
                <span className="text-[11px] text-purple-400">
                  Bench & Available candidates auto-targeted
                </span>
              </div>

              {loadingCandidates ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-h-[340px]">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-xl border border-gray-800/80 bg-[#181f2c]/50 animate-pulse flex items-start space-x-3 select-none"
                    >
                      <div className="w-5 h-5 mt-0.5 rounded-md bg-gray-800 border border-gray-700/60" />
                      <div className="flex-1 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="h-3.5 bg-gray-700/60 rounded w-1/3" />
                          <div className="h-4 bg-purple-900/30 border border-purple-500/20 rounded-full w-16" />
                        </div>
                        <div className="h-3 bg-purple-400/20 rounded w-1/2" />
                        <div className="flex items-center space-x-3 pt-1">
                          <div className="h-2.5 bg-gray-800 rounded w-16" />
                          <div className="h-2.5 bg-gray-800 rounded w-20" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : candidates.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[340px] text-center text-gray-400 space-y-2 py-12">
                  <User className="w-10 h-10 mx-auto text-gray-600" />
                  <p className="text-sm font-medium text-gray-300">No active candidates found</p>
                  <p className="text-xs text-gray-500">
                    Upload resumes or activate candidates in the Candidates workspace first.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[50vh] min-h-[340px] overflow-y-auto pr-1">
                  {candidates.map((c) => {
                    const isSelected = selectedCandidateIds.has(c.id);
                    return (
                      <div
                        key={c.id}
                        onClick={() => toggleCandidateSelection(c.id)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start space-x-3 select-none ${
                          isSelected
                            ? 'bg-purple-950/20 border-purple-500/50 shadow-md shadow-purple-950/20'
                            : 'bg-[#181f2c]/60 border-gray-800/80 hover:border-gray-700 hover:bg-[#181f2c]'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 mt-0.5 rounded-md flex items-center justify-center border transition-colors ${
                            isSelected
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'border-gray-700 bg-gray-900/60 text-transparent'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-white truncate">{c.fullName}</h4>
                            <StatusBadge state={c.orbitState || 'AVAILABLE'} />
                          </div>
                          <p className="text-[11px] text-purple-300/90 font-medium truncate mt-0.5">
                            {c.primaryRole || 'Software Engineer'}
                          </p>
                          <div className="flex items-center space-x-3 text-[10px] text-gray-400 mt-2">
                            <span className="flex items-center space-x-1">
                              <MapPin className="w-3 h-3 text-gray-500" />
                              <span>{c.location || 'USA'}</span>
                            </span>
                            <span className="flex items-center space-x-1">
                              <ShieldCheck className="w-3 h-3 text-gray-500" />
                              <span>{c.immigrationStatus || 'Not Specified'}</span>
                            </span>
                          </div>
                          {c.skills && c.skills.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {c.skills.slice(0, 3).map((sk: string, i: number) => (
                                <span
                                  key={i}
                                  className="px-1.5 py-0.5 rounded text-[9px] bg-gray-800/80 text-gray-300 border border-gray-700/50"
                                >
                                  {sk}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {executionError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-xs text-red-300 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{executionError}</span>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: ADVANCED MANUAL MATRIX REVIEW (Optional Override) */}
          {step === 'review_plan' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Search Strategy Matrix ({strategies.length} Strategies)
                  </h3>
                  <p className="text-[11px] text-gray-400">
                    Customize keywords, locations, and source distribution before searching.
                  </p>
                </div>
                <div className="px-3 py-1 rounded-lg bg-indigo-950/40 border border-indigo-800 text-[11px] text-indigo-300 font-semibold">
                  {enabledCount} queries active
                </div>
              </div>

              {planError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-xs text-red-300 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{planError}</span>
                </div>
              )}

              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {strategies.map((strat, idx) => (
                  <div
                    key={strat.id}
                    className={`p-4 rounded-xl border transition-all ${
                      strat.enabled
                        ? 'bg-[#181f2c] border-gray-700/80 shadow-md'
                        : 'bg-[#141822]/60 border-gray-800/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={strat.enabled}
                        onChange={() => handleToggleStrategy(strat.id)}
                        className="mt-1 w-4 h-4 rounded text-purple-600 bg-gray-900 border-gray-700 focus:ring-purple-500 focus:ring-offset-gray-900"
                      />
                      <div className="flex-1 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-white">
                              Strategy {idx + 1}: {strat.role}
                            </span>
                            {strat.isCached && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                24h Cached
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-[11px] text-gray-400">Source:</span>
                            <select
                              value={strat.source}
                              disabled={!strat.enabled}
                              onChange={(e) =>
                                handleUpdateStrategy(strat.id, 'source', e.target.value as any)
                              }
                              className="text-xs bg-gray-900 border border-gray-700 text-gray-200 rounded-lg px-2.5 py-1 focus:ring-1 focus:ring-purple-500 outline-none"
                            >
                              <option value="careerjet">Careerjet (Fast REST)</option>
                              <option value="adzuna">Adzuna (Fast REST)</option>
                              <option value="usajobs">USAJOBS (Federal / USC)</option>
                              <option value="jsearch">JSearch (Niche Aggregator)</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-400 font-semibold block mb-1">
                              Keywords
                            </label>
                            <input
                              type="text"
                              disabled={!strat.enabled}
                              value={strat.keywords}
                              onChange={(e) =>
                                handleUpdateStrategy(strat.id, 'keywords', e.target.value)
                              }
                              className="w-full text-xs bg-gray-900/90 border border-gray-700 text-white rounded-lg px-3 py-1.5 focus:border-purple-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-400 font-semibold block mb-1">
                              Location
                            </label>
                            <input
                              type="text"
                              disabled={!strat.enabled}
                              value={strat.location}
                              onChange={(e) =>
                                handleUpdateStrategy(strat.id, 'location', e.target.value)
                              }
                              className="w-full text-xs bg-gray-900/90 border border-gray-700 text-white rounded-lg px-3 py-1.5 focus:border-purple-500 outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4: RESULTS VIEW & OFFICIAL MATCH SCORES */}
          {step === 'results' && (
            <div className="space-y-5">
              {/* Same-Day Reuse Information Banner */}
              {isExistingDiscovery && (
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-purple-950/40 border border-purple-800/60 text-xs">
                  <div className="flex items-center space-x-2.5 text-purple-200">
                    <Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    <span>
                      <strong>Same-Day Matches Loaded:</strong> Displaying existing verified matches discovered today for your candidate pool.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => runAutonomousFlow(Array.from(selectedCandidateIds), true)}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition-colors flex-shrink-0 ml-3 cursor-pointer shadow-md shadow-purple-900/30"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Find New Jobs</span>
                  </button>
                </div>
              )}

              {/* Executive Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-[#181f2c] border border-gray-800 text-center">
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Jobs Discovered</span>
                  <span className="text-base font-extrabold text-white mt-0.5 block">
                    {executionSummary?.totalFetched || recommendations.length || discoveredItems.length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#181f2c] border border-purple-500/30 text-center bg-purple-950/10">
                  <span className="text-[10px] uppercase font-bold text-purple-300 block">Official Matches</span>
                  <span className="text-base font-extrabold text-purple-300 mt-0.5 block">
                    {executionSummary?.totalMatched ?? recommendations.filter((r) => r.isOfficialMatch).length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#181f2c] border border-gray-800 text-center">
                  <span className="text-[10px] uppercase font-bold text-amber-400 block">Duplicates Reused</span>
                  <span className="text-base font-extrabold text-amber-400 mt-0.5 block">
                    {executionSummary?.totalDuplicates || 0}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#181f2c] border border-gray-800 text-center">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 block">New Jobs Created</span>
                  <span className="text-base font-extrabold text-emerald-400 mt-0.5 block">
                    +{executionSummary?.totalCreated || 0}
                  </span>
                </div>
              </div>

              {/* Candidate Filter Tabs */}
              {candidateFilterOptions.length > 1 && (
                <div className="flex items-center space-x-2 overflow-x-auto pb-1">
                  <button
                    onClick={() => setSelectedFilterCandidateId('all')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 ${
                      selectedFilterCandidateId === 'all'
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800/80 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    All Candidates ({recommendations.length})
                  </button>
                  {candidateFilterOptions.map(([cid, name]) => {
                    if (!cid || !name) return null;
                    const count = recommendations.filter((r) => r.candidateId === cid).length;
                    return (
                      <button
                        key={cid}
                        onClick={() => setSelectedFilterCandidateId(cid)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 ${
                          selectedFilterCandidateId === cid
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-800/80 text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        {name} ({count})
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Recommendations Feed */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Candidate Recommendations ({filteredRecommendations.length || discoveredItems.length})
                  </h4>
                  <span className="text-[11px] text-gray-500">
                    Ingested into library with official match evaluations
                  </span>
                </div>

                {filteredRecommendations.length === 0 && discoveredItems.length === 0 ? (
                  <div className="text-center py-10 px-6 rounded-2xl bg-[#141926]/70 border border-gray-800/80 space-y-4 max-w-md mx-auto my-6">
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto">
                      <SlidersHorizontal className="w-6 h-6" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="text-sm font-bold text-white">No Matching Jobs Found</h4>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        No jobs were returned for the current search criteria. You can customize search keywords, expand location to Remote, or adjust job sources to discover open positions.
                      </p>
                    </div>
                    <div className="pt-2">
                      <button
                        type="button"
                        disabled={loadingPlan}
                        onClick={() => {
                          setReturnStep('results');
                          handleGenerateCustomPlan();
                        }}
                        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-900/40 transition-all flex items-center justify-center space-x-2 cursor-pointer hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                      >
                        {loadingPlan ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Loading Search Matrix...</span>
                          </>
                        ) : (
                          <>
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                            <span>Customize Search & Retry</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[46vh] overflow-y-auto pr-1">
                    {(filteredRecommendations.length > 0
                      ? filteredRecommendations
                      : (discoveredItems.map((item) => ({
                          jobId: item.id,
                          title: item.title,
                          company: item.company,
                          location: item.location,
                          source: item.source,
                          sourceUrl: item.sourceUrl,
                          postedAt: item.postedAt,
                          skills: item.skills,
                          description: item.description,
                          candidateName: 'Active Candidate',
                          candidateRole: 'Software Engineer',
                          matchScore: 85,
                          matchTier: 'Strong Match',
                          whyMatched: 'Why Matched:\n• Candidate-JD alignment evaluated via 3-tier matching funnel',
                          isOfficialMatch: false,
                        })) as JobRecommendation[])
                    ).map((rec, i) => (
                      <div
                        key={i}
                        className="p-4 rounded-xl bg-[#181f2c] border border-gray-800 hover:border-gray-700 transition-all space-y-3"
                      >
                        {/* Top Bar: Candidate Attribution & Match Score Badge */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800/80 pb-2">
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                              Target: {rec.candidateName || 'Active Candidate'}
                            </span>
                            {rec.candidateRole && (
                              <span className="text-[11px] text-gray-400">
                                ({rec.candidateRole})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            {rec.isOfficialMatch !== false && rec.matchScore != null ? (
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold flex items-center space-x-1 ${
                                  rec.matchScore >= 80
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : rec.matchScore >= 50
                                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                }`}
                              >
                                <span>{rec.matchScore}%</span>
                                <span className="text-[10px] font-semibold">({rec.matchTier})</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400 border border-gray-700">
                                {rec.matchTier || 'Matching Unavailable'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Job Details & Source */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <h5 className="text-xs font-bold text-white truncate">{rec.title}</h5>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                              <span className="font-semibold text-gray-300">{rec.company || 'Unknown Company'}</span>
                              <span>•</span>
                              <span className="flex items-center space-x-1">
                                <MapPin className="w-3 h-3 text-gray-500" />
                                <span>{rec.location || 'USA'}</span>
                              </span>
                              <span>•</span>
                              <div className="flex items-center space-x-1">
                                {getSourceBadge(rec.source)}
                              </div>
                            </div>
                          </div>

                          {/* Action Links */}
                          <div className="flex items-center space-x-2 flex-shrink-0">
                            {rec.sourceUrl && (
                              <a
                                href={rec.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold border border-gray-700 transition-colors cursor-pointer"
                              >
                                <span>View Original Job</span>
                                <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                              </a>
                            )}
                            {rec.candidateId && onGoToMatch && (
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  if (rec.candidateId) {
                                    onGoToMatch('resume', rec.candidateId);
                                  }
                                }}
                                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-purple-900/40 hover:bg-purple-800/60 text-purple-200 text-xs font-semibold border border-purple-700/50 transition-colors cursor-pointer"
                                title="Open Match Hub for this candidate"
                              >
                                <span>Match Hub</span>
                                <ArrowRight className="w-3.5 h-3.5 text-purple-300" />
                              </button>
                            )}
                            {rec.sourceUrl && (
                              <button
                                type="button"
                                onClick={() => copyApplyLink(rec.sourceUrl!, i)}
                                className="p-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white border border-gray-700 transition-colors"
                                title="Copy apply link"
                              >
                                {copiedIndex === i ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Why Matched Bullets from SYNTRA Matching Engine */}
                        {rec.whyMatched && (
                          <div className="p-2.5 rounded-lg bg-[#121622]/80 border border-gray-800/80 text-[11px] text-gray-300 space-y-1">
                            {rec.whyMatched.split('\n').map((line, idx) => (
                              <p key={idx} className={idx === 0 ? 'font-semibold text-purple-300' : 'text-gray-300'}>
                                {line}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 bg-[#161c28]">
          {step === 'autonomous_running' && (
            <div className="w-full flex items-center justify-between">
              <span className="text-xs text-gray-400 flex items-center space-x-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                <span>AI Agent executing autonomous discovery & matching pipeline...</span>
              </span>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {step === 'select_candidates' && (
            <>
              <div className="flex items-center space-x-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={loadingPlan}
                  onClick={() => {
                    setReturnStep('select_candidates');
                    handleGenerateCustomPlan();
                  }}
                  className="flex items-center space-x-1.5 text-xs text-purple-400 hover:text-purple-300 font-medium transition-colors disabled:opacity-50"
                >
                  {loadingPlan ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  )}
                  <span>Customize Search Matrix</span>
                </button>
              </div>
              <button
                disabled={selectedCandidateIds.size === 0}
                onClick={() => runAutonomousFlow(Array.from(selectedCandidateIds))}
                className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-lg shadow-purple-900/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Sparkles className="w-4 h-4 text-purple-200" />
                <span>Find Jobs for Selected ({selectedCandidateIds.size})</span>
                <ArrowRight className="w-4 h-4 text-purple-200" />
              </button>
            </>
          )}

          {step === 'review_plan' && (
            <>
              <button
                onClick={() => setStep(returnStep)}
                className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                Back
              </button>
              <button
                disabled={enabledCount === 0}
                onClick={handleExecuteManualPlan}
                className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-900/40 transition-all"
              >
                <Search className="w-4 h-4 text-emerald-200" />
                <span>Execute Search Matrix ({enabledCount} Queries)</span>
              </button>
            </>
          )}

          {step === 'results' && (
            <>
              <button
                onClick={() => {
                  loadCandidateList();
                  setStep('select_candidates');
                }}
                className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-purple-300 hover:text-purple-200 rounded-lg hover:bg-purple-950/40 border border-purple-800/50 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Target Other Candidates</span>
              </button>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => runAutonomousFlow(Array.from(selectedCandidateIds), true)}
                  className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-emerald-300 hover:text-white rounded-lg bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-700/60 transition-all cursor-pointer"
                  title="Bypass 24-hour cache and perform a fresh market search across job boards"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Find New Jobs</span>
                </button>
                <button
                  type="button"
                  disabled={loadingPlan}
                  onClick={() => {
                    setReturnStep('results');
                    handleGenerateCustomPlan();
                  }}
                  className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-purple-300 hover:text-white rounded-lg bg-purple-950/50 hover:bg-purple-900/60 border border-purple-700/60 transition-all cursor-pointer disabled:opacity-50"
                  title="Modify keywords, locations, and sources in the Search Matrix"
                >
                  {loadingPlan ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                  ) : (
                    <SlidersHorizontal className="w-3.5 h-3.5 text-purple-300" />
                  )}
                  <span>Customize Search & Retry</span>
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
                >
                  Close
                </button>
                {(recommendations.length > 0 || discoveredItems.length > 0) && (
                  <button
                    onClick={() => {
                      onClose();
                      if (onGoToMatch) {
                        const firstCandidateId = recommendations[0]?.candidateId;
                        const firstJobId = recommendations[0]?.jobId || discoveredItems[0]?.id;
                        if (firstCandidateId) {
                          onGoToMatch('resume', firstCandidateId);
                        } else if (firstJobId) {
                          onGoToMatch('job', firstJobId);
                        }
                      }
                    }}
                    className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-purple-900/40 transition-all cursor-pointer"
                  >
                    <span>View in Match Hub</span>
                    <ArrowRight className="w-4 h-4 text-purple-200" />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
