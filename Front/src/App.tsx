import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { UploadAnalyze } from './components/UploadAnalyze';
import { DataStore } from './components/DataStore';
import { AIWorkspace } from './components/AIWorkspace';
import { RelayWorkspace } from './components/relay/RelayWorkspace';
import { AuthScreen } from './components/Auth/AuthScreen';
import { VendorWorkspace } from './components/vendor/VendorWorkspace';
import { SubmissionRTR } from './plugins/prism/SubmissionRTR';
import { SettingsWorkspace } from './components/settings/SettingsWorkspace';
import { useAuth } from './context/AuthContext';
import { apiFetchWithRetry } from './services/api';
import { NavigationScreen, NavigationContext, JobRequirement, CandidateProfile } from './types';
import { cleanFileName, cleanJobTitle, calculateSeniority } from './utils';

const screenFromUrl = (): NavigationScreen => {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = (window.location.hash ? window.location.hash.replace(/^#\/?/, '') : window.location.pathname.replace(/^\//, '')).toLowerCase().trim();
  if (['dashboard', 'upload', 'matching', 'inbox', 'jobs', 'resumes', 'vendors', 'prism', 'settings'].includes(raw)) {
    return raw as NavigationScreen;
  }
  if (raw === 'candidates') return 'resumes';
  if (raw === 'submissions' || raw === 'submission-rtr') return 'prism';
  if (raw === 'ai-workspace') return 'matching';
  return 'dashboard';
};

export default function App() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [activeScreen, setActiveScreen] = useState<NavigationScreen>(screenFromUrl);
  const [matchMode, setMatchMode] = useState<'job' | 'resume'>('job');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<'jd' | 'resume'>('jd');
  const [navigationContext, setNavigationContext] = useState<NavigationContext | null>(null);

  // Synchronize browser history (Back / Forward button support)
  useEffect(() => {
    const handlePopState = () => {
      setActiveScreen(screenFromUrl());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = useCallback((screen: NavigationScreen, context?: NavigationContext | null) => {
    if (screen === 'matching') {
      setMatchMode('job');
      setSelectedJobId(null);
      setSelectedCandidateId(null);
    }
    if (screen === 'upload') {
      setUploadType('jd');
    }
    setNavigationContext(screen === 'prism' ? (context || null) : null);
    setActiveScreen(screen);
    const targetPath = screen === 'dashboard' ? '/' : `/${screen}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  }, []);

  // Update job's scoreThreshold when the DataStore slider changes
  const handleThresholdChange = (jobId: string, newThreshold: number) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, scoreThreshold: newThreshold } : j))
    );
  };

  // Live backend data states
  const [jobs, setJobs] = useState<JobRequirement[]>([]);
  const [candidates, setCandidates] = useState<CandidateProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBackendData = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const jobsRes = await apiFetchWithRetry('/jobs');
      const candRes = await apiFetchWithRetry('/candidates?limit=100');

      if (!jobsRes.ok || !candRes.ok) {
        let detail = '';
        if (!jobsRes.ok) detail += ` jobs=${jobsRes.status}`;
        if (!candRes.ok) detail += ` candidates=${candRes.status}`;
        throw new Error(
          detail.includes('500') || detail.includes('503')
            ? 'Database connection pool is full. Use npm run dev + npm run dev:orch-admin only (not dev:worker separately), wait 10s, then refresh.'
            : `Failed to load data records from the backend API.${detail}`,
        );
      }

      const jobsData = await jobsRes.json();
      const candData = await candRes.json();

      const rawJobs = jobsData.jobs || [];
      const rawCandidates = candData.candidates || [];

      const mappedJobs: JobRequirement[] = [];
      const mappedCandidates: CandidateProfile[] = [];

      const dateMap: Record<string, Date> = {};
      rawJobs.forEach((j: any) => {
        if (j.id && j.uploadedAt) dateMap[j.id] = new Date(j.uploadedAt);
      });
      rawCandidates.forEach((c: any) => {
        if (c.id && c.createdAt) dateMap[c.id] = new Date(c.createdAt);
      });

      const getPoolStatus = (dateString?: string): 'Active' | 'Passive' => {
        if (!dateString) return 'Active';
        const candidateDate = new Date(dateString).getTime();
        if (isNaN(candidateDate)) return 'Active';
        const currentDate = Date.now();
        const daysInPool = (currentDate - candidateDate) / (1000 * 60 * 60 * 24);
        return daysInPool < 15 ? 'Active' : 'Passive';
      };

      // Process raw jobs from jobs endpoint
      rawJobs.forEach((j: any) => {
        const jobRole = cleanJobTitle(j.title || "Untitled Job");
        const roleTag = j.primaryRole && j.primaryRole !== 'other' ? j.primaryRole : jobRole;
        const seniority = calculateSeniority(jobRole, j.experience);
        mappedJobs.push({
          id: j.id,
          title: jobRole,
          company: j.companyName || j.company || j.company_name || "",
          location: j.location || "Remote",
          workMode: (j.remotePolicy || j.workMode || 'Remote') as 'Remote' | 'Hybrid' | 'Onsite',
          experience: j.experience || (j.minExperience ? `${j.minExperience}+ Years` : "3+ Years"),
          seniority: seniority,
          visa: j.visaRequirement || j.visa || "Any",
          skills: j.requiredSkills || [],
          matchCount: j.matchCount || 0,
          avgMatchScore: 85,
          processingStatus: j.processingStatus,
          description: j.summary || j.jdSummary || "",
          fileName: cleanFileName(j.originalFileName || `${(jobRole).toLowerCase().replace(/\s+/g, '_')}_jd.pdf`),
          roleTag: roleTag,
          uploadedDate: j.uploadedAt ? new Date(j.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Jul 20, 2026",
          matchScores: j.matchScores || [],
          scoreThreshold: j.scoreThreshold ?? 50,
          sourceName: j.sourceName || (j.sourceEmail ? "email" : "manual"),
          sourceUrl: j.sourceUrl || null,
          sourceEmail: j.sourceEmail || null,
          messageId: j.messageId || null,
          employmentType: j.employmentType || null,
          visaRequirement: j.visaRequirement || null,
          remotePolicy: j.remotePolicy || null,
          minExperience: j.minExperience ?? null,
          maxExperience: j.maxExperience ?? null,
        });
      });

      // Process raw candidates from candidates endpoint
      rawCandidates.forEach((c: any) => {
        const candidateName = c.fullName || "Unnamed Candidate";
        const candidateTitle = (c.currentRole && c.currentRole !== 'other')
          ? c.currentRole
          : (c.primaryRole && c.primaryRole !== 'other')
            ? c.primaryRole
            : "Software Professional";
        const experienceVal = c.totalExperience && c.totalExperience !== 'N/A' ? c.totalExperience : "Not specified";

        mappedCandidates.push({
          id: c.id,
          name: candidateName,
          title: candidateTitle,
          location: c.location || "N/A",
          experience: experienceVal,
          expYears: parseInt(c.totalExperience) || 0,
          visa: c.immigrationStatus || "N/A",
          matchedSkills: Array.isArray(c.skills) ? c.skills : (c.skills ? [c.skills] : []),
          missingSkills: [],
          matchScore: 90,
          aiConfidence: 85,
          badge: 'Recommended',
          summary: c.profileSummary || `${candidateName} is a ${candidateTitle} with experience in ${Array.isArray(c.skills) ? c.skills.join(', ') : "various tools"}.`,
          breakdown: { skills: 90, experience: 85, location: 80, visa: 85, education: 90, availability: 90 },
          resumeEvidence: [],
          aiRecommendationReason: "Good match based on parsed resume metrics.",
          matchingHistory: [],
          fileName: cleanFileName(c.fileName || `${(candidateName).toLowerCase().replace(/\s+/g, '_')}_resume.pdf`),
          uploadedDate: c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Jul 21, 2026",
          poolStatus: getPoolStatus(c.createdAt),
          email: c.email,
          phone: c.phone,
          linkedin: c.linkedin,
          github: c.github,
          currentCompany: c.currentCompany,
          currentRole: c.currentRole,
          minRate: c.minRate,
          education: c.education,
          experienceDetail: c.experience,
          orbit_lifecycle_state: c.orbit_lifecycle_state,
          is_watching: Boolean(c.is_watching || c.isWatching),
          action_needed: c.action_needed,
          missing_fields: c.missing_fields,
          missing_keys: c.missing_keys,
          resumeId: c.resumeId,
          processingStatus: c.processingStatus,
        });
      });

      // Sort final lists by date descending using the dateMap
      mappedJobs.sort((a, b) => {
        const timeA = dateMap[a.id]?.getTime() || 0;
        const timeB = dateMap[b.id]?.getTime() || 0;
        return timeB - timeA;
      });

      mappedCandidates.sort((a, b) => {
        const timeA = dateMap[a.id]?.getTime() || 0;
        const timeB = dateMap[b.id]?.getTime() || 0;
        return timeB - timeA;
      });

      setJobs(mappedJobs);
      setCandidates(mappedCandidates);
    } catch (err: any) {
      console.error("Failed fetching live data:", err);
      setError(err.message || "Failed to load live data records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchBackendData();
    }
    // Load jobs/candidates once per login. Refetching on every sidebar click
    // made page switches wait on /jobs + /candidates (often multi-second).
  }, [user]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#0b0813] flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-10 h-10 text-purple-500 animate-spin" />
        <span className="text-xs text-slate-400 font-medium">Initializing SYNTRA workspace...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  // Only display spinner when performing the initial fetch to keep UX smooth
  const showLoader = loading && jobs.length === 0 && candidates.length === 0;

  const handleGoToMatch = (mode: 'job' | 'resume', id: string) => {
    setMatchMode(mode);
    if (mode === 'job') {
      setSelectedJobId(id);
      setSelectedCandidateId(null);
    } else {
      setSelectedCandidateId(id);
      setSelectedJobId(null);
    }
    void fetchBackendData().finally(() => {
      setActiveScreen('matching');
    });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0b0813] text-slate-100 font-sans antialiased">
      {/* Sidebar Navigation */}
      <Sidebar activeScreen={activeScreen} onNavigate={navigateTo} />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <Header activeScreen={activeScreen} onGoToMatch={handleGoToMatch} />

        <main className={`flex-1 flex flex-col min-h-0 min-w-0 ${['inbox', 'resumes', 'jobs', 'prism', 'vendors'].includes(activeScreen) ? 'overflow-hidden' : 'overflow-y-auto'}`}>
            {showLoader && (
              <div className="flex flex-col items-center justify-center py-32 space-y-4">
                <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                <span className="text-xs text-slate-400">Loading Datastore records...</span>
              </div>
            )}

            {error && (
              <div className="p-4 mx-8 mt-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs md:text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {!showLoader && activeScreen === 'dashboard' && (
              <Dashboard onNavigate={navigateTo} />
            )}
            {!showLoader && activeScreen === 'upload' && (
              <UploadAnalyze
                initialInputType={uploadType}
                onSaveToLibrary={async (tab) => {
                  await fetchBackendData();
                  navigateTo(tab === 'jobs' ? 'jobs' : 'resumes');
                }}
                onGoToMatch={handleGoToMatch}
              />
            )}
            {!showLoader && activeScreen === 'matching' && (
              <AIWorkspace
                key={`${matchMode}-${selectedJobId || selectedCandidateId || 'none'}`}
                jobs={jobs}
                candidates={candidates}
                initialMatchMode={matchMode}
                initialSelectedJobId={selectedJobId}
                initialSelectedCandidateId={selectedCandidateId}
                onNavigate={navigateTo}
              />
            )}
            {!showLoader && activeScreen === 'inbox' && (
              <RelayWorkspace onNavigate={navigateTo} />
            )}
            {!showLoader && (activeScreen === 'jobs' || activeScreen === 'resumes') && (
              <DataStore
                jobs={jobs}
                candidates={candidates}
                initialTab={activeScreen === 'jobs' ? 'jobs' : 'resumes'}
                onNavigate={navigateTo}
                onUploadClick={(type) => {
                  setUploadType(type);
                  navigateTo('upload');
                }}
                onRefresh={fetchBackendData}
                onThresholdChange={handleThresholdChange}
                onGoToMatch={handleGoToMatch}
              />
            )}
            {!showLoader && activeScreen === 'vendors' && (
              <VendorWorkspace />
            )}
            {!showLoader && activeScreen === 'prism' && (
              <SubmissionRTR
                navigationContext={navigationContext}
                onClearNavigation={() => setNavigationContext(null)}
              />
            )}
            {!showLoader && activeScreen === 'settings' && (
              <SettingsWorkspace />
            )}
          </main>
        </div>
      </div>
    );
}
