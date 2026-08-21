import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Filter,
  X,
  Briefcase,
  User,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  MapPin,
  Send,
  Ban,
  PauseCircle,
  ThumbsUp,
  FileText,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { JobRequirement, CandidateProfile } from '../types';
import { cleanJobTitle } from '../utils';
import { apiFetch } from '../services/api';

interface AIWorkspaceProps {
  jobs: JobRequirement[];
  candidates: CandidateProfile[];
  initialMatchMode?: 'job' | 'resume';
  initialSelectedJobId?: string | null;
  initialSelectedCandidateId?: string | null;
}

/** Prefer jobs that already have matches / finished AI — newest uploads often have 0 matches. */
function pickDefaultJob(
  jobsList: JobRequirement[],
  preferredId?: string | null
): JobRequirement | undefined {
  if (preferredId) {
    const found = jobsList.find((j) => j.id === preferredId);
    if (found) return found;
  }
  return (
    jobsList.find((j) => (j.matchCount ?? 0) > 0) ||
    jobsList.find((j) => j.processingStatus === 'processed') ||
    jobsList[0]
  );
}

export const AIWorkspace: React.FC<AIWorkspaceProps> = ({
  jobs,
  candidates,
  initialMatchMode = 'job',
  initialSelectedJobId,
  initialSelectedCandidateId
}) => {
  const [matchMode, setMatchMode] = useState<'job' | 'resume'>(initialMatchMode);
  const [localMatchThreshold, setLocalMatchThreshold] = useState<number>(50);

  // Active Job selection (Job Mode)
  const [selectedJob, setSelectedJob] = useState<JobRequirement | undefined>(() =>
    pickDefaultJob(jobs, initialSelectedJobId)
  );

  // Keep selectedJob in sync with job updates (e.g., threshold changes)
  useEffect(() => {
    if (selectedJob?.id) {
      const updatedJob = jobs.find((j) => j.id === selectedJob.id);
      if (updatedJob) {
        // Update selectedJob if any fields changed (including scoreThreshold)
        setSelectedJob(updatedJob);
        // Sync local match threshold to job's scoreThreshold or default 50
        setLocalMatchThreshold(updatedJob.scoreThreshold || 50);
      }
    }
  }, [jobs, selectedJob?.id]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(candidates[0]?.id || null);

  // Active Resume selection (Resume Mode)
  const [selectedResumeCandidate, setSelectedResumeCandidate] = useState<CandidateProfile | undefined>(() => {
    if (initialSelectedCandidateId) {
      const found = candidates.find((c) => c.id === initialSelectedCandidateId);
      if (found) return found;
    }
    return candidates[0] || undefined;
  });
  const [selectedJobIdForResume, setSelectedJobIdForResume] = useState<string | null>(jobs[0]?.id || null);

  // Dropdown / Combobox states
  const [isJobDropdownOpen, setIsJobDropdownOpen] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState('');

  const [isResumeDropdownOpen, setIsResumeDropdownOpen] = useState(false);
  const [resumeSearchQuery, setResumeSearchQuery] = useState('');

  const comboboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialMatchMode) {
      setMatchMode(initialMatchMode);
    }
    if (initialSelectedJobId) {
      const found = jobs.find((j) => j.id === initialSelectedJobId);
      if (found) {
        setSelectedJob(found);
        setLocalMatchThreshold(found.scoreThreshold || 50);
      }
    } else if (jobs.length > 0) {
      // If current selection is a stuck/empty upload but a sibling job has matches, switch.
      const current = selectedJob && jobs.find((j) => j.id === selectedJob.id);
      const currentEmpty =
        !current ||
        ((current.matchCount ?? 0) === 0 && current.processingStatus !== 'processed');
      if (!current || currentEmpty) {
        const better = pickDefaultJob(jobs, null);
        if (better && better.id !== current?.id) {
          setSelectedJob(better);
          setLocalMatchThreshold(better.scoreThreshold || 50);
        } else if (!current) {
          const better = pickDefaultJob(jobs, null);
          setSelectedJob(better);
          if (better) setLocalMatchThreshold(better.scoreThreshold || 50);
        }
      }
    }
    if (initialSelectedCandidateId) {
      const found = candidates.find((c) => c.id === initialSelectedCandidateId);
      if (found) setSelectedResumeCandidate(found);
    } else if (candidates.length > 0 && !selectedResumeCandidate) {
      setSelectedResumeCandidate(candidates[0]);
    }
  }, [initialMatchMode, initialSelectedJobId, initialSelectedCandidateId, jobs, candidates]);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(event.target as Node)) {
        setIsJobDropdownOpen(false);
        setIsResumeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [showFilters, setShowFilters] = useState(false);

  // Live matching states
  const [jobMatches, setJobMatches] = useState<any[]>([]);
  const [resumeMatches, setResumeMatches] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState<boolean>(false);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  // Fetch candidate matches for selectedJob (also refresh when entering job mode)
  useEffect(() => {
    if (matchMode !== 'job') {
      return;
    }

    if (!selectedJob) {
      setJobMatches([]);
      return;
    }

    let isMounted = true;
    const fetchMatches = async () => {
      setLoadingMatches(true);
      setMatchesError(null);
      try {
        const res = await apiFetch(`/jobs/${selectedJob.id}/matches`);
        if (!res.ok) {
          throw new Error("Failed to fetch matching candidates for this job description.");
        }
        const data = await res.json();
        if (isMounted) {
          setJobMatches(data.matches || []);
          // Automatically set active selectedCandidateId to the first matched candidate's ID, or null if none
          if (data.matches && data.matches.length > 0) {
            setSelectedCandidateId(data.matches[0].candidateId);
          } else {
            setSelectedCandidateId(null);
          }
        }
      } catch (err: any) {
        console.error(err);
        if (isMounted) {
          setMatchesError(err.message || "Failed to load matching candidates.");
        }
      } finally {
        if (isMounted) {
          setLoadingMatches(false);
        }
      }
    };

    fetchMatches();
    return () => {
      isMounted = false;
    };
  }, [selectedJob, matchMode]);

  // Fetch job matches for selectedResumeCandidate
  useEffect(() => {
    if (matchMode !== 'resume') {
      setResumeMatches([]);
      return;
    }

    if (!selectedResumeCandidate) {
      setResumeMatches([]);
      return;
    }

    let isMounted = true;
    const fetchMatches = async () => {
      setLoadingMatches(true);
      setMatchesError(null);
      try {
        const res = await apiFetch(`/candidates/${selectedResumeCandidate.id}/matches`);
        if (!res.ok) {
          throw new Error("Failed to fetch matching jobs for this candidate.");
        }
        const data = await res.json();
        if (isMounted) {
          setResumeMatches(data.matches || []);
          // Automatically set active selectedJobIdForResume to the first matched job's ID, or null if none
          if (data.matches && data.matches.length > 0) {
            setSelectedJobIdForResume(data.matches[0].jobId);
          } else {
            setSelectedJobIdForResume(null);
          }
        }
      } catch (err: any) {
        console.error(err);
        if (isMounted) {
          setMatchesError(err.message || "Failed to load matching jobs.");
        }
      } finally {
        if (isMounted) {
          setLoadingMatches(false);
        }
      }
    };

    fetchMatches();
    return () => {
      isMounted = false;
    };
  }, [selectedResumeCandidate, matchMode]);

  // Split Panel Divider Width state (default 50% left, 50% right)
  const [leftWidthPercent, setLeftWidthPercent] = useState<number>(50);
  const [isDragging, setIsDragging] = useState(false);

  // Accordion collapsed states for right panel
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  // Status feedback toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const toggleSection = (sectionKey: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Drag handler for panel divider
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const container = e.currentTarget as HTMLDivElement;
    const rect = container.getBoundingClientRect();
    const newLeftWidth = ((e.clientX - rect.left) / rect.width) * 100;
    if (newLeftWidth >= 30 && newLeftWidth <= 70) {
      setLeftWidthPercent(newLeftWidth);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Map job matches to CandidateProfile interface
  const mappedJobCandidates = jobMatches.map((m: any) => {
    const c = candidates.find((cand) => cand.id === m.candidateId);
    const hasScore = m.score != null && !Number.isNaN(Number(m.score));
    const rawScore = Number(m.score);
    const matchScore = hasScore
      ? (rawScore > 0 && rawScore < 1 ? Math.round(rawScore * 100) : Math.round(rawScore))
      : m.skillMatchScore != null
        ? Math.round(Number(m.skillMatchScore))
        : 0;
    const status = (m.matchStatus || "").toLowerCase();
    const pending =
      !hasScore &&
      (status === "requested" || status === "processing" || status === "waiting");
    const failed = !hasScore && status === "failed";

    return {
      id: m.candidateId,
      name: m.fullName || c?.name || "Unnamed Candidate",
      title: c?.title || "Candidate",
      location: c?.location || "N/A",
      experience: c?.experience || "N/A",
      expYears: c?.expYears || 0,
      visa: c?.visa || "N/A",
      matchedSkills: m.strengths && m.strengths.length > 0 ? m.strengths : (c?.matchedSkills || []),
      missingSkills: m.gaps && m.gaps.length > 0 ? m.gaps : (c?.missingSkills || []),
      matchScore,
      aiConfidence: m.confidenceScore != null ? Math.round(Number(m.confidenceScore)) : (m.skillMatchScore != null ? Math.round(Number(m.skillMatchScore)) : 0),
      badge: (pending
        ? 'Potential Match'
        : failed
          ? 'Potential Match'
          : m.tier === 'strong' || m.tier === 'highly_recommended' || m.tier === 'Highly Recommended'
            ? 'Highly Recommended'
            : m.tier === 'moderate' || m.tier === 'recommended' || m.tier === 'Recommended' || m.tier === 'Moderate Fit'
              ? 'Moderate Fit'
              : m.tier === 'weak'
                ? 'Potential Match'
                : 'Potential Match') as any,
      summary: pending
        ? "AI scoring in progress…"
        : failed
          ? "AI scoring failed — retry match or re-upload after fixing the AI provider."
          : (m.reasoning || c?.summary || "Match reasoning is processing."),
      breakdown: m.breakdown && typeof m.breakdown === "object"
        ? {
          skills: m.breakdown.skills ?? 0,
          experience: m.breakdown.experience ?? 0,
          location: m.breakdown.location ?? 0,
          visa: m.breakdown.visa ?? 0,
          education: m.breakdown.education ?? 0,
          availability: m.breakdown.availability ?? 0,
        }
        : (c?.breakdown || { skills: 0, experience: 0, location: 0, visa: 0, education: 0, availability: 0 }),
      resumeEvidence: m.greenFlags && m.greenFlags.length > 0 ? m.greenFlags : (c?.resumeEvidence || []),
      aiRecommendationReason: m.reasoning || c?.aiRecommendationReason || "Good fit based on matching indicators.",
      matchingHistory: c?.matchingHistory || [],
      fileName: c?.fileName || "resume.pdf",
      uploadedDate: c?.uploadedDate || new Date().toLocaleDateString()
    };
  });

  // Map resume matches to JobRequirement interface
  const mappedResumeJobs = resumeMatches.map((m: any) => {
    const j = jobs.find((job) => job.id === m.jobId);
    const hasScore = m.score != null && !Number.isNaN(Number(m.score));
    return {
      id: m.jobId,
      title: cleanJobTitle(m.jobTitle || j?.title || "Untitled Job"),
      company: j?.company || "",
      location: j?.location || "Remote",
      workMode: j?.workMode || 'Remote',
      experience: j?.experience || "3+ Years",
      visa: j?.visa || "Any",
      skills: m.strengths && m.strengths.length > 0 ? m.strengths : (j?.skills || []),
      matchCount: j?.matchCount || 0,
      avgMatchScore: hasScore
        ? Math.round(Number(m.score))
        : m.skillMatchScore != null
          ? Math.round(Number(m.skillMatchScore))
          : 0,
      responsibilities: j?.responsibilities || [],
      education: j?.education || "",
      description: j?.description || "",
      fileName: j?.fileName || "jd.pdf",
      roleTag: j?.roleTag || m.jobTitle || "N/A",
      uploadedDate: j?.uploadedDate || new Date().toLocaleDateString()
    };
  });

  // Filter out resume jobs with a zero average match score and sort descending
  const filteredResumeJobs = mappedResumeJobs
    .filter((j) => {
      // Exclude missing scores or exactly 0
      if (j.avgMatchScore === undefined || j.avgMatchScore === null) return false;
      if (j.avgMatchScore === 0) return false;
      return true;
    })
    .sort((a, b) => {
      const norm = (v: any) => {
        const num = Number(v);
        // Normalize fractions (<1) to percentage
        if (!Number.isNaN(num) && num > 0 && num < 1) return Math.round(num * 100);
        return Math.round(num);
      };
      return norm(b.avgMatchScore) - norm(a.avgMatchScore);
    });

  // Show all shortlisted candidates (excluding zero scores)
  const filteredCandidates = mappedJobCandidates
    .filter((c) => {
      // Exclude candidates with missing scores or exactly 0
      if (c.matchScore === undefined || c.matchScore === null) return false;
      if (c.matchScore === 0) return false;
      return c.matchScore >= localMatchThreshold;
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  // Candidates for active job in Job Mode
  const activeCandidate = filteredCandidates.find((c) => c.id === selectedCandidateId) || filteredCandidates[0] || undefined;

  // Jobs for active candidate in Resume Mode
  const activeJobForResume = filteredResumeJobs.find((j) => j.id === selectedJobIdForResume) || filteredResumeJobs[0] || undefined;

  // Jobs list shown in left panel for Resume Mode
  const filteredJobs = filteredResumeJobs;

  // Filtered jobs for combobox search
  const searchedJobs = jobs.filter(
    (j) =>
      j.title.toLowerCase().includes(jobSearchQuery.toLowerCase()) ||
      j.company.toLowerCase().includes(jobSearchQuery.toLowerCase()) ||
      j.id.toLowerCase().includes(jobSearchQuery.toLowerCase()) ||
      (j.location && j.location.toLowerCase().includes(jobSearchQuery.toLowerCase()))
  );

  // Filtered candidates for combobox search
  const searchedCandidates = candidates.filter(
    (c) =>
      c.name.toLowerCase().includes(resumeSearchQuery.toLowerCase()) ||
      c.title.toLowerCase().includes(resumeSearchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(resumeSearchQuery.toLowerCase()) ||
      (c.fileName && c.fileName.toLowerCase().includes(resumeSearchQuery.toLowerCase()))
  );

  return (
    <div
      className="p-6 space-y-6 max-w-[1600px] mx-auto select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-8 z-50 bg-purple-600 text-white px-5 py-3 rounded-xl shadow-2xl border border-purple-400 font-medium text-sm flex items-center gap-2 animate-bounce">
          <Sparkles className="w-4 h-4 text-purple-200" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Section: Segmented Mode Selector */}
      <div className="flex justify-center">
        <div className="bg-[#161123] p-1.5 rounded-2xl border border-purple-500/20 flex items-center w-full max-w-sm">
          <button
            onClick={() => {
              setMatchMode('job');
              setIsJobDropdownOpen(false);
              setIsResumeDropdownOpen(false);
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${matchMode === 'job'
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50'
                : 'text-slate-400 hover:text-slate-200'
              }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Match by Job</span>
          </button>
          <button
            onClick={() => {
              setMatchMode('resume');
              setIsJobDropdownOpen(false);
              setIsResumeDropdownOpen(false);
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${matchMode === 'resume'
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50'
                : 'text-slate-400 hover:text-slate-200'
              }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Match by Resume</span>
          </button>
        </div>
      </div>

      {/* Search Bar & Combobox Controls */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full" ref={comboboxRef}>
          <Search className="w-4 h-4 absolute left-4 top-3.5 text-slate-400 z-10" />

          {matchMode === 'job' ? (
            /* COMBOBOX FOR JOB MODE */
            <div className="relative w-full">
              <input
                type="text"
                value={isJobDropdownOpen ? jobSearchQuery : selectedJob ? `${cleanJobTitle(selectedJob.title)} — ${selectedJob.company}` : ''}
                onFocus={() => {
                  setIsJobDropdownOpen(true);
                  setJobSearchQuery('');
                }}
                onChange={(e) => {
                  setJobSearchQuery(e.target.value);
                  setIsJobDropdownOpen(true);
                }}
                placeholder="Search or select a job..."
                className="w-full pl-11 pr-20 py-3 rounded-xl glass-input text-sm text-slate-100 placeholder-slate-500 focus:border-purple-500 transition"
              />

              <div className="absolute right-3 top-2.5 flex items-center gap-1 z-10">
                {(isJobDropdownOpen || jobSearchQuery) && (
                  <button
                    onClick={() => {
                      setJobSearchQuery('');
                      setIsJobDropdownOpen(true);
                    }}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setIsJobDropdownOpen(!isJobDropdownOpen)}
                  className="p-1 text-slate-400 hover:text-purple-300 cursor-pointer"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${isJobDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {/* Job Dropdown Menu */}
              {isJobDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-[#161123] border border-purple-500/40 rounded-xl shadow-2xl overflow-y-auto max-h-72 z-50 divide-y divide-white/5">
                  {searchedJobs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      No jobs matching "{jobSearchQuery}"
                    </div>
                  ) : (
                    searchedJobs.map((j) => (
                      <div
                        key={j.id}
                        onClick={() => {
                          setSelectedJob(j);
                          setLocalMatchThreshold(j.scoreThreshold || 50);
                          setSelectedCandidateId(candidates[0]?.id || null);
                          setIsJobDropdownOpen(false);
                          setJobSearchQuery('');
                        }}
                        className={`p-3.5 hover:bg-purple-600/20 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition ${selectedJob?.id === j.id ? 'bg-purple-600/30' : ''
                          }`}
                      >
                        <div>
                          <div className="text-sm font-bold text-white">{cleanJobTitle(j.title)}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {j.company} {j.location ? `— ${j.location}` : ''}
                            {' · '}
                            {(j.matchCount ?? 0) > 0
                              ? `${j.matchCount} matches`
                              : j.processingStatus === 'processed'
                                ? 'processed'
                                : j.processingStatus || 'uploaded'}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            /* COMBOBOX FOR RESUME MODE */
            <div className="relative w-full">
              <input
                type="text"
                value={
                  isResumeDropdownOpen
                    ? resumeSearchQuery
                    : selectedResumeCandidate ? `${selectedResumeCandidate.name} — ${selectedResumeCandidate.title}` : ''
                }
                onFocus={() => {
                  setIsResumeDropdownOpen(true);
                  setResumeSearchQuery('');
                }}
                onChange={(e) => {
                  setResumeSearchQuery(e.target.value);
                  setIsResumeDropdownOpen(true);
                }}
                placeholder="Search or select a candidate..."
                className="w-full pl-11 pr-20 py-3 rounded-xl glass-input text-sm text-slate-100 placeholder-slate-500 focus:border-purple-500 transition"
              />

              <div className="absolute right-3 top-2.5 flex items-center gap-1 z-10">
                {(isResumeDropdownOpen || resumeSearchQuery) && (
                  <button
                    onClick={() => {
                      setResumeSearchQuery('');
                      setIsResumeDropdownOpen(true);
                    }}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setIsResumeDropdownOpen(!isResumeDropdownOpen)}
                  className="p-1 text-slate-400 hover:text-purple-300 cursor-pointer"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${isResumeDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {/* Resume Dropdown Menu */}
              {isResumeDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-[#161123] border border-purple-500/40 rounded-xl shadow-2xl overflow-y-auto max-h-72 z-50 divide-y divide-white/5">
                  {searchedCandidates.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      No candidates matching "{resumeSearchQuery}"
                    </div>
                  ) : (
                    searchedCandidates.map((c) => {
                      const fileName =
                        c.fileName || `${c.name.toLowerCase().replace(/\s+/g, '_')}_resume.pdf`;
                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            setSelectedResumeCandidate(c);
                            setSelectedJobIdForResume(jobs[0]?.id || null);
                            setIsResumeDropdownOpen(false);
                            setResumeSearchQuery('');
                          }}
                          className={`p-3.5 hover:bg-purple-600/20 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition ${selectedResumeCandidate?.id === c.id ? 'bg-purple-600/30' : ''
                            }`}
                        >
                          <div>
                            <div className="text-sm font-bold text-white flex items-center gap-2">
                              <span>{c.name}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                                {c.badge}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">{c.title}</div>
                          </div>
                          <div className="text-xs font-mono text-slate-400 flex items-center gap-1.5 shrink-0">
                            <FileText className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                            <span>{fileName}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {matchMode === 'job' && (
            <div className="flex flex-col gap-1 w-32 shrink-0">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Threshold</span>
                <span className="text-[10px] font-bold text-purple-400">{localMatchThreshold}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={localMatchThreshold}
                onChange={(e) => setLocalMatchThreshold(Number(e.target.value))}
                className="w-full accent-purple-500 cursor-pointer h-1.5 bg-purple-950 rounded-full appearance-none outline-none"
              />
            </div>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-3 rounded-xl border flex items-center gap-2 text-xs font-semibold transition cursor-pointer shrink-0 ${showFilters
                ? 'bg-purple-600/30 border-purple-500 text-purple-200'
                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
              }`}
          >
            <Filter className="w-3.5 h-3.5 text-purple-400" />
            <span>Filters</span>
          </button>
        </div>
      </div>

      {/* Selected Job / Resume Summary Header Banner */}
      {matchMode === 'job' ? (
        selectedJob ? (
          <div className="glass-card p-4 rounded-xl border border-purple-500/30 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedJob(pickDefaultJob(jobs, null))}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-slate-300 flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </button>
              <div>
                <span className="font-bold text-slate-100 text-base">{cleanJobTitle(selectedJob.title)}</span>
                <span className="text-slate-400 text-xs ml-2">{selectedJob.company}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="px-3 py-1 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 font-semibold">
                {filteredCandidates.length} Matched • Avg {filteredCandidates.length > 0 ? Math.round(filteredCandidates.reduce((acc, c) => acc + c.matchScore, 0) / filteredCandidates.length) : 0}%
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {selectedJob.workMode}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-white/5 text-slate-300 border border-white/10">
                {selectedJob.location}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20">
                {selectedJob.experience}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20">
                {selectedJob.visa}
              </span>
              {selectedJob.skills.slice(0, 4).map((s: string) => (
                <span key={s} className="px-2 py-1 rounded bg-white/5 text-slate-300 text-[11px]">
                  {s}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="glass-card p-6 rounded-xl border border-[#261e38] text-center text-xs text-slate-400">
            No Job Description selected. Please upload or select a JD.
          </div>
        )
      ) : (
        selectedResumeCandidate ? (
          <div className="glass-card p-4 rounded-xl border border-purple-500/30 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedResumeCandidate(candidates[0])}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-slate-300 flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </button>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-teal-500/20 border border-teal-400/30 flex items-center justify-center text-xs font-bold text-teal-300">
                  {selectedResumeCandidate.name.split(' ').map((n: string) => n[0]).join('')}
                </div>
                <span className="font-bold text-slate-100 text-base">{selectedResumeCandidate.name}</span>
                <span className="text-slate-400 text-xs">{selectedResumeCandidate.title}</span>
                <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[11px]">
                  {selectedResumeCandidate.badge}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="px-3 py-1 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 font-semibold">
                {filteredJobs.length} Matched Jobs • Avg {filteredJobs.length > 0 ? Math.round(filteredJobs.reduce((acc, j) => acc + j.avgMatchScore, 0) / filteredJobs.length) : 0}%
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-white/5 text-slate-300 border border-white/10">
                {selectedResumeCandidate.location}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20">
                {selectedResumeCandidate.experience} exp
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20">
                {selectedResumeCandidate.visa}
              </span>
              {selectedResumeCandidate.matchedSkills.slice(0, 4).map((s: string) => (
                <span key={s} className="px-2 py-1 rounded bg-white/5 text-slate-300 text-[11px]">
                  {s}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="glass-card p-6 rounded-xl border border-[#261e38] text-center text-xs text-slate-400">
            No Candidate Resume selected. Please upload or select a candidate.
          </div>
        )
      )}

      {matchesError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{matchesError}</span>
        </div>
      )}

      {/* Main Two-Panel Layout */}
      <div className="flex flex-col lg:flex-row gap-0 rounded-2xl overflow-hidden min-h-[650px] border border-[#261e38] bg-[#0c0916]">
        {/* LEFT PANEL */}
        <div
          style={{ width: `${leftWidthPercent}%` }}
          className="p-5 border-r border-[#261e38] overflow-y-auto space-y-4 max-h-[750px] w-full shrink-0"
        >
          <div className="flex items-center justify-between pb-2 border-b border-white/5">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {matchMode === 'job'
                ? `AI RANKED — ${filteredCandidates.length} CANDIDATES`
                : `AI MATCHED — ${filteredJobs.length} JOBS`}
            </span>
            <span className="text-xs text-slate-500">Sorted by match score</span>
          </div>

          {/* JOB MODE LEFT PANEL: CANDIDATES LIST */}
          {matchMode === 'job' && (
            <div className="space-y-3.5">
              {loadingMatches ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-3">
                  <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                  <span className="text-xs text-slate-400">Fetching matching scores...</span>
                </div>
              ) : filteredCandidates.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 space-y-2 px-4">
                  {selectedJob?.processingStatus === 'uploaded' ? (
                    <>
                      <p>This job is still processing (no AI summary yet).</p>
                      <p className="text-slate-500">
                        Pick a processed JD from the dropdown — duplicate titles may include older uploads with matches.
                      </p>
                    </>
                  ) : (
                    <p>No relevant candidates found for this job.</p>
                  )}
                </div>
              ) : (
                filteredCandidates.map((cand) => {
                  const isSelected = selectedCandidateId === cand.id;
                  return (
                    <div
                      key={cand.id}
                      onClick={() => setSelectedCandidateId(cand.id)}
                      className={`p-5 rounded-2xl transition-all cursor-pointer relative ${isSelected ? 'bg-purple-950/20 border border-purple-500/40' : 'bg-white/5 border border-white/10 hover:border-purple-500/20'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          {/* Match Percentage Circle Badge */}
                          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex flex-col items-center justify-center shrink-0">
                            <span className="text-base font-extrabold leading-none">{cand.matchScore}</span>
                            <span className="text-[9px] font-bold uppercase opacity-80">%</span>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="text-base font-bold text-white">{cand.name}</h4>
                            </div>
                            <p className="text-xs text-slate-400 font-medium">{cand.title}</p>

                            <div className="flex items-center gap-3 text-xs text-slate-400 pt-1 flex-wrap">
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-slate-500" />
                                {cand.location}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-500" />
                                {cand.experience}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-white/5 text-[11px] text-slate-300">
                                {cand.visa}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Recommendation Badge */}
                        <span
                          className={`px-3 py-1 rounded-lg text-xs font-semibold shrink-0 ${cand.badge === 'Highly Recommended'
                              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                              : 'bg-purple-500/10 border border-purple-500/30 text-purple-300'
                            }`}
                        >
                          {cand.badge}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 pt-3">
                        <a
                          href="mailto:candidate@example.com"
                          className="px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[11px] font-bold transition flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Mail
                        </a>
                        <a
                          href="tel:+1234567890"
                          className="px-3 py-1.5 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30 text-[11px] font-bold transition flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Call
                        </a>
                      </div>

                      {/* Skill Tags */}
                      <div className="flex flex-wrap items-center gap-2 pt-4">
                        {cand.matchedSkills.map((skill: string) => (
                          <span
                            key={skill}
                            className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-medium"
                          >
                            {skill}
                          </span>
                        ))}

                        {cand.missingSkills.map((mSkill: string) => (
                          <span
                            key={mSkill}
                            className="px-2.5 py-1 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-medium"
                          >
                            -1 missing ({mSkill})
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* RESUME MODE LEFT PANEL: JOBS LIST */}
          {matchMode === 'resume' && (
            <div className="space-y-3.5">
              {loadingMatches ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-3">
                  <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                  <span className="text-xs text-slate-400">Fetching matching scores...</span>
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No matched jobs found.
                </div>
              ) : (
                filteredJobs.map((job) => {
                  const isSelected = selectedJobIdForResume === job.id;
                  return (
                    <div
                      key={job.id}
                      onClick={() => setSelectedJobIdForResume(job.id)}
                      className={`p-5 rounded-2xl transition-all cursor-pointer relative ${isSelected ? 'bg-purple-950/20 border border-purple-500/40' : 'bg-white/5 border border-white/10 hover:border-purple-500/20'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex flex-col items-center justify-center shrink-0">
                            <span className="text-base font-extrabold leading-none">{job.avgMatchScore}</span>
                            <span className="text-[9px] font-bold uppercase opacity-80">%</span>
                          </div>

                          <div className="space-y-1">
                            <h4 className="text-base font-bold text-white">{job.title}</h4>
                            <p className="text-xs text-slate-400 font-medium">{job.company}</p>

                            <div className="flex items-center gap-3 text-xs text-slate-400 pt-1 flex-wrap">
                              <span>{job.location}</span>
                              <span>• {job.experience}</span>
                              <span className="px-1.5 py-0.5 rounded bg-white/5 text-[11px] text-slate-300">
                                {job.visa}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-4">
                        {job.skills.slice(0, 4).map((s: string) => (
                          <span
                            key={s}
                            className="px-2.5 py-1 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-medium"
                          >
                            {s}
                          </span>
                        ))}
                        {job.skills.length > 4 && (
                          <span className="px-2 py-1 rounded-md bg-white/5 text-slate-400 text-xs">
                            +{job.skills.length - 4} more
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* DRAGGABLE DIVIDER HANDLE */}
        <div
          onMouseDown={handleMouseDown}
          className="w-2 bg-[#261e38] hover:bg-purple-500/50 cursor-col-resize transition flex items-center justify-center shrink-0"
          title="Drag to resize panels"
        >
          <div className="w-1 h-8 rounded-full bg-purple-500/30" />
        </div>

        {/* RIGHT PANEL - INDEPENDENT SCROLLING */}
        <div className="flex-1 p-6 overflow-y-auto max-h-[750px] space-y-6 bg-[#0e0a1b]/60">
          {/* JOB MODE RIGHT PANEL: CANDIDATE INTELLIGENCE */}
          {matchMode === 'job' && (
            activeCandidate ? (
              <div className="space-y-6">
                {/* Header */}
                <div className="glass-card p-6 rounded-2xl border border-purple-500/30 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center text-base font-extrabold text-white shadow-lg shadow-teal-900/40">
                        {activeCandidate.name.split(' ').map((n: string) => n[0]).join('')}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-bold text-white">{activeCandidate.name}</h3>
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-extrabold">
                            {activeCandidate.matchScore}%
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{activeCandidate.title}</p>
                      </div>
                    </div>

                    <span className="px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
                      {activeCandidate.badge}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 pt-2 border-t border-white/5 text-xs text-slate-300 flex-wrap">
                    <span>📍 {activeCandidate.location}</span>
                    <span>⏱️ {activeCandidate.experience}</span>
                    <span>🛡️ {activeCandidate.visa}</span>
                  </div>
                </div>

                {/* AI MATCH SUMMARY */}
                <div className="glass-card p-5 rounded-2xl space-y-3">
                  <button
                    onClick={() => toggleSection('summary')}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      AI Match Summary
                    </span>
                    {collapsedSections['summary'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>

                  {!collapsedSections['summary'] && (
                    <p className="text-xs text-slate-300 leading-relaxed pt-1 font-normal">
                      {activeCandidate.summary}
                    </p>
                  )}
                </div>

                {/* SKILLS ALIGNMENT */}
                <div className="glass-card p-5 rounded-2xl space-y-4">
                  <button
                    onClick={() => toggleSection('skills')}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider cursor-pointer"
                  >
                    <span>Skills Alignment</span>
                    {collapsedSections['skills'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>

                  {!collapsedSections['skills'] && (
                    <div className="space-y-3">
                      <div>
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                          MATCHED
                        </span>
                        <div className="flex flex-wrap gap-2 pt-1.5">
                          {activeCandidate.matchedSkills.map((s: string) => (
                            <span
                              key={s}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">
                          MISSING
                        </span>
                        <div className="flex flex-wrap gap-2 pt-1.5">
                          {activeCandidate.missingSkills.map((s: string) => (
                            <span
                              key={s}
                              className="px-2.5 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-medium flex items-center gap-1"
                            >
                              <XCircle className="w-3 h-3 text-red-400" />
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* MATCH BREAKDOWN */}
                <div className="glass-card p-5 rounded-2xl space-y-4">
                  <button
                    onClick={() => toggleSection('breakdown')}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider cursor-pointer"
                  >
                    <span>Match Breakdown</span>
                    {collapsedSections['breakdown'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>

                  {!collapsedSections['breakdown'] && (
                    <div className="space-y-3 pt-1">
                      {Object.entries(activeCandidate.breakdown).map(([key, value]) => (
                        <div key={key} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="capitalize text-slate-400">{key}</span>
                            <span className="font-mono text-purple-300 font-semibold">{value}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-purple-600 to-teal-400 rounded-full"
                              style={{ width: `${value}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* RESUME EVIDENCE */}
                <div className="glass-card p-5 rounded-2xl space-y-3">
                  <button
                    onClick={() => toggleSection('evidence')}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider cursor-pointer"
                  >
                    <span>Resume Evidence</span>
                    {collapsedSections['evidence'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>

                  {!collapsedSections['evidence'] && (
                    <ul className="space-y-2 pt-1 text-xs text-slate-300 italic">
                      {activeCandidate.resumeEvidence.map((ev: any, i: number) => (
                        <li key={i} className="pl-3 border-l-2 border-purple-500/40 py-0.5 leading-relaxed font-normal">
                          "{ev}"
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* AI RECOMMENDATION */}
                <div className="glass-card p-5 rounded-2xl space-y-2 border border-purple-500/30 bg-purple-950/20">
                  <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                    AI Recommendation
                  </span>
                  <p className="text-xs text-slate-200 leading-relaxed font-normal">
                    {activeCandidate.aiRecommendationReason}
                  </p>
                </div>

                {/* CANDIDATE MATCHING HISTORY */}
                <div className="glass-card p-5 rounded-2xl space-y-3">
                  <button
                    onClick={() => toggleSection('history')}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-300 uppercase tracking-wider cursor-pointer"
                  >
                    <span>Candidate Matching History</span>
                    {collapsedSections['history'] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>

                  {!collapsedSections['history'] && (
                    <div className="space-y-3 pt-2">
                      {activeCandidate.matchingHistory.length === 0 ? (
                        <div className="text-slate-500 text-xs italic">No matching history found.</div>
                      ) : (
                        activeCandidate.matchingHistory.map((hist, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between text-xs"
                          >
                            <div>
                              <div className="font-semibold text-slate-100">{hist.jobTitle}</div>
                              <div className="text-slate-400 text-[11px] font-normal">{hist.company} • {hist.date}</div>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold font-mono">
                                {hist.score}%
                              </span>
                              <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-medium text-[11px]">
                                {hist.status}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* RECRUITER ACTIONS */}
                <div className="p-5 rounded-2xl glass-card border border-purple-500/40 space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    RECRUITER ACTIONS
                  </span>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <button
                      onClick={() => showToast(`${activeCandidate.name} rejected.`)}
                      className="py-2.5 px-3 rounded-xl border border-red-500/30 hover:bg-red-500/10 text-red-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" /> Reject
                    </button>

                    <button
                      onClick={() => showToast(`${activeCandidate.name} placed on Hold.`)}
                      className="py-2.5 px-3 rounded-xl border border-amber-500/30 hover:bg-amber-500/10 text-amber-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <PauseCircle className="w-3.5 h-3.5" /> Hold
                    </button>

                    <button
                      onClick={() => showToast(`${activeCandidate.name} Shortlisted!`)}
                      className="py-2.5 px-3 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" /> Shortlist
                    </button>

                    <button
                      onClick={() => showToast(`${activeCandidate.name} Submitted to Client!`)}
                      className="py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-purple-900/40 transition cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" /> Submit
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-24 text-center text-xs text-slate-400">
                Select a candidate to view AI intelligence details.
              </div>
            )
          )}

          {/* RESUME MODE RIGHT PANEL: JOB INTELLIGENCE */}
          {matchMode === 'resume' && (
            activeJobForResume ? (
              <div className="space-y-6">
                {/* Header */}
                <div className="glass-card p-6 rounded-2xl border border-purple-500/30 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
                        <Briefcase className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white">{activeJobForResume.title}</h3>
                        <p className="text-xs text-slate-400">{activeJobForResume.company}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs text-slate-300 flex-wrap gap-2">
                    <span>📍 {activeJobForResume.location}</span>
                    <span>⏱️ {activeJobForResume.experience}</span>
                    <span>🛡️ {activeJobForResume.visa}</span>
                    <span>🏢 {activeJobForResume.workMode}</span>
                  </div>

                  <div className="p-4 rounded-xl bg-purple-950/30 border border-purple-500/30 flex items-center justify-between">
                    <div>
                      <div className="text-3xl font-extrabold text-emerald-400">{activeJobForResume.avgMatchScore || 85}%</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        MATCH SCORE
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-purple-300">{activeJobForResume.matchCount}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        TOTAL MATCHES
                      </div>
                    </div>
                  </div>
                </div>

                {/* REQUIRED SKILLS */}
                <div className="glass-card p-5 rounded-2xl space-y-3">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Required Skills
                  </span>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {activeJobForResume.skills.map((s: string) => (
                      <span
                        key={s}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        {s}
                      </span>
                    ))}
                  </div>
                </div>

                {/* RESPONSIBILITIES */}
                <div className="glass-card p-5 rounded-2xl space-y-3">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Responsibilities
                  </span>
                  <ul className="space-y-2 pt-1 text-xs text-slate-300 list-disc list-inside leading-relaxed font-normal">
                    {activeJobForResume.responsibilities && activeJobForResume.responsibilities.length > 0 ? (
                      activeJobForResume.responsibilities.map((resp: string, i: number) => (
                        <li key={i}>{resp}</li>
                      ))
                    ) : (
                      <>
                        <li>Architect resilient backend systems using microservices.</li>
                        <li>Deploy, scale and manage containerized services on cloud.</li>
                        <li>Collaborate with product developers to build client-side features.</li>
                      </>
                    )}
                  </ul>
                </div>

                {/* AI EXPLANATION */}
                <div className="glass-card p-5 rounded-2xl space-y-2 border border-purple-500/30 bg-purple-950/20">
                  <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                    AI Fit Explanation
                  </span>
                  <p className="text-xs text-slate-200 leading-relaxed font-normal">
                    Candidate resume strongly aligns with this job requirement due to matching skills, location, work-mode preference, and experience criteria.
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-24 text-center text-xs text-slate-400">
                Select a job description to view job intelligence details.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};
