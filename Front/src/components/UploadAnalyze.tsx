import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle2, Loader2, AlertCircle, Zap, Bookmark, Trash2, Check, X, FolderOpen, RefreshCw } from 'lucide-react';
import { ExtractedAnalysis, Vendor } from '../types';
import { cleanJobTitle } from '../utils';
import { apiFetch } from '../services/api';

interface UploadAnalyzeProps {
  onSaveToLibrary?: (tab: 'jobs' | 'resumes') => void | Promise<void>;
  onGoToMatch?: (mode: 'job' | 'resume', id: string) => void;
  initialInputType?: 'jd' | 'resume';
}

function existingTitleFromDuplicatePayload(data: Record<string, unknown> | null | undefined, fallback: string): string {
  const msg = String(data?.message || data?.error || '');
  const quoted = msg.match(/"([^"]+)"/);
  return (quoted?.[1] || fallback).trim() || fallback;
}

export const UploadAnalyze: React.FC<UploadAnalyzeProps> = ({
  onSaveToLibrary,
  onGoToMatch,
  initialInputType = 'jd'
}) => {
  const [inputType, setInputType] = useState<'jd' | 'resume'>(initialInputType);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [rawText, setRawText] = useState('');
  
  // Reset inputType when initialInputType changes
  useEffect(() => {
    setInputType(initialInputType);
  }, [initialInputType]);

  // Vendor State
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');

  useEffect(() => {
    // Only fetch vendors if we are uploading a JD
    if (inputType === 'jd') {
      apiFetch('/vendors')
        .then(res => res.json())
        .then(data => {
          if (data.data) setVendors(data.data);
        })
        .catch(err => console.error('Failed to load vendors:', err));
    }
  }, [inputType]);

  // Single Upload File State
  const [singleFile, setSingleFile] = useState<{ name: string; size: string } | null>(null);
  const [singleFileObj, setSingleFileObj] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryNotice, setLibraryNotice] = useState<{
    kind: 'jd' | 'resume';
    existingTitle: string;
    existingId?: string;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Bulk Upload state variables
  const [bulkState, setBulkState] = useState<'upload' | 'processing' | 'results'>('upload');
  const [bulkFiles, setBulkFiles] = useState<Array<{
    name: string;
    size: string;
    fileObj?: File;
    status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed' | 'duplicate';
    error?: string;
    candidateId?: string;
    resumeId?: string;
    jobId?: string;
    details?: {
      title: string;
      type: string;
      experience: string;
      workMode: string;
      visa: string;
      location: string;
      skills: string[];
    };
  }>>([]);

  // Animated counters for bulk processing
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkParsed, setBulkParsed] = useState(0);
  const [bulkProcessingCount, setBulkProcessingCount] = useState(0);
  const [bulkNeedsReview, setBulkNeedsReview] = useState(0);
  const [isBulkProgressFinished, setIsBulkProgressFinished] = useState(false);
  const [analyzedId, setAnalyzedId] = useState<string | null>(null);
  
  // State for failed file review modal
  const [reviewFile, setReviewFile] = useState<{ name: string; error?: string; resumeId?: string; candidateId?: string; jobId?: string; index?: number; isRetrying?: boolean } | null>(null);

  // Dynamic counter updater based on actual bulkFiles states
  useEffect(() => {
    if (mode !== 'bulk' || bulkState !== 'processing') return;

    const total = bulkFiles.length;
    if (total === 0) return;

    const completed = bulkFiles.filter(f => f.status === 'completed').length;
    const failed = bulkFiles.filter(f => f.status === 'failed').length;
    const duplicate = bulkFiles.filter(f => f.status === 'duplicate').length;
    const processing = bulkFiles.filter(f => f.status === 'uploading' || f.status === 'processing' || f.status === 'pending').length;

    const finished = completed + failed + duplicate;

    setBulkParsed(completed);
    setBulkProcessingCount(processing);
    setBulkNeedsReview(failed + duplicate);
    setBulkProgress(Math.round((finished / total) * 100));

    if (finished === total) {
      setIsBulkProgressFinished(true);
    }
  }, [bulkFiles, mode, bulkState]);

  // Single AI Processing Screen states
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const singlePollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (singlePollIntervalRef.current) {
        clearInterval(singlePollIntervalRef.current);
        singlePollIntervalRef.current = null;
      }
    };
  }, []);

  // Results State (Single Mode)
  const [showResults, setShowResults] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedAnalysis | null>(null);

  // Checklist steps for single analysis
  const stepsList = [
    'File uploaded',
    'Text extracted',
    'Skills identified',
    'Experience identified',
    'Visa & location identified',
    inputType === 'jd' ? 'Building job requirement profile' : 'Building candidate profile'
  ];

  const pollCandidateStatus = (candidateId: string): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 60; // 90 seconds
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(interval);
          resolve({ success: false, error: "Timed out waiting for processing to complete." });
          return;
        }

        try {
          const response = await apiFetch(`/candidates/${candidateId}`);
          if (!response.ok) {
            // Transient non-200 (404/5xx) — retry on next tick
            return;
          }
          const data = await response.json();
          const cand = data.candidate;
          if (!cand) {
            return;
          }

          const currentResume = cand.currentResume;
          if (currentResume?.processingFailedAt) {
            clearInterval(interval);
            resolve({ success: false, error: currentResume.processingError || "Processing failed on the server." });
          } else if (currentResume?.processedAt) {
            clearInterval(interval);
            resolve({ success: true });
          }
        } catch (err) {
          // Transient network error — retry on next tick
          console.warn("Poll candidate transient error (retrying):", err);
        }
      }, 1500);
    });
  };

  const pollJobStatus = (jobId: string): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 60; // 90 seconds
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(interval);
          resolve({ success: false, error: "Timed out waiting for processing to complete." });
          return;
        }

        try {
          const response = await apiFetch(`/jobs/${jobId}`);
          if (!response.ok) {
            // Transient non-200 (404/5xx) — retry on next tick
            return;
          }
          const data = await response.json();
          const job = data.job;
          if (!job) {
            return;
          }

          if (job.processingFailedAt) {
            clearInterval(interval);
            resolve({ success: false, error: job.processingError || "Processing failed on the server." });
          } else if (job.processedAt || job.processingStatus === 'processed') {
            clearInterval(interval);
            resolve({ success: true });
          }
        } catch (err) {
          // Transient network error — retry on next tick
          console.warn("Poll job transient error (retrying):", err);
        }
      }, 1500);
    });
  };

  const pollAndResolveResume = async (candidateId: string, index: number, name: string) => {
    const { success, error } = await pollCandidateStatus(candidateId);
    if (success) {
      // Fetch candidate details
      const detailRes = await apiFetch(`/candidates/${candidateId}`);
      const detailData = await detailRes.json();
      const fullCand = detailData.candidate;
      const currentResume = fullCand?.currentResume || {};
      const details = {
        title: fullCand?.fullName || name,
        type: 'Resume',
        experience: currentResume.totalExperience || "Not specified",
        workMode: 'Remote / Hybrid',
        visa: fullCand?.immigrationStatus || "Not specified",
        location: fullCand?.location || "Not specified",
        skills: currentResume.skills || []
      };
      setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'completed' as const, details } : f));
    } else {
      setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'failed' as const, error: error || "The Resume parsing or profile extraction failed." } : f));
    }
  };

  const pollAndResolveJob = async (jobId: string, index: number, title: string) => {
    const { success, error } = await pollJobStatus(jobId);
    if (success) {
      // Fetch job details
      const detailRes = await apiFetch(`/jobs/${jobId}`);
      const detailData = await detailRes.json();
      const fullJob = detailData.job;
      const details = {
        title: fullJob?.title || title,
        type: 'Job Description',
        experience: fullJob?.experienceRequired || '3+ Years',
        workMode: fullJob?.workMode || fullJob?.remoteOption || 'Remote',
        visa: Array.isArray(fullJob?.visaPreferences) ? fullJob.visaPreferences.join(', ') : (fullJob?.visaPreferences || 'H1B / GC'),
        location: fullJob?.location || "USA",
        skills: fullJob?.requiredSkills || []
      };
      setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'completed' as const, details } : f));
    } else {
      setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'failed' as const, error: error || "The Job Description parsing or extraction failed." } : f));
    }
  };

  const processBulkFiles = async () => {
    setBulkState('processing');
    setIsBulkProgressFinished(false);
    setError(null);
    setLibraryNotice(null);

    const total = bulkFiles.length;
    if (total === 0) return;

    // Reset status of all selected files to pending
    setBulkFiles(prev => prev.map(f => ({ ...f, status: 'pending', details: undefined })));



  const uploadAndPollFile = async (index: number) => {
      const fileItem = bulkFiles[index];
      if (!fileItem.fileObj) {
        setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'failed' as const } : f));
        return;
      }

      setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'uploading' as const } : f));

      try {
        const formData = new FormData();
        formData.append('file', fileItem.fileObj);

        let name = fileItem.name
          .replace(/\.[^/.]+$/, "")
          .replace(/_resume|_cv|resume|cv/i, "")
          .replace(/_jd|jd/i, "")
          .replace(/[-_]/g, " ")
          .trim();

        if (inputType === 'jd') {
          formData.append('title', name);
          const response = await apiFetch('/jobs', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            if (response.status === 409) {
              const data = await response.json().catch(() => ({}));
              console.info(`[Upload] Duplicate job description detected: ${fileItem.name}`);
              setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'duplicate' as const, jobId: data.jobId, error: data.message || data.error || "Duplicate JD — already in your library" } : f));
              return;
            }
            throw new Error("Upload failed");
          }

          const data = await response.json();
          const jobId = data.jobId || data.job?.id;
          if (!jobId) {
            throw new Error("No job ID returned");
          }

          // Transition to processing (polling)
          setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'processing' as const, jobId } : f));

          const { success, error } = await pollJobStatus(jobId);
          if (success) {
            // Fetch job details
            const detailRes = await apiFetch(`/jobs/${jobId}`);
            const detailData = await detailRes.json();
            const fullJob = detailData.job;
            const details = {
              title: fullJob?.title || name,
              type: 'Job Description',
              experience: '3+ Years',
              workMode: 'Remote',
              visa: 'H1B / GC',
              location: fullJob?.location || "USA",
              skills: fullJob?.requiredSkills || []
            };
            setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'completed' as const, details } : f));
          } else {
            setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'failed' as const, error: error || "The Job Description parsing or AI intelligence extraction failed." } : f));
          }
        } else {
          formData.append('fullName', name);
          formData.append('email', `bulk-${Date.now()}-${index}@example.com`);
          formData.append('phone', '');

          const response = await apiFetch('/resumes', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            if (response.status === 409) {
              const data = await response.json().catch(() => ({}));
              console.info(`[Upload] Duplicate resume detected: ${fileItem.name}`);
              setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'duplicate' as const, resumeId: data.resumeId, candidateId: data.candidateId, error: "Duplicate / Already uploaded" } : f));
              return;
            }
            throw new Error("Upload failed");
          }

          const data = await response.json();
          const candidateId = data.candidateId || data.candidate?.id;
          const resumeId = data.resumeId || data.resume?.id;
          if (!candidateId) {
            throw new Error("No candidate ID returned");
          }

          // Transition to processing (polling)
          setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'processing' as const, candidateId, resumeId } : f));

          await pollAndResolveResume(candidateId, index, name);
        }
      } catch (err: any) {
        console.error(`Error processing file ${fileItem.name}:`, err);
        setBulkFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'failed' as const, error: err.message || "The file upload failed or server responded with an error." } : f));
      }
    };

    // Run all uploads concurrently
    await Promise.all(bulkFiles.map((_, idx) => uploadAndPollFile(idx)));
  };


  const handleSingleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const sizeKB = Math.round(file.size / 1024);
      setSingleFile({
        name: file.name,
        size: `${sizeKB} KB`
      });
      setSingleFileObj(file);
      setRawText(''); // Clear pasted text
      setError(null);
      setLibraryNotice(null);
    }
  };

  const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt'];

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files)
        .filter(file => ALLOWED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext)))
        .map(file => {
          const sizeKB = Math.round(file.size / 1024);
          return {
            name: file.name,
            size: `${sizeKB} KB`,
            fileObj: file,
            status: 'pending' as const
          };
        });
      setBulkFiles(filesArray);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleSingleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const sizeKB = Math.round(file.size / 1024);
      setSingleFile({
        name: file.name,
        size: `${sizeKB} KB`
      });
      setSingleFileObj(file);
      setRawText('');
      setError(null);
      setLibraryNotice(null);
    }
  };

  const handleFolderDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const filesArray = Array.from(e.dataTransfer.files)
        .filter(file => ALLOWED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext)))
        .map(file => {
          const sizeKB = Math.round(file.size / 1024);
          return {
            name: file.name,
            size: `${sizeKB} KB`,
            fileObj: file,
            status: 'pending' as const
          };
        });
      setBulkFiles(filesArray);
    }
  };

  const removeSingleFile = () => {
    setSingleFile(null);
    setSingleFileObj(null);
  };

  const removeBulkFile = (index: number) => {
    setBulkFiles(prev => prev.filter((_, i) => i !== index));
  };

  function formatUserFriendlyError(rawError: string | null | undefined, fallback: string): string {
    if (!rawError) return fallback;
    const msg = rawError.trim();
    const lower = msg.toLowerCase();

    if (msg.includes("appears to be a Candidate Resume") || msg.includes("appears to be a Job Description")) {
      return msg;
    }
    if (/\bduplicate\b/i.test(msg) || /already in your library/i.test(msg)) {
      return msg;
    }
    if (/insufficient credits|invalid api key|incorrect api key/i.test(lower)) {
      return "AI processing is currently unavailable. Please try again in a moment.";
    }
    if (/server returned status 401/i.test(lower) || /jwt|session expired|invalid token/i.test(lower)) {
      return "Your session expired. Please sign in again.";
    }
    if (msg.startsWith("404") || msg.startsWith("500") || msg.includes("status code (no body)")) {
      return fallback;
    }

    return msg;
  }

  // Helper method: Polling Candidate extraction status
  const startPollingCandidate = (candidateId: string) => {
    if (singlePollIntervalRef.current) {
      clearInterval(singlePollIntervalRef.current);
      singlePollIntervalRef.current = null;
    }

    let attempts = 0;
    const maxAttempts = 60; // 90 seconds

    singlePollIntervalRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        if (singlePollIntervalRef.current) {
          clearInterval(singlePollIntervalRef.current);
          singlePollIntervalRef.current = null;
        }
        setError("Processing timed out. The backend is taking longer than expected.");
        setIsProcessing(false);
        return;
      }

      try {
        const response = await apiFetch(`/candidates/${candidateId}`);
        if (!response.ok) {
          // Transient non-200 (404/5xx/304) — retry on next tick
          return;
        }
        const data = await response.json();
        const fullCand = data.candidate;

        if (!fullCand) {
          return;
        }

        const currentResume = fullCand.currentResume;
        const hasProcessedResume = Boolean(
          currentResume?.processedAt || 
          currentResume?.processingStatus === 'processed' || 
          (Array.isArray(currentResume?.skills) && currentResume.skills.length > 0)
        );
        const isFailed = Boolean(
          (currentResume?.processingFailedAt || currentResume?.processingStatus === 'failed') && 
          !hasProcessedResume
        );
        const isProcessed = hasProcessedResume && !isFailed;

        // Smoothly increment currentStepIndex up to step 4 while processing
        setCurrentStepIndex((prev) => {
          if (!isProcessed && !isFailed) {
            return Math.min(prev + 1, 4);
          }
          return prev;
        });

        if (isProcessed) {
          if (singlePollIntervalRef.current) {
            clearInterval(singlePollIntervalRef.current);
            singlePollIntervalRef.current = null;
          }
          setCurrentStepIndex(stepsList.length);

          const extracted: ExtractedAnalysis = {
            title: (fullCand.fullName && fullCand.fullName !== 'Uploaded Resume' ? fullCand.fullName : 'Candidate Profile') + (currentResume?.currentRole || currentResume?.primaryRole ? ` - ${currentResume.currentRole || currentResume.primaryRole}` : ""),
            type: 'Resume',
            experience: currentResume?.totalExperience || currentResume?.experience || "Not specified",
            workMode: 'Remote / Hybrid',
            visa: fullCand.immigrationStatus || "Not specified",
            location: fullCand.location || "Not specified",
            skills: currentResume?.skills || []
          };
          setExtractedData(extracted);
          setAnalyzedId(candidateId);
          setShowResults(true);
          setIsProcessing(false);
          return;
        }

        if (isFailed) {
          if (singlePollIntervalRef.current) {
            clearInterval(singlePollIntervalRef.current);
            singlePollIntervalRef.current = null;
          }
          setError(formatUserFriendlyError(currentResume?.processingError, "Candidate profile processing encountered an error."));
          setIsProcessing(false);
          return;
        }
      } catch (err) {
        // Transient network error — retry on next tick
        console.warn("Candidate poll transient error (retrying):", err);
      }
    }, 1500);
  };

  // Helper method: Polling Job Description extraction status
  const startPollingJob = (jobId: string) => {
    if (singlePollIntervalRef.current) {
      clearInterval(singlePollIntervalRef.current);
      singlePollIntervalRef.current = null;
    }

    let attempts = 0;
    const maxAttempts = 60; // 90 seconds

    singlePollIntervalRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        if (singlePollIntervalRef.current) {
          clearInterval(singlePollIntervalRef.current);
          singlePollIntervalRef.current = null;
        }
        setError("Processing timed out. The backend is taking longer than expected.");
        setIsProcessing(false);
        return;
      }

      try {
        const response = await apiFetch(`/jobs/${jobId}`);
        if (!response.ok) {
          // Transient non-200 (404/5xx/304) — retry on next tick
          return;
        }
        const data = await response.json();
        const fullJob = data.job;

        if (!fullJob) {
          return;
        }

        const hasProcessedJob = Boolean(
          fullJob.processedAt || 
          fullJob.processingStatus === 'processed' || 
          (Array.isArray(fullJob.requiredSkills) && fullJob.requiredSkills.length > 0)
        );
        const isFailed = Boolean(
          (fullJob.processingFailedAt || fullJob.processingStatus === 'failed') && 
          !hasProcessedJob
        );
        const isProcessed = hasProcessedJob && !isFailed;

        setCurrentStepIndex((prev) => {
          if (!isProcessed && !isFailed) {
            return Math.min(prev + 1, 4);
          }
          return prev;
        });

        if (isProcessed) {
          if (singlePollIntervalRef.current) {
            clearInterval(singlePollIntervalRef.current);
            singlePollIntervalRef.current = null;
          }
          setCurrentStepIndex(stepsList.length);

          const extracted: ExtractedAnalysis = {
            title: fullJob.title || "Job Description",
            type: 'Job Description',
            experience: fullJob.experienceRequired || '3+ Years',
            workMode: fullJob.workMode || fullJob.remoteOption || 'Remote',
            visa: Array.isArray(fullJob.visaPreferences) ? fullJob.visaPreferences.join(', ') : (fullJob.visaPreferences || 'H1B / GC'),
            location: fullJob.location || "USA",
            skills: fullJob.requiredSkills || []
          };
          setExtractedData(extracted);
          setAnalyzedId(jobId);
          setShowResults(true);
          setIsProcessing(false);
          return;
        }

        if (isFailed) {
          if (singlePollIntervalRef.current) {
            clearInterval(singlePollIntervalRef.current);
            singlePollIntervalRef.current = null;
          }
          setError(formatUserFriendlyError(fullJob.processingError, "Job Description processing encountered an error."));
          setIsProcessing(false);
          return;
        }
      } catch (err) {
        // Transient network error — retry on next tick
        console.warn("Job poll transient error (retrying):", err);
      }
    }, 1500);
  };

  const handleAnalyzeClick = async () => {
    if (singlePollIntervalRef.current) {
      clearInterval(singlePollIntervalRef.current);
      singlePollIntervalRef.current = null;
    }
    setError(null);
    setLibraryNotice(null);
    setShowResults(false);
    setExtractedData(null);
    setAnalyzedId(null);
    setIsProcessing(true);
    setCurrentStepIndex(0);

    try {
      let targetFile: File | null = singleFileObj;

      if (!targetFile) {
        if (!rawText.trim()) {
          throw new Error("Please select a file or paste text first.");
        }
        // Convert pasted text into a virtual File object to support text paste
        const blob = new Blob([rawText], { type: 'text/plain' });
        const filename = inputType === 'jd' ? 'pasted_jd.txt' : 'pasted_resume.txt';
        targetFile = new File([blob], filename, { type: 'text/plain' });
      }

      const formData = new FormData();
      formData.append('file', targetFile);

      if (inputType === 'resume') {
        let name = "Uploaded Resume";
        if (singleFileObj) {
          name = singleFileObj.name
            .replace(/\.[^/.]+$/, "")
            .replace(/_resume|_cv|resume|cv/i, "")
            .replace(/[-_]/g, " ")
            .trim();
        } else if (rawText.trim()) {
          const firstLine = rawText.split('\n')[0]?.trim();
          if (firstLine && firstLine.length < 50) {
            name = firstLine;
          } else {
            name = "Pasted Resume";
          }
        }
        formData.append('fullName', name);
        formData.append('email', 'uploaded@example.com');
        formData.append('phone', '');

        const response = await apiFetch('/resumes', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          if (response.status === 409) {
            const data = await response.json().catch(() => ({}));
            setError(null);
            setLibraryNotice({
              kind: 'resume',
              existingTitle: data.fullName || existingTitleFromDuplicatePayload(data, name || 'this resume'),
              existingId: data.candidateId || data.candidate?.id,
            });
            setIsProcessing(false);
            return;
          }
          const errData = await response.json().catch(async () => ({ message: await response.text() }));
          throw new Error(errData.message || errData.error || `Server returned status ${response.status}`);
        }

        const data = await response.json();
        const candidateId = data.candidateId || data.candidate?.id;
        if (!candidateId) {
          throw new Error("Resume upload succeeded but candidate ID was not returned.");
        }

        startPollingCandidate(candidateId);
      } else {
        // inputType is 'jd'
        let title = "Uploaded Job Description";
        if (singleFileObj) {
          title = singleFileObj.name
            .replace(/\.[^/.]+$/, "")
            .replace(/_jd|jd/i, "")
            .replace(/[-_]/g, " ")
            .trim();
        } else if (rawText.trim()) {
          const firstLine = rawText.split('\n')[0]?.trim();
          if (firstLine && firstLine.length < 50) {
            title = firstLine;
          } else {
            title = "Pasted Job Description";
          }
        }
        formData.append('title', title);

        if (selectedVendorId) {
          formData.append('vendor_id', selectedVendorId);
        }

        const response = await apiFetch('/jobs', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          if (response.status === 409) {
            const data = await response.json().catch(() => ({}));
            setError(null);
            setLibraryNotice({
              kind: 'jd',
              existingTitle: existingTitleFromDuplicatePayload(data, title),
              existingId: data.jobId || data.job?.id,
            });
            setIsProcessing(false);
            return;
          }
          const errData = await response.json().catch(async () => ({ message: await response.text() }));
          throw new Error(errData.message || errData.error || `Server returned status ${response.status}`);
        }

        const data = await response.json();
        const jobId = data.jobId || data.job?.id;
        if (!jobId) {
          throw new Error("Job upload succeeded but Job ID was not returned.");
        }

        startPollingJob(jobId);
      }
    } catch (err: any) {
      console.error(err);
      setError(formatUserFriendlyError(err.message, "Failed to initiate AI upload process."));
      setIsProcessing(false);
    }
  };


  const handleReset = () => {
    if (singlePollIntervalRef.current) {
      clearInterval(singlePollIntervalRef.current);
      singlePollIntervalRef.current = null;
    }
    setShowResults(false);
    setSingleFile(null);
    setSingleFileObj(null);
    setRawText('');
    setError(null);
    setLibraryNotice(null);
    setAnalyzedId(null);
    setIsProcessing(false);
  };

  const handleBulkReset = () => {
    setBulkState('upload');
    setBulkFiles([]);
  };

  const [isSavingSingle, setIsSavingSingle] = useState(false);
  const [isSavingBulk, setIsSavingBulk] = useState(false);

  const handleBulkSaveAll = async () => {
    try {
      setIsSavingBulk(true);
      const successfulFiles = bulkFiles.filter(f => f.status === 'completed');
      if (successfulFiles.length > 0) {
        if (inputType === 'jd') {
          const jobIds = successfulFiles.map(f => f.jobId).filter(Boolean);
          if (jobIds.length > 0) {
            await apiFetch('/jobs/bulk-save', { method: 'POST', body: JSON.stringify({ jobIds }) });
          }
        } else {
          const candidateIds = successfulFiles.map(f => f.candidateId).filter(Boolean);
          if (candidateIds.length > 0) {
            await apiFetch('/resumes/bulk-save', { method: 'POST', body: JSON.stringify({ candidateIds }) });
          }
        }
      }
      if (onSaveToLibrary) {
        await onSaveToLibrary(inputType === 'jd' ? 'jobs' : 'resumes');
      }
    } catch (err: any) {
      console.error("Bulk save error", err);
      showToast(err?.message || "Failed to save some items.");
    } finally {
      setIsSavingBulk(false);
    }
  };

  const handleRetry = async (resumeId?: string, jobId?: string, index?: number) => {
    try {
      if (index !== undefined) {
        setReviewFile(prev => prev ? { ...prev, isRetrying: true } : null);
      }
      if (inputType === 'jd' && jobId) {
        const res = await apiFetch(`/jobs/${jobId}/retry`, { method: 'POST' });
        if (!res.ok && res.status !== 409) throw new Error("Retry failed for JD");
      } else if (inputType === 'resume' && resumeId) {
        const res = await apiFetch(`/resumes/${resumeId}/retry`, { method: 'POST' });
        if (!res.ok && res.status !== 409) throw new Error("Retry failed for Resume");
      }
      
      if (index !== undefined) {
        setBulkFiles(prev => {
          const newFiles = [...prev];
          if (newFiles[index]) {
            newFiles[index] = { ...newFiles[index], status: 'processing', error: undefined };
          }
          return newFiles;
        });
        setReviewFile(null);
        
        if (inputType === 'jd' && jobId) {
          pollAndResolveJob(jobId, index, bulkFiles[index]?.name || 'Unknown');
        } else if (inputType === 'resume' && resumeId) {
          const candidateId = bulkFiles[index]?.candidateId;
          if (candidateId) pollAndResolveResume(candidateId, index, bulkFiles[index]?.name || 'Unknown');
        }
      } else {
        // Single mode retry
        setReviewFile(null);
        setIsProcessing(true);
        setCurrentStepIndex(0);
        setError(null);
        setLibraryNotice(null);
        if (inputType === 'jd' && jobId) {
          startPollingJob(jobId);
        } else if (inputType === 'resume' && resumeId) {
          const candidateId = analyzedId;
          if (candidateId) startPollingCandidate(candidateId);
        }
      }
    } catch (err) {
      console.error("Retry error", err);
      showToast("Failed to retry parsing. See console for details.");
      if (index !== undefined) {
        setReviewFile(prev => prev ? { ...prev, isRetrying: false } : null);
      }
    }
  };

  const saveSingleFile = async () => {
    if (!analyzedId) {
      showToast("Nothing to save yet — wait for analysis to finish.");
      throw new Error("missing analyzedId");
    }
    try {
      if (inputType === 'jd') {
        const res = await apiFetch('/jobs/bulk-save', { method: 'POST', body: JSON.stringify({ jobIds: [analyzedId] }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 409) {
          throw new Error(data.message || `Save failed (${res.status})`);
        }
      } else {
        const res = await apiFetch('/resumes/bulk-save', { method: 'POST', body: JSON.stringify({ candidateIds: [analyzedId] }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 409) {
          throw new Error(data.message || `Save failed (${res.status})`);
        }
      }
    } catch (err: any) {
      console.error("Save error", err);
      showToast(err?.message || "Failed to save.");
      throw err;
    }
  };

  const handleActionClick = async (actionName: string) => {
    if (actionName === 'Save to Library') {
      try {
        setIsSavingSingle(true);
        await saveSingleFile();
        if (onSaveToLibrary) {
          await onSaveToLibrary(inputType === 'jd' ? 'jobs' : 'resumes');
        }
      } catch (err: any) {
        console.error("Save to library failed:", err);
      } finally {
        setIsSavingSingle(false);
      }
    } else if (actionName === 'Match + Save' || actionName === 'Match Now') {
      try {
        setIsSavingSingle(true);
        await saveSingleFile();
      } catch (err: any) {
        console.warn("Auto-save before match failed:", err);
      } finally {
        setIsSavingSingle(false);
      }
      if (onGoToMatch && analyzedId) {
        onGoToMatch(inputType === 'jd' ? 'job' : 'resume', analyzedId);
      }
    } else {
      showToast(`${actionName} action triggered.`);
    }
  };

  const renderFileCard = (file: any, idx: number) => {
    const isSuccess = file.status === 'completed';
    const isDuplicate = file.status === 'duplicate';
    const fileType = inputType === 'jd' ? 'Job Description' : 'Resume';
    
    return (
      <div 
        key={`${file.name}-${idx}`}
        className="glass-card p-6 rounded-2xl border border-white/10 hover:border-purple-500/30 transition duration-300 flex flex-col sm:flex-row sm:items-center justify-between gap-6"
      >
        <div className="space-y-3 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isSuccess ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : isDuplicate ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            )}
            <h4 className="text-sm font-bold text-slate-200 truncate">{file.name}</h4>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium">{fileType}</span>
            <span className="text-slate-600">•</span>
            <span className={`font-semibold ${isSuccess ? 'text-emerald-400' : isDuplicate ? 'text-emerald-400' : 'text-red-400'}`}>
              {isSuccess ? 'Processed' : isDuplicate ? 'Already in library' : 'Needs Review'}
            </span>
          </div>

          {isSuccess && file.details && (
            <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
              {/* Extracted Attributes Row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                {inputType === 'jd' ? (
                  <>
                    <div><span className="text-slate-400">Title:</span> <span className="font-semibold text-slate-200">{cleanJobTitle(file.details.title)}</span></div>
                    <div><span className="text-slate-400">Experience:</span> <span className="font-semibold text-slate-200">{file.details.experience}</span></div>
                    <div><span className="text-slate-400">Location:</span> <span className="font-semibold text-slate-200">{file.details.location}</span></div>
                    <div><span className="text-slate-400">Mode:</span> <span className="font-semibold text-slate-200">{file.details.workMode}</span></div>
                  </>
                ) : (
                  <>
                    <div><span className="text-slate-400">Name:</span> <span className="font-semibold text-slate-200">{file.details.title}</span></div>
                    <div><span className="text-slate-400">Experience:</span> <span className="font-semibold text-slate-200">{file.details.experience}</span></div>
                    <div><span className="text-slate-400">Location:</span> <span className="font-semibold text-slate-200">{file.details.location}</span></div>
                    <div><span className="text-slate-400">Visa:</span> <span className="font-semibold text-slate-200">{file.details.visa}</span></div>
                  </>
                )}
              </div>

              {/* Extracted Skills List */}
              {file.details.skills && file.details.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {file.details.skills.map((skill: string) => (
                    <span
                      key={skill}
                      className="px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[10px] font-semibold"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-end">
          {isSuccess ? (
            <button
              onClick={async () => {
                if (onGoToMatch) {
                  try {
                    if (inputType === 'jd' && file.jobId) {
                      await apiFetch('/jobs/bulk-save', { method: 'POST', body: JSON.stringify({ jobIds: [file.jobId] }) });
                      onGoToMatch('job', file.jobId);
                    } else if (inputType === 'resume' && file.candidateId) {
                      await apiFetch('/resumes/bulk-save', { method: 'POST', body: JSON.stringify({ candidateIds: [file.candidateId] }) });
                      onGoToMatch('resume', file.candidateId);
                    }
                  } catch (e) {
                    console.error(e);
                    showToast("Failed to save before matching");
                  }
                }
              }}
              className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs md:text-sm shadow-md transition cursor-pointer flex items-center gap-1.5"
            >
              <Zap className="w-4 h-4 text-purple-200" />
              <span>Match Now</span>
            </button>
          ) : isDuplicate ? (
            <div className="flex items-center gap-2">
               <span className="px-4 py-2 rounded-xl bg-emerald-600/15 text-emerald-300 border border-emerald-500/25 font-bold text-xs md:text-sm">
                 Already in library
               </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleRetry(file.resumeId, file.jobId, idx)}
                disabled={file.status === 'processing'}
                className="px-4 py-2 rounded-xl bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 hover:text-red-300 font-bold text-xs md:text-sm transition cursor-pointer flex items-center gap-1.5"
              >
                {file.status === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {file.status === 'processing' ? 'Retrying...' : 'Retry'}
              </button>
              <button
                onClick={() => setReviewFile({ name: file.name, error: file.error, resumeId: file.resumeId, candidateId: file.candidateId, jobId: file.jobId, index: idx, isRetrying: false })}
                className="px-5 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-bold text-xs md:text-sm transition cursor-pointer"
              >
                Review
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto relative min-h-[calc(100vh-4rem)]">
      {/* Top Header Row with Title and Single/Bulk Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight">New Input</h2>
          <p className="text-sm text-slate-400 mt-1">
            Upload Job Descriptions or Candidate Resumes for instant AI extraction & matching.
          </p>
        </div>

        {/* Single vs Bulk Toggle */}
        <div className="bg-[#161123] p-1 rounded-xl border border-purple-500/20 flex items-center">
          <button
            onClick={() => { setMode('single'); setShowResults(false); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              mode === 'single' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Single
          </button>
          <button
            onClick={() => { setMode('bulk'); setBulkState('upload'); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              mode === 'bulk' && bulkState === 'upload' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Bulk
          </button>
        </div>
      </div>

      {/* Input Type Segmented Selector (Job Description vs Resume) */}
      {((mode === 'single' && !showResults) || (mode === 'bulk' && bulkState === 'upload')) && (
        <div className="flex justify-center">
          <div className="bg-[#161123] p-1.5 rounded-2xl border border-purple-500/20 flex items-center w-full max-w-md">
            <button
              onClick={() => { setInputType('jd'); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer text-center ${
                inputType === 'jd'
                  ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-lg shadow-purple-950/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Job Description
            </button>
            <button
              onClick={() => { setInputType('resume'); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer text-center ${
                inputType === 'resume'
                  ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-lg shadow-purple-950/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Resume
            </button>
          </div>
        </div>
      )}

      {/* Optional Vendor Selection (Job Description Only) */}
      {((mode === 'single' && !showResults) || (mode === 'bulk' && bulkState === 'upload')) && inputType === 'jd' && (
        <div className="flex justify-center">
          <div className="w-full max-w-md bg-white/5 p-4 rounded-xl border border-white/5 space-y-2">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Associate Vendor (Optional)
            </label>
            <select
              value={selectedVendorId}
              onChange={(e) => setSelectedVendorId(e.target.value)}
              className="w-full bg-[#0b0813] border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
            >
              <option value="">No Vendor Selected</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.vendor_type.replace('_', ' ')}) - {v.status}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Already-in-library notice (not an error) */}
      {libraryNotice && (
        <div className="max-w-2xl mx-auto p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/25 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-100">Already in your library</p>
            <p className="text-sm text-slate-300 font-normal mt-0.5 leading-relaxed">
              {libraryNotice.kind === 'jd'
                ? `This job description matches “${libraryNotice.existingTitle}”. Nothing new was added.`
                : `This resume matches “${libraryNotice.existingTitle}”. Nothing new was added.`}
            </p>
            {libraryNotice.existingId && onGoToMatch && (
              <button
                type="button"
                onClick={() => onGoToMatch(libraryNotice.kind === 'jd' ? 'job' : 'resume', libraryNotice.existingId as string)}
                className="mt-2.5 text-xs font-semibold text-emerald-300 hover:text-white underline underline-offset-2 cursor-pointer"
              >
                Open existing {libraryNotice.kind === 'jd' ? 'job' : 'candidate'}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setLibraryNotice(null)}
            className="text-slate-500 hover:text-slate-200 cursor-pointer shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Alert Display */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 1. SINGLE UPLOAD DEFAULT STATE */}
      {/* ---------------------------------------------------- */}
      {mode === 'single' && !showResults && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* Upload File Box */}
            <div className="glass-card p-6 rounded-2xl border border-purple-500/20 flex flex-col space-y-4">
              <h3 className="text-base font-bold text-slate-100">Upload File</h3>

              <div
                onDragOver={handleDragOver}
                onDrop={handleSingleFileDrop}
                className="border-2 border-dashed border-purple-500/30 rounded-xl p-6 flex-1 flex flex-col items-center justify-center text-center hover:border-purple-500/60 transition group relative min-h-[220px]"
              >
                {singleFile ? (
                  <div className="space-y-3">
                    <div className="w-12 h-12 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-100 max-w-[200px] truncate mx-auto">{singleFile.name}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">{singleFile.size}</p>
                    </div>
                    <button
                      onClick={removeSingleFile}
                      className="px-3 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium cursor-pointer transition"
                    >
                      Remove File
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-purple-600/20 flex items-center justify-center text-purple-400 mb-3 group-hover:scale-110 transition">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <h4 className="text-sm font-bold text-slate-100">Drop files here</h4>
                    <p className="text-xs text-slate-400 my-1">or</p>
                    <label className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 text-xs font-semibold flex items-center gap-2 cursor-pointer transition my-1">
                      <FileText className="w-3.5 h-3.5 text-purple-400" />
                      <span>Browse Files</span>
                      <input type="file" onChange={handleSingleFileUpload} className="hidden" accept=".pdf,.docx,.txt" />
                    </label>
                    <span className="text-[11px] text-slate-500 mt-3">PDF · DOCX · TXT supported</span>
                  </>
                )}
              </div>
            </div>

            {/* Paste Text Box */}
            <div className="glass-card p-6 rounded-2xl border border-purple-500/20 flex flex-col space-y-4">
              <h3 className="text-base font-bold text-slate-100">Paste Text</h3>
              <div className="flex-1 flex flex-col min-h-[220px]">
                <textarea
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    if (singleFile) {
                      setSingleFile(null);
                      setSingleFileObj(null);
                    }
                  }}
                  placeholder={
                    inputType === 'jd'
                      ? 'Paste Job Description text here...'
                      : 'Paste Resume text here...'
                  }
                  className="w-full flex-1 p-3.5 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500/50 resize-none transition"
                />
              </div>
            </div>
          </div>

          {/* Analyze Button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleAnalyzeClick}
              disabled={!singleFile && !rawText.trim()}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-lg shadow-purple-900/40 transition cursor-pointer flex items-center gap-2"
            >
              <span>Analyze</span>
              <Zap className="w-4 h-4 text-purple-200" />
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 2. BULK UPLOAD FOLDER SELECTION STATE */}
      {/* ---------------------------------------------------- */}
      {mode === 'bulk' && bulkState === 'upload' && (
        <div className="space-y-6">
          <div className="glass-card p-6 rounded-2xl border border-purple-500/20 flex flex-col space-y-4">
            <h3 className="text-base font-bold text-slate-100">Folder Upload</h3>

            {/* Folder Dropzone */}
            <div
              onDragOver={handleDragOver}
              onDrop={handleFolderDrop}
              className="border-2 border-dashed border-purple-500/30 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:border-purple-500/60 transition group relative min-h-[160px]"
            >
              <div className="w-12 h-12 rounded-full bg-purple-600/20 flex items-center justify-center text-purple-400 mb-3 group-hover:scale-110 transition">
                <FolderOpen className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-100">
                {inputType === 'jd' ? 'Drop JD folder here' : 'Drop resume folder here'}
              </h4>
              <p className="text-xs text-slate-400 my-1">or</p>
              <label className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 text-xs font-semibold flex items-center gap-2 cursor-pointer transition my-1">
                <FolderOpen className="w-3.5 h-3.5 text-purple-400" />
                <span>{inputType === 'jd' ? 'Select JD Folder' : 'Select Resume Folder'}</span>
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFolderUpload}
                  {...{ webkitdirectory: "", directory: "", multiple: true }}
                />
              </label>
              <span className="text-[11px] text-slate-500 mt-2">
                {inputType === 'jd'
                  ? 'Select a folder containing multiple job descriptions'
                  : 'Select a folder containing multiple candidate resumes'}
              </span>
            </div>

            {/* Selected Folder Files List */}
            {bulkFiles.length > 0 && (
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Selected Files ({bulkFiles.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-48 overflow-y-auto pr-1">
                  {bulkFiles.map((file, idx) => (
                    <div
                      key={`${file.name}-${idx}`}
                      className="p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-3 text-left group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-200 truncate max-w-[180px]">{file.name}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{file.size}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeBulkFile(idx)}
                        className="p-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-transparent hover:border-red-500/20 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bulk Analyze Button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={processBulkFiles}
              disabled={bulkFiles.length === 0}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-lg shadow-purple-900/40 transition cursor-pointer flex items-center gap-2"
            >
              <span>Bulk Analyze</span>
              <Zap className="w-4 h-4 text-purple-200" />
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 3. BULK PROCESSING DASHBOARD VIEW */}
      {/* ---------------------------------------------------- */}
      {mode === 'bulk' && bulkState === 'processing' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="glass-card p-8 rounded-2xl border border-purple-500/30 space-y-6 relative">
            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500/30" />

            <h3 className="text-2xl font-bold text-white">
              {isBulkProgressFinished 
                ? `${bulkFiles.length} Files Selected` 
                : `Processing ${Math.min(bulkFiles.filter(f => f.status === 'completed' || f.status === 'failed').length + 1, bulkFiles.length)} of ${bulkFiles.length} files`
              }
            </h3>

            {/* Overall Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-300">Overall Progress</span>
                <span className="text-purple-400 font-mono">{bulkProgress}%</span>
              </div>
              <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 rounded-full transition-all duration-300 ease-out" 
                  style={{ width: `${bulkProgress}%` }}
                />
              </div>
            </div>

            {/* Stat Counters Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 mb-2" />
                <div className="text-2xl font-bold text-white">{bulkParsed}</div>
                <div className="text-xs text-slate-400">Parsed</div>
              </div>

              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-5 h-5 text-amber-400 mb-2 animate-spin" />
                <div className="text-2xl font-bold text-white">{bulkProcessingCount}</div>
                <div className="text-xs text-slate-400">Processing</div>
              </div>

              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex flex-col items-center justify-center text-center">
                <AlertCircle className="w-5 h-5 text-red-400 mb-2" />
                <div className="text-2xl font-bold text-white">{bulkNeedsReview}</div>
                <div className="text-xs text-slate-400">Needs Review</div>
              </div>
            </div>

            {/* Processing Files Status List */}
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                File Statuses
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-48 overflow-y-auto pr-1">
                {bulkFiles.map((file, idx) => {
                  let statusColor = "bg-white/5 border-white/10 text-slate-400";
                  let statusLabel = "Pending";
                  let StatusIcon = Loader2;
                  let isSpinning = false;

                  if (file.status === 'uploading') {
                    statusColor = "bg-blue-500/10 border-blue-500/20 text-blue-400";
                    statusLabel = "Uploading";
                    StatusIcon = UploadCloud;
                  } else if (file.status === 'processing') {
                    statusColor = "bg-amber-500/10 border-amber-500/20 text-amber-400";
                    statusLabel = "Processing";
                    StatusIcon = Loader2;
                    isSpinning = true;
                  } else if (file.status === 'completed') {
                    statusColor = "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
                    statusLabel = "Parsed";
                    StatusIcon = Check;
                  } else if (file.status === 'failed') {
                    statusColor = "bg-red-500/10 border-red-500/20 text-red-400";
                    statusLabel = "Failed / Needs Review";
                    StatusIcon = AlertCircle;
                  } else if (file.status === 'duplicate') {
                    statusColor = "bg-orange-500/10 border-orange-500/20 text-orange-400";
                    statusLabel = "Duplicate / Conflict";
                    StatusIcon = AlertCircle;
                  }

                  return (
                    <div
                      key={`${file.name}-${idx}`}
                      className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-left transition ${statusColor}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate max-w-[180px]">{file.name}</p>
                          <p className="text-[10px] opacity-75 mt-0.5">{file.size} • {statusLabel}</p>
                        </div>
                      </div>
                      <StatusIcon className={`w-4 h-4 shrink-0 ${isSpinning ? 'animate-spin' : ''}`} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Attributes List */}
            <div className="space-y-2 pt-2">
              <div className="text-xs font-medium text-slate-400">
                Attributes being extracted across files
              </div>
              <div className="flex flex-wrap gap-2">
                {['Skills', 'Experience', 'Role', 'Visa', 'Location', 'Work Mode'].map((attr) => (
                  <span
                    key={attr}
                    className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-slate-300"
                  >
                    {attr}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* View Results Button */}
          <div className="flex justify-end pt-2 animate-fadeIn">
            <button
              onClick={() => setBulkState('results')}
              disabled={!isBulkProgressFinished}
              className={`px-6 py-2.5 rounded-xl text-white font-semibold text-sm shadow-lg transition-all cursor-pointer ${
                isBulkProgressFinished 
                  ? 'bg-purple-600 hover:bg-purple-500 shadow-purple-900/40 cursor-pointer' 
                  : 'bg-white/5 text-slate-500 border border-white/10 cursor-not-allowed'
              }`}
            >
              View Results
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 3.5. BULK RESULTS LIST VIEW */}
      {/* ---------------------------------------------------- */}
      {mode === 'bulk' && bulkState === 'results' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Summary Card */}
          <div className="glass-card p-6 rounded-2xl border border-purple-500/30 relative">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500/30" />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-100">Bulk Upload Complete</h3>
                <p className="text-xs text-slate-400 mt-1">Review processing outcomes and initiate matching actions.</p>
              </div>
              <div className="flex items-center gap-4 text-xs font-semibold">
                <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300">
                  <span className="font-mono text-sm font-bold text-white mr-1.5">{bulkFiles.length}</span> Files
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <span className="font-mono text-sm font-bold text-white mr-1.5">{bulkParsed}</span> Processed
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
                  <span className="font-mono text-sm font-bold text-white mr-1.5">{bulkNeedsReview}</span> Needs Review
                </div>
              </div>
            </div>
          </div>


          {/* File cards list */}
          <div className="space-y-8">
            {/* SUCCESSFULLY PARSED SECTION */}
            {bulkFiles.some(f => f.status === 'completed') && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                  <h4 className="text-sm font-bold text-emerald-400">Successfully Parsed ({bulkFiles.filter(f => f.status === 'completed').length})</h4>
                  <button
                    onClick={handleBulkSaveAll}
                    disabled={isSavingBulk}
                    className={`px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition cursor-pointer flex items-center gap-1.5 ${isSavingBulk ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {isSavingBulk ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bookmark className="w-3.5 h-3.5" />}
                    <span>{isSavingBulk ? 'Saving...' : `Save Successfully Parsed ${inputType === 'jd' ? 'Jobs' : 'Resumes'}`}</span>
                  </button>
                </div>
                {bulkFiles.map((file, idx) => {
                  if (file.status !== 'completed') return null;
                  return renderFileCard(file, idx);
                })}
              </div>
            )}

            {/* DUPLICATE SECTION */}
            {bulkFiles.some(f => f.status === 'duplicate') && (
              <div className="space-y-4">
                <div className="border-b border-orange-500/20 pb-2">
                  <h4 className="text-sm font-bold text-orange-400">Duplicate / Already Uploaded ({bulkFiles.filter(f => f.status === 'duplicate').length})</h4>
                </div>
                {bulkFiles.map((file, idx) => {
                  if (file.status !== 'duplicate') return null;
                  return renderFileCard(file, idx);
                })}
              </div>
            )}

            {/* FAILED / NEEDS ATTENTION SECTION */}
            {bulkFiles.some(f => f.status !== 'completed' && f.status !== 'duplicate') && (
              <div className="space-y-4">
                <div className="border-b border-red-500/20 pb-2">
                  <h4 className="text-sm font-bold text-red-400">Failed / Needs Attention ({bulkFiles.filter(f => f.status !== 'completed' && f.status !== 'duplicate').length})</h4>
                </div>
                {bulkFiles.map((file, idx) => {
                  if (file.status === 'completed' || file.status === 'duplicate') return null;
                  return renderFileCard(file, idx);
                })}
              </div>
            )}
          </div>

          {/* Bottom global actions */}
          <div className="flex justify-between items-center pt-4">
            
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 4. EXTRACTED RESULTS STATE (SINGLE MODE) */}
      {/* ---------------------------------------------------- */}
      {mode === 'single' && showResults && extractedData && (
        <div className="space-y-8 animate-fadeIn">
          {/* Main Extracted Information Card */}
          <div className="glass-card p-8 rounded-2xl border border-purple-500/30 space-y-6 relative overflow-hidden">
            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500/30" />

            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-2xl font-bold text-white">
                  {extractedData.type === 'Job Description' ? cleanJobTitle(extractedData.title) : extractedData.title}
                </h3>
                <span className="inline-block mt-1.5 px-3 py-0.5 rounded-md bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-semibold">
                  {extractedData.type}
                </span>
              </div>
              <button
                onClick={handleReset}
                className="p-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                title="Clear and Upload New"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Attributes 4-Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                <span className="text-xs text-slate-400">Experience</span>
                <div className="text-sm font-bold text-slate-100">{extractedData.experience}</div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                <span className="text-xs text-slate-400">Work Mode</span>
                <div className="text-sm font-bold text-slate-100">{extractedData.workMode}</div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                <span className="text-xs text-slate-400">Visa</span>
                <div className="text-sm font-bold text-slate-100">{extractedData.visa}</div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                <span className="text-xs text-slate-400">Location</span>
                <div className="text-sm font-bold text-slate-100">{extractedData.location}</div>
              </div>
            </div>

            {/* Extracted Skills List */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-slate-400">Extracted Skills</span>
              <div className="flex flex-wrap gap-2">
                {extractedData.skills.map((skill) => (
                  <span
                    key={skill}
                    className="px-3 py-1 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-200 text-xs font-medium"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom Next Action Options */}
          <div className="space-y-4 pt-2">
            <div>
              <h4 className="text-lg font-bold text-slate-100">What would you like to do?</h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Option 1: Match Now */}
              <div
                onClick={() => handleActionClick('Match Now')}
                className={`glass-card p-6 rounded-2xl flex flex-col justify-between border border-purple-500/30 cursor-pointer hover:border-purple-500 hover:bg-purple-950/30 transition-all duration-300 group space-y-4 ${isSavingSingle ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 group-hover:scale-105 transition shrink-0">
                    <Zap className="w-6 h-6 fill-purple-400 text-purple-300" />
                  </div>
                  <div>
                    <h5 className="text-base font-bold text-slate-100 group-hover:text-purple-300 transition">Match Now</h5>
                    <p className="text-xs text-slate-400 mt-1">Save and find candidates immediately</p>
                  </div>
                </div>
              </div>

              {/* Option 2: Save to Library */}
              <div
                onClick={() => handleActionClick('Save to Library')}
                className={`glass-card p-6 rounded-2xl flex flex-col justify-between border border-emerald-500/30 cursor-pointer hover:border-emerald-500 hover:bg-emerald-950/30 transition-all duration-300 group space-y-4 ${isSavingSingle ? 'opacity-75 pointer-events-none' : ''}`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition shrink-0">
                    {isSavingSingle ? (
                      <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                    ) : (
                      <Bookmark className="w-6 h-6 fill-emerald-500 text-emerald-400" />
                    )}
                  </div>
                  <div>
                    <h5 className="text-base font-bold text-slate-100 group-hover:text-emerald-300 transition">
                      {isSavingSingle ? 'Saving to Library...' : 'Save to Library'}
                    </h5>
                    <p className="text-xs text-slate-400 mt-1">Store for later use</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Under Cards Option Controls */}
          <div className="flex flex-col items-center justify-center space-y-2 pt-2 text-xs">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer select-none">
              <input type="checkbox" defaultChecked className="rounded border-purple-500/30 bg-purple-950/40 text-purple-600 focus:ring-0 focus:ring-offset-0" />
              <span>Save this {inputType === 'jd' ? 'JD' : 'Resume'} after matching</span>
            </label>
            <button
              onClick={() => handleActionClick('Match + Save')}
              className="text-purple-400 hover:text-purple-300 underline font-semibold cursor-pointer transition"
            >
              Match + Save
            </button>
          </div>
        </div>
      )}



      {/* ---------------------------------------------------- */}
      {/* 6. FULL-SCREEN PROCESSING STATE CHECKLIST OVERLAY */}
      {/* ---------------------------------------------------- */}
      {isProcessing && (
        <div className="fixed inset-0 z-50 bg-[#08060e]/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 animate-fadeIn">
          <div className="max-w-md w-full flex flex-col items-center text-center space-y-8 animate-scaleUp">
            
            {/* Circular Glowing Central AI Icon */}
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-purple-900/60 via-purple-600/30 to-violet-500/20 border-2 border-purple-500/50 flex items-center justify-center text-purple-300 ai-engine-glow">
                <Zap className="w-10 h-10 fill-purple-400 text-purple-300 animate-bounce" />
              </div>
              <div className="absolute -inset-2 rounded-full border border-purple-500/20 animate-spin" style={{ animationDuration: '6s' }} />
            </div>

            {/* Title Headers */}
            <div className="space-y-1">
              <span className="text-[11px] font-bold text-purple-400 uppercase tracking-widest">
                SYNTRA AI ENGINE
              </span>
              <h2 className="text-2xl font-extrabold text-white tracking-tight">
                Analyzing your input
              </h2>
            </div>

            {/* Checklist Box */}
            <div className="w-full space-y-3.5 text-left bg-white/5 p-6 rounded-2xl border border-white/10">
              {stepsList.map((step, idx) => {
                const isDone = idx < currentStepIndex;
                const isCurrent = idx === currentStepIndex;

                return (
                  <div key={step} className="flex items-center gap-3 transition-all duration-300">
                    {isDone ? (
                      <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    ) : isCurrent ? (
                      <div className="w-5 h-5 rounded-full text-purple-400 flex items-center justify-center shrink-0">
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-white/20 shrink-0" />
                    )}

                    <span
                      className={`text-sm font-medium ${
                        isDone
                          ? 'text-emerald-300'
                          : isCurrent
                          ? 'text-purple-200 font-semibold'
                          : 'text-slate-500'
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Footstep Indicator */}
            <div className="text-xs text-slate-400 font-mono">
              Step {Math.min(currentStepIndex + 1, stepsList.length)} of {stepsList.length}
            </div>
          </div>
        </div>
      )}
      {/* Review Failed File Modal */}
      {reviewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="glass-card max-w-md w-full p-6 rounded-2xl border border-red-500/30 space-y-6 relative animate-scaleUp">
            {/* Top red line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500 via-red-400 to-red-500/30" />
            
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Review Processing Failure</h3>
                <span className="inline-block mt-1 px-2.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-semibold">
                  Needs Review
                </span>
              </div>
              <button
                onClick={() => setReviewFile(null)}
                className="p-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-left">
              <div className="space-y-1">
                <span className="text-slate-400 font-medium">File Name</span>
                <div className="font-semibold text-slate-200 break-all">{reviewFile.name}</div>
              </div>
            </div>
            
            <div className="p-4 rounded-xl bg-red-950/30 border border-red-900/50">
              <p className="text-sm text-slate-300 whitespace-pre-wrap font-mono">
                {reviewFile.error || "An unknown error occurred during AI processing."}
              </p>
            </div>
            
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setReviewFile(null)}
                disabled={reviewFile.isRetrying}
                className="px-5 py-2.5 rounded-xl text-slate-300 font-bold hover:bg-white/5 transition"
              >
                Close
              </button>
              <button
                onClick={() => handleRetry(reviewFile.resumeId, reviewFile.jobId, reviewFile.index)}
                disabled={reviewFile.isRetrying}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold transition flex items-center gap-2 cursor-pointer"
              >
                {reviewFile.isRetrying ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Retrying...</>
                ) : (
                  <><RefreshCw className="w-4 h-4" /> Retry Parsing</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1e1338] text-white px-5 py-3 rounded-xl shadow-2xl border border-purple-500/40 font-medium text-sm flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <AlertCircle className="w-4 h-4 text-purple-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
