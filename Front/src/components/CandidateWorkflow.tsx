import React, { useState, useEffect } from 'react';
import {
  X,
  MapPin,
  Mail,
  Phone,
  FileText,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ShieldCheck,
  History,
  Save,
  Eye,
  Loader2
} from 'lucide-react';
import { CandidateProfile } from '../types';
import { apiFetch } from '../services/api';
import { cleanJobTitle } from '../utils';

interface CandidateWorkflowProps {
  candidate?: CandidateProfile | null;
  record?: any;
  submissionId?: string | null;
  onClose: () => void;
  onViewResume?: (candidateId?: string) => void;
  onViewJob?: (jobId?: string) => void;
  initialTab?: CandidateWorkflowTab;
}

export type CandidateWorkflowTab = 'Overview' | 'Matched Jobs' | 'Submission Flow';

export const CandidateWorkflow: React.FC<CandidateWorkflowProps> = ({
  candidate,
  record,
  submissionId,
  onClose,
  onViewResume,
  onViewJob,
  initialTab = 'Overview'
}) => {
  const [activeTab, setActiveTab] = useState<CandidateWorkflowTab>(initialTab);
  
  // Data states
  const [candidateData, setCandidateData] = useState<any>(candidate || record || {});
  const [matchedJobs, setMatchedJobs] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [submissionData, setSubmissionData] = useState<any>(null);

  // Viewing Job Modal state
  const [viewingJob, setViewingJob] = useState<any | null>(null);
  const [loadingJob, setLoadingJob] = useState<boolean>(false);
  
  // Editable Submission Flow states
  const [submittedRate, setSubmittedRate] = useState<string>('');
  const [notesText, setNotesText] = useState<string>('');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState<boolean>(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const candId = candidate?.id || record?.candidateId || record?.id;

  useEffect(() => {
    if (!candId) return;
    
    let isMounted = true;
    apiFetch(`/candidates/${candId}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted && data?.candidate) {
          setCandidateData((prev: any) => ({ ...prev, ...data.candidate }));
        }
      })
      .catch(() => {});

    setLoadingMatches(true);
    apiFetch(`/candidates/${candId}/matches`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted) {
          setMatchedJobs(data?.matches || data?.data || []);
          setLoadingMatches(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoadingMatches(false);
      });

    const targetSubId = submissionId || record?.id;
    const subUrl = targetSubId ? `/submissions/${targetSubId}` : `/submissions?candidateId=${candId}`;
    apiFetch(subUrl)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted) {
          const sub = Array.isArray(data) ? data[0] : (data?.submission || data);
          if (sub) {
            setSubmissionData(sub);
            if (sub.rate) setSubmittedRate(String(sub.rate));
          }
        }
      })
      .catch(() => {});

    apiFetch(`/candidates/${candId}/activities`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted && data?.activities) {
          const latestNote = data.activities.find((a: any) => a.type === 'NOTE' || a.action === 'NOTE');
          if (latestNote?.details) {
            setNotesText(latestNote.details);
          }
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [candId, submissionId, record?.id]);

  const currentCand = candidateData || candidate || record || {};

  const candidateName = currentCand.fullName || currentCand.candidateName || currentCand.name || 'N/A';
  const payRate = currentCand.desiredPayRate || currentCand.payRate || record?.payRate || (currentCand.rate ? `$${currentCand.rate}/hr` : 'N/A');
  const jobTitle = currentCand.primaryRole || currentCand.candidateTitle || currentCand.jobDescription || record?.jobDescription || 'N/A';
  const availability = currentCand.availability || record?.availability || 'N/A';
  const experience = currentCand.totalExperience != null ? `${currentCand.totalExperience} Years` : (currentCand.candidateExperience || 'N/A');
  const email = currentCand.email || currentCand.candidateEmail || record?.candidateEmail || 'N/A';
  const phone = currentCand.phone || currentCand.candidatePhone || record?.candidatePhone || 'N/A';
  const location = currentCand.location || currentCand.candidateLocation || record?.candidateLocation || 'N/A';
  const workAuth = currentCand.immigrationStatus || currentCand.candidateWorkAuth || record?.candidateWorkAuth || 'N/A';

  const handleAttemptBack = () => {
    if (isDirty) {
      setShowUnsavedModal(true);
    } else {
      onClose();
    }
  };

  const handleViewJob = async (jobId?: string, fallbackTitle?: string) => {
    if (onViewJob && jobId) {
      onViewJob(jobId);
    }
    if (!jobId) return;

    setLoadingJob(true);
    try {
      const res = await apiFetch(`/jobs/${jobId}`);
      if (res.ok) {
        const data = await res.json();
        setViewingJob(data.job || { jobId, title: fallbackTitle });
      } else {
        setViewingJob({ jobId, title: fallbackTitle });
      }
    } catch {
      setViewingJob({ jobId, title: fallbackTitle });
    } finally {
      setLoadingJob(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (submissionData?.id) {
        await apiFetch(`/submissions/${submissionData.id}/rate-availability`, {
          method: 'PATCH',
          body: JSON.stringify({
            rate: parseFloat(submittedRate) || 120,
            rateType: 'HOURLY',
            availability: availability
          })
        });
      }

      if (notesText.trim() && candId) {
        await apiFetch(`/candidates/${candId}/activities`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'NOTE',
            details: notesText,
            action: 'Workflow Note Saved'
          })
        });
      }

      setIsDirty(false);
    } catch (e) {
      console.error('Failed to save workflow changes:', e);
    } finally {
      setSaving(false);
    }
  };

  const currentSubStatus = (submissionData?.status || 'DRAFT').toUpperCase();
  const consultantConfirmStatus = submissionData?.consultantConfirmation?.status || submissionData?.confirmationData?.consultantConfirmation?.status || record?.consultantConfirmation?.status || 'PENDING';
  const vendorConfirmStatus = submissionData?.vendorConfirmation?.status || submissionData?.confirmationData?.vendorConfirmation?.status || record?.vendorConfirmation?.status || 'PENDING';
  const canInitiateRTR = Boolean(
    submissionData?.canInitiateRTR ?? record?.canInitiateRTR ??
    (submissionData?.rate && submissionData?.availability && consultantConfirmStatus === 'CONFIRMED' && vendorConfirmStatus === 'CONFIRMED')
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-[#07040d]/80 backdrop-blur-md" onClick={handleAttemptBack}>
      <div 
        className="bg-[#0b0716] border border-[#231b36] rounded-2xl shadow-2xl w-[92vw] max-w-[1280px] h-[86vh] flex overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Sidebar Navigation */}
        <div className="w-[220px] bg-[#0c0818] border-r border-[#231b36] p-5 flex flex-col shrink-0 justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">Candidate Workflow</h3>
            
            <div className="space-y-2">
              <button
                onClick={() => setActiveTab('Overview')}
                className={`w-full text-left px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-3 transition cursor-pointer ${
                  activeTab === 'Overview'
                    ? 'bg-[#3b1968] text-purple-200 border border-purple-500/30 shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <Eye className={`w-4 h-4 ${activeTab === 'Overview' ? 'text-purple-300' : 'text-slate-400'}`} />
                Overview
              </button>

              <button
                onClick={() => setActiveTab('Matched Jobs')}
                className={`w-full text-left px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-3 transition cursor-pointer ${
                  activeTab === 'Matched Jobs'
                    ? 'bg-[#3b1968] text-purple-200 border border-purple-500/30 shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <FileText className={`w-4 h-4 ${activeTab === 'Matched Jobs' ? 'text-purple-300' : 'text-slate-400'}`} />
                Matched Jobs
              </button>

              <button
                onClick={() => setActiveTab('Submission Flow')}
                className={`w-full text-left px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-3 transition cursor-pointer ${
                  activeTab === 'Submission Flow'
                    ? 'bg-[#3b1968] text-purple-200 border border-purple-500/30 shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                <History className={`w-4 h-4 ${activeTab === 'Submission Flow' ? 'text-purple-300' : 'text-slate-400'}`} />
                Submission Flow
              </button>
            </div>
          </div>
        </div>

        {/* Main Panel Right of Sidebar */}
        <div className="flex-1 flex flex-col bg-[#0b0716] overflow-hidden min-w-0">
          
          {/* Top Header Bar */}
          <div className="px-6 py-4 border-b border-[#231b36] flex items-center justify-between gap-4 bg-[#0b0716] min-w-0">
            {/* Left Info Column */}
            <div className="flex flex-col gap-1 shrink-0 pr-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-extrabold text-white tracking-tight whitespace-nowrap">{candidateName}</h2>
                <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider shrink-0">
                  Active
                </span>
              </div>
              <div className="text-xs text-slate-300 font-semibold truncate capitalize max-w-[220px]">{jobTitle}</div>
              <div className="text-[11px] text-slate-400 flex items-center gap-1 font-medium">
                <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" /> <span>{location}</span>
              </div>
            </div>

            {/* Right Horizontal Capsule Container */}
            <div className="flex items-center gap-3 bg-[#130b24] border border-[#2d2146] rounded-2xl px-4 py-2 text-xs shadow-inner shrink-0 ml-auto">
              {/* Email */}
              <div className="flex items-center gap-2.5 pr-3 border-r border-[#2d2146] min-w-0">
                <div className="w-7 h-7 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                  <Mail className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-slate-100 font-bold text-xs truncate max-w-[170px]" title={email}>{email}</div>
                  <div className="text-[10px] text-slate-400 font-medium">{experience}</div>
                </div>
              </div>

              {/* Phone */}
              <div className="flex items-center gap-2.5 pr-3 border-r border-[#2d2146] shrink-0">
                <div className="w-7 h-7 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                  <Phone className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div className="whitespace-nowrap font-bold text-xs text-slate-100">{phone}</div>
              </div>

              {/* Expected Pay */}
              <div className="flex items-center gap-2.5 pr-3 border-r border-[#2d2146] shrink-0">
                <div className="w-7 h-7 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                  <DollarSign className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div>
                  <div className="text-slate-100 font-bold text-xs whitespace-nowrap">{payRate}</div>
                  <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Expected Pay</div>
                </div>
              </div>

              {/* Availability */}
              <div className="flex items-center gap-2.5 pr-3 border-r border-[#2d2146] shrink-0">
                <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div>
                  <div className="text-emerald-400 font-bold text-xs whitespace-nowrap">{availability}</div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Availability</div>
                </div>
              </div>

              {/* Close Button */}
              <button 
                onClick={handleAttemptBack}
                className="w-7 h-7 rounded-full hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer shrink-0 ml-0.5"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className="p-6 overflow-y-auto flex-1 bg-[#0b0716] custom-scrollbar">
            
            {/* TAB 1: OVERVIEW */}
            {activeTab === 'Overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
                
                {/* CANDIDATE SUMMARY */}
                <div className="bg-[#120b22] border border-[#231b36] rounded-2xl p-6 shadow-sm">
                  <h4 className="text-[11px] font-bold text-purple-400 uppercase tracking-widest mb-6">CANDIDATE SUMMARY</h4>
                  <div className="grid grid-cols-2 gap-y-5 gap-x-6 text-xs">
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Full Name</div>
                      <div className="text-slate-200 font-bold">{candidateName}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Pay Rate</div>
                      <div className="text-slate-200 font-bold">{payRate}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Title / Specialization</div>
                      <div className="text-slate-200 font-bold">{jobTitle}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Availability</div>
                      <div className="text-emerald-400 font-bold">{availability}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Total Experience</div>
                      <div className="text-slate-200 font-bold">{experience}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Email</div>
                      <div className="text-slate-200 font-bold truncate">{email}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Current Location</div>
                      <div className="text-slate-200 font-bold">{location}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Phone</div>
                      <div className="text-slate-200 font-bold">{phone}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Work Authorization</div>
                      <div className="text-emerald-400 font-bold">{workAuth}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-medium">Resume</div>
                      <button 
                        onClick={() => onViewResume?.(candId)} 
                        className="text-purple-400 hover:text-purple-300 font-bold flex items-center gap-1.5 transition cursor-pointer text-xs"
                      >
                        <Eye className="w-3.5 h-3.5" /> View Resume
                      </button>
                    </div>
                  </div>
                </div>

                {/* AT A GLANCE */}
                <div className="bg-[#120b22] border border-[#231b36] rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                  <div>
                    <h4 className="text-[11px] font-bold text-purple-400 uppercase tracking-widest mb-6">AT A GLANCE</h4>
                    <div className="space-y-6">
                      <div className="flex items-start gap-4">
                        <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                          submissionData?.id ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-slate-700 bg-slate-800/40'
                        }`}>
                          {submissionData?.id ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-slate-400" />}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-200">Submission Uniqueness</div>
                          <div className={`text-xs font-bold my-0.5 ${submissionData?.id ? 'text-emerald-400' : 'text-slate-400'}`}>
                            {submissionData?.id ? 'No Active Duplicate Submissions' : 'Not Verified'}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {submissionData?.id ? 'Active submission is unique for candidate & job.' : 'Uniqueness check pending submission creation.'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                          (email !== 'N/A' && phone !== 'N/A' && submissionData?.resumeValid) ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'
                        }`}>
                          {(email !== 'N/A' && phone !== 'N/A' && submissionData?.resumeValid) ? <ShieldCheck className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4 text-amber-500" />}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-200">Profile Completeness</div>
                          <div className={`text-xs font-bold my-0.5 ${(email !== 'N/A' && phone !== 'N/A' && submissionData?.resumeValid) ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {(email !== 'N/A' && phone !== 'N/A' && submissionData?.resumeValid) ? 'Profile Complete' : 'Profile Incomplete'}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {(email !== 'N/A' && phone !== 'N/A' && submissionData?.resumeValid) ? 'Contact info and processed resume present.' : 'Complete email, phone, and resume processing.'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                          submissionData?.approval?.status === 'APPROVED' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-slate-700 bg-slate-800/40'
                        }`}>
                          {submissionData?.approval?.status === 'APPROVED' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-slate-400" />}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-200">Internal Approval</div>
                          <div className={`text-xs font-bold my-0.5 ${submissionData?.approval?.status === 'APPROVED' ? 'text-emerald-400' : 'text-slate-400'}`}>
                            {submissionData?.approval?.status || 'Not Requested'}
                          </div>
                          <div className="text-[11px] text-slate-400">{submissionData?.approval?.notes || 'Internal approval status from system.'}</div>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full border border-purple-500/30 bg-purple-500/10 flex items-center justify-center shrink-0 mt-0.5">
                          <History className="w-4 h-4 text-purple-400" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-200">Submission History</div>
                          <div className="text-xs font-bold text-purple-400 my-0.5">
                            {submissionData?.createdAt ? 'Created ' + new Date(submissionData.createdAt).toLocaleDateString('en-US') : 'Not Submitted'}
                          </div>
                          <div className="text-[11px] text-slate-400">Timeline of all actions and updates.</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: MATCHED JOBS */}
            {activeTab === 'Matched Jobs' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-bold text-white">Job Matches Table</h3>
                    <p className="text-xs text-slate-400">Real-time matching requirements for {candidateName}</p>
                  </div>
                  <div className="text-xs text-slate-400 font-medium bg-[#120b22] px-3 py-1.5 rounded-lg border border-[#231b36]">
                    Matches ({matchedJobs.length})
                  </div>
                </div>

                {loadingMatches ? (
                  <div className="p-12 text-center text-slate-400 text-sm">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-400" />
                    Loading real matched jobs from backend...
                  </div>
                ) : matchedJobs.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 text-sm border border-[#231b36] rounded-xl bg-[#0c0717]">
                    No matched jobs found for this candidate.
                  </div>
                ) : (
                  <div className="border border-[#231b36] rounded-xl overflow-hidden bg-[#0c0717]">
                    <table className="w-full text-left text-xs text-slate-300 border-collapse">
                      <thead>
                        <tr className="border-b border-[#231b36] bg-[#120b22] text-slate-400 font-semibold text-[11px] uppercase tracking-wider">
                          <th className="py-3.5 px-4">Job Title</th>
                          <th className="py-3.5 px-4">Company</th>
                          <th className="py-3.5 px-4">Location</th>
                          <th className="py-3.5 px-4">Match Score</th>
                          <th className="py-3.5 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#231b36]">
                        {matchedJobs.map((job: any) => {
                          const targetJobId = job.jobId || job.id;
                          const rawTitle = job.jobTitle || job.title;
                          const displayTitle = rawTitle ? cleanJobTitle(rawTitle) : 'Untitled Job';
                          const displayCompany = job.companyName || job.company || 'Not specified';
                          const displayLocation = job.location || 'Not specified';

                          let displayScore = 'N/A';
                          let numericScore: number | null = null;
                          if (job.score != null && job.score !== '') {
                            const s = Number(job.score);
                            if (!isNaN(s)) {
                              numericScore = s <= 1 && s > 0 ? Math.round(s * 100) : Math.round(s);
                              displayScore = `${numericScore}% Match`;
                            }
                          }

                          return (
                            <tr key={job.matchId || targetJobId} className="hover:bg-[#160d2b] transition">
                              <td className="py-3.5 px-4 font-bold text-white">{displayTitle}</td>
                              <td className="py-3.5 px-4 text-slate-300">{displayCompany}</td>
                              <td className="py-3.5 px-4 text-slate-400">{displayLocation}</td>
                              <td className="py-3.5 px-4">
                                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                  numericScore != null && numericScore >= 70
                                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                                    : 'bg-purple-500/10 border border-purple-500/30 text-purple-300'
                                }`}>
                                  {displayScore}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <button 
                                  onClick={() => handleViewJob(targetJobId, displayTitle)}
                                  className="text-purple-400 hover:text-purple-300 text-xs font-semibold hover:underline cursor-pointer"
                                >
                                  View Job
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: SUBMISSION FLOW */}
            {activeTab === 'Submission Flow' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  
                  {/* Left Column (7 cols) */}
                  <div className="lg:col-span-7 space-y-6">
                    {/* Stepper Header */}
                    <div className="bg-[#120b22] border border-[#231b36] rounded-2xl p-5 flex items-center justify-between shadow-sm overflow-x-auto custom-scrollbar">
                      {[
                        { num: 1, label: 'Candidate Info', status: 'completed' },
                        { 
                          num: 2, 
                          label: 'Consent & Validation', 
                          status: ['CANDIDATE_VALIDATED', 'MASKED', 'VENDOR_SUBMITTED', 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus)
                            ? 'completed'
                            : (currentSubStatus === 'PENDING_CONSENT' ? 'active' : 'pending')
                        },
                        { 
                          num: 3, 
                          label: 'Vendor & Masking', 
                          status: ['VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus)
                            ? 'completed'
                            : (['MASKED', 'VENDOR_SUBMITTED'].includes(currentSubStatus) ? 'active' : 'pending')
                        },
                        { 
                          num: 4, 
                          label: 'Rate & RTR', 
                          status: ['RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus)
                            ? 'completed'
                            : (['VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR'].includes(currentSubStatus) ? 'active' : 'pending')
                        },
                        { 
                          num: 5, 
                          label: 'Submission Complete', 
                          status: ['RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus)
                            ? 'completed' 
                            : 'pending' 
                        }
                      ].map((step, index, arr) => (
                        <React.Fragment key={step.num}>
                          <div className="flex flex-col items-center gap-2 relative">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                              step.status === 'completed' 
                                ? 'bg-emerald-500 text-slate-950 font-extrabold shadow-md' 
                                : step.status === 'active'
                                ? 'bg-purple-600 text-white ring-4 ring-purple-600/30 font-extrabold shadow-lg'
                                : 'bg-[#1b142d] text-slate-500 border border-[#2d2246]'
                            }`}>
                              {step.num}
                            </div>
                            <span className={`text-[10px] font-semibold whitespace-nowrap ${
                              step.status === 'active' ? 'text-purple-300 font-bold' : step.status === 'completed' ? 'text-slate-300' : 'text-slate-500'
                            }`}>
                              {step.label}
                            </span>
                          </div>
                          {index < arr.length - 1 && (
                            <div className={`flex-1 h-[2px] mb-5 mx-1 ${
                              step.status === 'completed' ? 'bg-emerald-500/50' : 'bg-[#291e42]'
                            }`} />
                          )}
                        </React.Fragment>
                      ))}
                    </div>

                    <h4 className="text-[11px] font-bold text-purple-400 uppercase tracking-widest pt-1">WORKFLOW GATES & VALIDATION</h4>

                    {/* RTR Status Box */}
                    <div className="bg-[#0b0716] border border-[#231b36] rounded-xl p-5 flex items-center justify-between">
                      <div>
                        <div className="text-[11px] font-semibold text-slate-400 mb-2">RTR Agreement Status</div>
                        <div className={`flex items-center gap-2 font-bold text-sm ${
                          submissionData?.rtr?.status === 'SIGNED' ? 'text-emerald-400' : (submissionData?.rtr?.status ? 'text-amber-400' : 'text-slate-400')
                        }`}>
                          {submissionData?.rtr?.status === 'SIGNED' ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Clock className="w-5 h-5 text-amber-400" />}
                          <span>{submissionData?.rtr?.status === 'SIGNED' ? 'RTR Signed & Confirmed' : (submissionData?.rtr?.status ? `RTR ${submissionData.rtr.status}` : 'RTR Not Initiated')}</span>
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-slate-400 space-y-1">
                        <div>Confirmed on: <span className="text-slate-200 font-medium">{submissionData?.rtr?.created_at || submissionData?.rtr?.createdAt ? new Date(submissionData.rtr.created_at || submissionData.rtr.createdAt).toLocaleDateString('en-US') : 'N/A'}</span></div>
                        <div>Workflow State: <span className="text-purple-300 font-bold">{currentSubStatus}</span></div>
                      </div>
                    </div>

                    {/* Rate & Availability Information Box */}
                    <div className="bg-[#0b0716] border border-[#231b36] rounded-xl p-5 space-y-4">
                      <div className="text-[11px] font-semibold text-slate-400">Rate & Availability Verification</div>
                      
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Expected Rate</span>
                        <span className="font-bold text-white text-sm">{payRate}</span>
                      </div>

                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Confirmed Rate</span>
                        <span className="font-bold text-white text-sm">{submissionData?.rate ? `$${submissionData.rate}/${submissionData.rateType === 'HOURLY' || submissionData.rate_type === 'HOURLY' ? 'hr' : 'yr'}` : 'Not confirmed'}</span>
                      </div>

                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Confirmed Availability</span>
                        <span className="font-bold text-emerald-400 text-xs">{submissionData?.availability || availability || 'Not specified'}</span>
                      </div>

                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Consultant Confirmation</span>
                        <span className={`font-bold text-xs ${
                          consultantConfirmStatus === 'CONFIRMED' ? 'text-emerald-400' : (consultantConfirmStatus === 'DECLINED' ? 'text-red-400' : 'text-amber-400')
                        }`}>
                          {consultantConfirmStatus}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">Vendor Confirmation</span>
                        <span className={`font-bold text-xs ${
                          vendorConfirmStatus === 'CONFIRMED' ? 'text-emerald-400' : (vendorConfirmStatus === 'DECLINED' ? 'text-red-400' : 'text-amber-400')
                        }`}>
                          {vendorConfirmStatus}
                        </span>
                      </div>

                      <div className="pt-3 border-t border-[#231b36] flex justify-between items-center text-xs">
                        <span className="text-slate-400 font-medium">RTR Initiation Gate</span>
                        <div className={`flex items-center gap-2 font-bold ${
                          canInitiateRTR ? 'text-emerald-400' : 'text-amber-400'
                        }`}>
                          {canInitiateRTR ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4 text-amber-400" />}
                          <span>{canInitiateRTR ? 'Ready for RTR' : 'Waiting for Both Confirmations'}</span>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Right Column (5 cols) */}
                  <div className="lg:col-span-5 space-y-6 flex flex-col justify-between">
                    <div className="space-y-6">
                      {/* COMPLIANCE CHECKLIST */}
                      <div className="bg-[#120b22] border border-[#231b36] rounded-2xl p-6 shadow-sm">
                        <h4 className="text-[11px] font-bold text-purple-400 uppercase tracking-widest mb-4">COMPLIANCE CHECKLIST</h4>
                        
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {/* Consent Status */}
                          <div className={`bg-[#0b0716] border rounded-xl p-3 flex items-center gap-2 font-bold shadow-sm ${
                            (submissionData?.consent?.status === 'APPROVED' || ['CANDIDATE_VALIDATED', 'MASKED', 'VENDOR_SUBMITTED', 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus))
                              ? 'border-emerald-500/30 text-emerald-400' 
                              : (submissionData?.consent?.status === 'REJECTED' ? 'border-red-500/30 text-red-400' : 'border-amber-500/30 text-amber-400')
                          }`}>
                            {(submissionData?.consent?.status === 'APPROVED' || ['CANDIDATE_VALIDATED', 'MASKED', 'VENDOR_SUBMITTED', 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus)) ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <Clock className="w-4 h-4 text-amber-400 shrink-0" />}
                            <span className="truncate">Candidate Consent</span>
                          </div>

                          {/* Candidate Validation */}
                          <div className={`bg-[#0b0716] border rounded-xl p-3 flex items-center gap-2 font-bold shadow-sm ${
                            (submissionData?.candidateValidationResults?.passed || submissionData?.candidate_validation_results?.passed || ['CANDIDATE_VALIDATED', 'MASKED', 'VENDOR_SUBMITTED', 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus))
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-slate-800 text-slate-400'
                          }`}>
                            {(submissionData?.candidateValidationResults?.passed || submissionData?.candidate_validation_results?.passed || ['CANDIDATE_VALIDATED', 'MASKED', 'VENDOR_SUBMITTED', 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus)) ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />}
                            <span className="truncate">Candidate Validated</span>
                          </div>

                          {/* Masked Profile */}
                          <div className={`bg-[#0b0716] border rounded-xl p-3 flex items-center gap-2 font-bold shadow-sm ${
                            (submissionData?.maskedProfile || submissionData?.masked_profile || ['MASKED', 'VENDOR_SUBMITTED', 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus))
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-slate-800 text-slate-400'
                          }`}>
                            {(submissionData?.maskedProfile || submissionData?.masked_profile || ['MASKED', 'VENDOR_SUBMITTED', 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus))
                              ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> 
                              : <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                            }
                            <span className="truncate">Masked Profile</span>
                          </div>

                          {/* Vendor Validated */}
                          <div className={`bg-[#0b0716] border rounded-xl p-3 flex items-center gap-2 font-bold shadow-sm ${
                            (submissionData?.vendorValidationResults?.passed || submissionData?.vendor_validation_results?.passed || ['VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus))
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-slate-800 text-slate-400'
                          }`}>
                            {(submissionData?.vendorValidationResults?.passed || submissionData?.vendor_validation_results?.passed || ['VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus)) ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />}
                            <span className="truncate">Vendor Validated</span>
                          </div>

                          {/* Consultant Confirmation */}
                          <div className={`bg-[#0b0716] border rounded-xl p-3 flex items-center gap-2 font-bold shadow-sm ${
                            consultantConfirmStatus === 'CONFIRMED'
                              ? 'border-emerald-500/30 text-emerald-400'
                              : (consultantConfirmStatus === 'DECLINED' ? 'border-red-500/30 text-red-400' : 'border-amber-500/30 text-amber-400')
                          }`}>
                            {consultantConfirmStatus === 'CONFIRMED' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : (consultantConfirmStatus === 'DECLINED' ? <XCircle className="w-4 h-4 text-red-400 shrink-0" /> : <Clock className="w-4 h-4 text-amber-400 shrink-0" />)}
                            <span className="truncate">Consultant Confirmed</span>
                          </div>

                          {/* Vendor Confirmation */}
                          <div className={`bg-[#0b0716] border rounded-xl p-3 flex items-center gap-2 font-bold shadow-sm ${
                            vendorConfirmStatus === 'CONFIRMED'
                              ? 'border-emerald-500/30 text-emerald-400'
                              : (vendorConfirmStatus === 'DECLINED' ? 'border-red-500/30 text-red-400' : 'border-amber-500/30 text-amber-400')
                          }`}>
                            {vendorConfirmStatus === 'CONFIRMED' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : (vendorConfirmStatus === 'DECLINED' ? <XCircle className="w-4 h-4 text-red-400 shrink-0" /> : <Clock className="w-4 h-4 text-amber-400 shrink-0" />)}
                            <span className="truncate">Vendor Confirmed</span>
                          </div>

                          {/* RTR Status */}
                          <div className={`bg-[#0b0716] border rounded-xl p-3 flex items-center gap-2 font-bold shadow-sm ${
                            (submissionData?.rtr?.status === 'SIGNED' || ['RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus))
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-slate-800 text-slate-400'
                          }`}>
                            {(submissionData?.rtr?.status === 'SIGNED' || ['RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus)) ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />}
                            <span className="truncate">RTR Signed</span>
                          </div>

                          {/* Interview Scheduled */}
                          <div className={`bg-[#0b0716] border rounded-xl p-3 flex items-center gap-2 font-bold shadow-sm ${
                            (submissionData?.interviewDetails || submissionData?.interview_details || ['INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus))
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-slate-800 text-slate-400'
                          }`}>
                            {(submissionData?.interviewDetails || submissionData?.interview_details || ['INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(currentSubStatus)) ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />}
                            <span className="truncate">Interview Scheduled</span>
                          </div>

                          {/* Final Validation & Uniqueness Check */}
                          <div className={`col-span-2 bg-[#0b0716] border rounded-xl p-3 flex items-center gap-2 font-bold shadow-sm ${
                            ['READY', 'SUBMITTED'].includes(currentSubStatus)
                              ? 'border-emerald-500/30 text-emerald-400' 
                              : 'border-slate-800 text-slate-400'
                          }`}>
                            {['READY', 'SUBMITTED'].includes(currentSubStatus) ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />}
                            <span>{['READY', 'SUBMITTED'].includes(currentSubStatus) ? 'Final Validation Passed — Ready for Submission' : 'Final Validation Pending'}</span>
                          </div>
                        </div>
                      </div>

                      {/* NOTES (OPTIONAL) */}
                      <div className="bg-[#120b22] border border-[#231b36] rounded-2xl p-6 shadow-sm">
                        <h4 className="text-[11px] font-bold text-purple-400 uppercase tracking-widest mb-4">NOTES (OPTIONAL)</h4>
                        <textarea
                          value={notesText}
                          onChange={(e) => {
                            setNotesText(e.target.value);
                            setIsDirty(true);
                          }}
                          placeholder="Add any notes about this candidate..."
                          className="w-full h-32 bg-[#0b0716] border border-[#231b36] rounded-xl p-4 text-xs text-white focus:outline-none focus:border-purple-500/50 resize-none leading-relaxed custom-scrollbar placeholder:text-slate-600"
                        />
                      </div>
                    </div>

                    {/* Bottom Action Buttons: Back & Save */}
                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={handleAttemptBack}
                        className="px-6 py-2.5 rounded-xl border border-[#2d2345] bg-[#120b22] hover:bg-[#1c1233] text-slate-200 text-xs font-bold transition cursor-pointer"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="px-7 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-900/40 transition cursor-pointer disabled:opacity-50 flex items-center gap-2"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Save
                      </button>
                    </div>

                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* UNSAVED CHANGES PROTECTION MODAL */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
          <div className="bg-[#120b22] border border-[#231b36] rounded-2xl shadow-2xl w-full max-w-md p-6 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">Unsaved Workflow Changes</h3>
              </div>
            </div>
            
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              You have unsaved changes in the submission workflow. Would you like to save before leaving?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#231b36]">
              <button
                type="button"
                onClick={() => {
                  setIsDirty(false);
                  setShowUnsavedModal(false);
                  onClose();
                }}
                className="px-4 py-2 rounded-lg border border-[#3b2d59] text-slate-300 hover:text-white hover:bg-[#231b36] text-xs font-bold transition cursor-pointer"
              >
                Discard & Back
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleSave();
                  setShowUnsavedModal(false);
                  onClose();
                }}
                className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 transition shadow-lg shadow-purple-900/20 cursor-pointer"
              >
                <Save className="w-4 h-4" /> Save & Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JOB DETAIL PREVIEW MODAL */}
      {viewingJob && (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setViewingJob(null)}>
          <div 
            className="bg-[#120c24] border border-purple-500/30 rounded-2xl p-6 max-w-2xl w-full space-y-5 shadow-2xl relative max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setViewingJob(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-start gap-3 pr-8 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-white">
                  {cleanJobTitle(viewingJob.title || viewingJob.primaryRole || 'Untitled Job')}
                </h3>
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                  <span className="font-semibold text-slate-300">{viewingJob.companyName || 'Not specified'}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    {viewingJob.location || viewingJob.remotePolicy || 'Not specified'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
              {viewingJob.requiredSkills && viewingJob.requiredSkills.length > 0 && (
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-2">Required Skills</span>
                  <div className="flex flex-wrap gap-1.5">
                    {viewingJob.requiredSkills.map((s: string, idx: number) => (
                      <span key={idx} className="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-200 text-xs font-medium">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Job Description & Summary</span>
                <div className="p-4 rounded-xl bg-[#0c0717] border border-[#231b36] text-xs text-slate-200 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto custom-scrollbar">
                  {viewingJob.jdSummary || viewingJob.description || viewingJob.rawText || 'No detailed job description text available.'}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#231b36] flex justify-end shrink-0">
              <button
                onClick={() => setViewingJob(null)}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition cursor-pointer shadow-md"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
