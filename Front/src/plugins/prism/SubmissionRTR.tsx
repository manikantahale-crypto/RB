import React, { useState, useMemo, useEffect, useRef } from 'react';
import { apiFetch } from '../../services/api'; // fallback if apiFetch is there, else adjust
import { TemplateDesign } from './ResumeTemplates';
import { NavigationContext } from '../../types';
import { buildCanonicalConsentEmail } from '../../utils/consentEmailTemplate';
import {
  User,
  Building2,
  Clock,
  Mail,
  ThumbsUp,
  ThumbsDown,
  XCircle,
  CheckCircle2,
  Eye,
  Send,
  Search,
  Filter,
  ArrowUpDown,
  ChevronDown,
  MapPin,
  Phone,
  Edit3,
  Download,
  FileSpreadsheet,
  FileText,
  File,
  Trash2,
  ChevronRight,
  UploadCloud,
  Info,
  AlertCircle,
  Save,
  Star,
  ClipboardCheck,
  Loader2,
  DollarSign,
  Calendar
} from 'lucide-react';
import { SubmissionPreviewModal, TabType as PreviewModalTabType } from './SubmissionPreviewModal';
import { VendorSubmissionModal, VendorSubmissionContent, CandidateSubmissionSidebarContent, RTRPreviewContent } from './VendorSubmissionModal';

export const AvailabilityBadge = ({ availability }: { availability: string }) => {
  let colorClass = '';
  let dotClass = '';

  const lower = availability.toLowerCase();

  if (lower.includes('immediate')) {
    colorClass = 'bg-emerald-950/40 border-emerald-800/60 text-slate-200';
    dotClass = 'bg-emerald-500';
  } else if (lower.includes('week')) {
    colorClass = 'bg-amber-950/40 border-amber-700/50 text-slate-200';
    dotClass = 'bg-amber-500';
  } else {
    colorClass = 'bg-blue-950/40 border-blue-800/60 text-slate-200';
    dotClass = 'bg-blue-500';
  }

  return (
    <span className={`px-2.5 py-1 rounded-lg border font-bold text-[11px] inline-flex items-center gap-2 shadow-sm ${colorClass}`}>
      <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      {availability}
    </span>
  );
};





export interface SubmissionRecord {
  id: string;
  candidateName: string;
  jobDescription: string;
  rtrStatus: string;
  consentStatus?: string;
  candidateResponse: string;
  availability: string;
  payRate: string;
  submissionStatus: string;
  updatedAt: number;
  rateValue: number;
  resumeValid?: boolean;
  vendorName?: string;
  vendorContactName?: string;
  vendorLocation?: string;
  vendorEmail?: string;
  vendorPhone?: string;
  vendorReviewed?: boolean;
  vendorPriority?: string;
  candidateEmail?: string;
  candidatePhone?: string;
  candidateTitle?: string;
  candidateId?: string;
  candidateExperience?: string;
  candidateWorkAuth?: string;
  candidateLocation?: string;
  jobId?: string;
  clientName?: string;
  jobLocation?: string;
  contractType?: string;
  vendorId?: string;
  vendorStatus?: string;
  brief?: string;
  relocation?: string;
  linkedinProfile?: string;
  candidateValidationResults?: any;
  vendorValidationResults?: any;
  maskedProfile?: any;
  interviewDetails?: any;
  consent?: any;
  rtr?: any;
  recruiterLabel?: string | null;
  lastConsentSentAt?: string | null;
  consentResendCount?: number;
  maxConsentResends?: number;
  nextConsentResendAt?: string | null;
  canResendConsent?: boolean;
  confirmationData?: any;
  consultantConfirmation?: { status: string; sentAt?: string; respondedAt?: string; messageId?: string; notes?: string };
  vendorConfirmation?: { status: string; sentAt?: string; respondedAt?: string; messageId?: string; notes?: string };
  canInitiateRTR?: boolean;
}



type TabType = 'All' | 'Draft' | 'RTR Pending' | 'Validation Required' | 'Ready for Submission' | 'Submitted' | 'Rejected';

export interface SubmissionRTRProps {
  navigationContext?: NavigationContext | null;
  onClearNavigation?: () => void;
}

export const SubmissionRTR: React.FC<SubmissionRTRProps> = ({ navigationContext, onClearNavigation }) => {
  const [records, setRecords] = useState<SubmissionRecord[]>(() => {
    try {
      const cached = sessionStorage.getItem('syntra.prism.records.v1');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [vendorsList, setVendorsList] = useState<any[]>([]);
  const [candidatesList, setCandidatesList] = useState<any[]>([]);
  const [jobsList, setJobsList] = useState<{ id: string; title: string }[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('all');
  const [isJobDropdownOpen, setIsJobDropdownOpen] = useState(false);
  const [isListLoading, setIsListLoading] = useState(true);
  const vendorsLoadedRef = useRef(false);
  const fetchInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const pendingNavRef = useRef<NavigationContext | null>(null);

  const persistRecords = (next: SubmissionRecord[]) => {
    setRecords(next);
    try {
      sessionStorage.setItem('syntra.prism.records.v1', JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  };

  const fetchRecords = async () => {
    if (fetchInFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    fetchInFlightRef.current = true;
    try {
      const [res, vendorsRes] = await Promise.all([
        apiFetch('/submissions?include=details'),
        vendorsLoadedRef.current ? Promise.resolve(null) : apiFetch('/vendors').catch(() => null),
      ]);

      if (!res.ok) {
        console.error('[submissions] list failed', res.status);
        return;
      }

      const payload = await res.json().catch(() => ({}));
      const enrichedData = payload.data || [];

      if (!vendorsLoadedRef.current && vendorsRes && vendorsRes.ok) {
        const dbVendors = (await vendorsRes.json()).data || [];
        const uniqueVendors = new Map();
        dbVendors.forEach((v: any) => {
          if (v.id && v.name) uniqueVendors.set(v.id, v);
        });
        enrichedData.forEach((s: any) => {
          if (s.vendor?.id && s.vendor?.name) uniqueVendors.set(s.vendor.id, s.vendor);
        });
        setVendorsList(Array.from(uniqueVendors.values()));
        vendorsLoadedRef.current = true;
      }

      const enriched = enrichedData.map((sub: any) => {
        const rawConsent = Array.isArray(sub.consent) && sub.consent.length > 0
          ? sub.consent[0]
          : (sub.consent || null);

        const consentStatus = rawConsent?.status || (sub.status === 'DRAFT' ? 'Request' : 'Pending');

        let candidateResponse = 'Pending';
        if (consentStatus === 'APPROVED') candidateResponse = 'Accepted';
        else if (consentStatus === 'REJECTED') candidateResponse = 'Declined';

        return {
          id: sub.id,
          candidateName: sub.candidate?.fullName || 'Unknown Candidate',
          candidateEmail: sub.candidate?.email || 'Not specified',
          candidatePhone: sub.candidate?.phone || 'Not specified',
          candidateLocation: sub.candidate?.location || 'Not specified',
          candidateWorkAuth: sub.candidate?.immigrationStatus || 'Not specified',
          candidateExperience: sub.candidate?.totalExperience ? `${sub.candidate.totalExperience} Years` : 'Not specified',
          jobDescription: sub.job?.title || 'Unknown Job',
          vendorName: sub.vendor?.name || 'Not specified',
          rtrStatus: sub.rtr?.status === 'SIGNED' ? 'Approved' : sub.rtr?.status === 'DECLINED' ? 'Rejected' : (sub.rtr?.status || 'Pending'),
          consentStatus,
          candidateResponse,
          availability: sub.availability || 'Not specified',
          payRate: sub.rate ? `$${sub.rate}/${sub.rateType === 'HOURLY' || sub.rate_type === 'HOURLY' ? 'hr' : 'yr'}` : 'Not specified',
          submissionStatus: sub.status,
          updatedAt: new Date(sub.updatedAt || sub.updated_at || Date.now()).getTime(),
          rateValue: Number(sub.rate) || 0,
          resumeValid: Boolean(sub.resumeValid),
          candidateId: sub.candidateId || sub.candidate_id,
          jobId: sub.jobId || sub.job_id,
          clientName: sub.job?.companyName || sub.job?.company_name || 'Not specified',
          jobLocation: sub.job?.location || 'Not specified',
          contractType: sub.job?.employmentType || sub.job?.employment_type || 'C2C',
          requiredSkills: sub.job?.requiredSkills || sub.job?.required_skills || 'As per job requirements',
          vendorId: sub.vendor?.id || sub.vendor_id || sub.vendorId,
          vendorStatus: sub.vendor?.status || 'Not specified',
          vendorContactName: sub.vendor?.contact_name || sub.vendor?.name || 'Not specified',
          vendorEmail: sub.vendor?.email || 'Not specified',
          vendorPhone: sub.vendor?.phone || 'Not specified',
          vendorLocation: sub.vendor?.location || 'Not specified',
          candidateValidationResults: sub.candidateValidationResults || sub.candidate_validation_results || null,
          vendorValidationResults: sub.vendorValidationResults || sub.vendor_validation_results || null,
          maskedProfile: sub.maskedProfile || sub.masked_profile || null,
          interviewDetails: sub.interviewDetails || sub.interview_details || null,
          consent: rawConsent,
          rtr: sub.rtr || null,
          recruiterLabel: sub.recruiterLabel || sub.recruiter_label || null,
          lastConsentSentAt: sub.lastConsentSentAt || sub.last_consent_sent_at || null,
          consentResendCount: Number(sub.consentResendCount ?? sub.consent_resend_count ?? 0),
          maxConsentResends: Number(sub.maxConsentResends || 3),
          nextConsentResendAt: sub.nextConsentResendAt || sub.next_consent_resend_at || null,
          canResendConsent: Boolean(sub.canResendConsent),
          confirmationData: sub.confirmationData || sub.confirmation_data || null,
          consultantConfirmation: sub.consultantConfirmation || sub.confirmationData?.consultantConfirmation || { status: 'PENDING' },
          vendorConfirmation: sub.vendorConfirmation || sub.confirmationData?.vendorConfirmation || { status: 'PENDING' },
          canInitiateRTR: Boolean(sub.canInitiateRTR),
        };
      });
      persistRecords(enriched);

      const uniqueCandidates = new Map();
      enrichedData.forEach((s: any) => {
        if (s.candidate?.id) uniqueCandidates.set(s.candidate.id, s.candidate);
      });
      setCandidatesList(Array.from(uniqueCandidates.values()));

      const uniqueJobs = new Map();
      enrichedData.forEach((s: any) => {
        if (s.job?.id && s.job?.title) {
          uniqueJobs.set(s.job.id, { id: s.job.id, title: s.job.title });
        }
      });
      setJobsList(Array.from(uniqueJobs.values()));
    } catch (err: any) {
      console.error(err);
    } finally {
      fetchInFlightRef.current = false;
      setIsListLoading(false);
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        fetchRecords();
      }
    }
  };

  useEffect(() => {
    fetchRecords();
    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchRecords();
    }, 30000);
    return () => clearInterval(interval);
  }, []);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [consentModalId, setConsentModalId] = useState<string | null>(null);
  const [selectedContractType, setSelectedContractType] = useState<string>('C2C');
  const [sendingConsentId, setSendingConsentId] = useState<string | null>(null);
  const [vendorModalId, setVendorModalId] = useState<string | null>(null);
  const [detailsModalId, setDetailsModalId] = useState<string | null>(null);
  const [vendorSubmissionModalId, setVendorSubmissionModalId] = useState<string | null>(null);
  const [confirmationModalId, setConfirmationModalId] = useState<string | null>(null);
  const [confirmationPreviewTarget, setConfirmationPreviewTarget] = useState<'consultant' | 'vendor' | null>(null);
  const [confirmationPreviewData, setConfirmationPreviewData] = useState<{ subject: string; body: string } | null>(null);
  const [confirmationPreviewLoading, setConfirmationPreviewLoading] = useState<boolean>(false);
  const [detailsModalTab, setDetailsModalTab] = useState<PreviewModalTabType>('Overview');
  const [candidateModalId, setCandidateModalId] = useState<string | null>(null);
  const [resumeModalId, setResumeModalId] = useState<string | null>(null);
  const [interviewModalId, setInterviewModalId] = useState<string | null>(null);
  const [interviewForm, setInterviewForm] = useState<{
    scheduledAt: string;
    interviewType: string;
    round: number;
    meetingLink: string;
    notes: string;
  }>({
    scheduledAt: '',
    interviewType: 'Technical Round',
    round: 1,
    meetingLink: '',
    notes: ''
  });
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [resumeModalTab, setResumeModalTab] = useState<'Upload Resume' | 'Vendor Submission Preview' | 'RTR Preview' | 'Candidate & Submission'>('Upload Resume');
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    { type: 'CLOSE' } | { type: 'NAVIGATE'; tab: 'Upload Resume' | 'Vendor Submission Preview' | 'RTR Preview' | 'Candidate & Submission' } | null
  >(null);

  const handleAttemptAction = (action: { type: 'CLOSE' } | { type: 'NAVIGATE'; tab: 'Upload Resume' | 'Vendor Submission Preview' | 'RTR Preview' | 'Candidate & Submission' }) => {
    if (isDirty) {
      setPendingAction(action);
      setShowUnsavedModal(true);
    } else {
      executeAction(action);
    }
  };

  const executeAction = (action: { type: 'CLOSE' } | { type: 'NAVIGATE'; tab: any }) => {
    if (action.type === 'CLOSE') {
      setResumeModalId(null);
      setIsDirty(false);
    } else if (action.type === 'NAVIGATE') {
      setResumeModalTab(action.tab);
    }
  };

  const handleSaveDraftChanges = async () => {
    const activeSub = records.find(r => r.id === resumeModalId);
    if (activeSub) {
      try {
        await apiFetch(`/submissions/${activeSub.id}/rate-availability`, {
          method: 'PATCH',
          body: JSON.stringify({
            rate: activeSub.rateValue || null,
            rateType: 'HOURLY',
            availability: activeSub.availability || 'Immediate'
          })
        });
      } catch (e) {
        console.error('Failed to save draft:', e);
      }
    }
    setIsDirty(false);
    setShowUnsavedModal(false);
    if (pendingAction) {
      executeAction(pendingAction);
      setPendingAction(null);
    }
  };

  const handleDiscardChanges = () => {
    setIsDirty(false);
    setShowUnsavedModal(false);
    if (pendingAction) {
      executeAction(pendingAction);
      setPendingAction(null);
    }
  };
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [editModalId, setEditModalId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SubmissionRecord>>({});
  const [activeTab, setActiveTab] = useState<TabType>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVendor, setSelectedVendor] = useState('All Vendors');

  useEffect(() => {
    if (!navigationContext) return;
    pendingNavRef.current = { ...navigationContext };
    setActiveTab((navigationContext.prismTab as TabType) || 'All');
    if (navigationContext.jobId) {
      setSelectedJobId(navigationContext.jobId);
    }
    onClearNavigation?.();
  }, [navigationContext, onClearNavigation]);

  useEffect(() => {
    const pending = pendingNavRef.current;
    if (!pending) return;
    const match = records.find((r) =>
      (pending.submissionId && r.id === pending.submissionId) ||
      (pending.candidateId && r.candidateId === pending.candidateId && (!pending.jobId || r.jobId === pending.jobId)),
    );
    if (match) {
      if (pending.openSubmission) {
        setDetailsModalTab('Overview');
        setDetailsModalId(match.id);
      }
      pendingNavRef.current = null;
      return;
    }
    if (!isListLoading) {
      pendingNavRef.current = null;
    }
  }, [records, isListLoading]);
  const [isVendorDropdownOpen, setIsVendorDropdownOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState('Last Updated (Newest)');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [activeSortSubmenu, setActiveSortSubmenu] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [rejectionModalId, setRejectionModalId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [deleteModalId, setDeleteModalId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [resumeHistory, setResumeHistory] = useState<any[]>([]);
  const [previewingResume, setPreviewingResume] = useState<any>(null);

  useEffect(() => {
    if (resumeModalId) {
      const activeRecord = records.find(r => r.id === resumeModalId);
      if (activeRecord) {
        const candidateBase = (activeRecord.candidateName || 'Candidate').replace(/[^a-zA-Z0-9]/g, '_');
        setResumeHistory([
          {
            id: 'current-resume',
            version: 'v1.0',
            name: `${candidateBase}_Resume.pdf`,
            size: '2.4 MB',
            uploader: 'Recruiter',
            date: new Date(activeRecord.updatedAt || Date.now()).toLocaleDateString(),
            isCurrent: true,
          }
        ]);
      }
    }
  }, [resumeModalId, records]);

  const handleDownloadResume = (resume: any) => {
    if (resume?.fileObj) {
      const url = URL.createObjectURL(resume.fileObj);
      const a = document.createElement('a');
      a.href = url;
      a.download = resume.name;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const blob = new Blob(["Resume text summary"], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (resume?.name || 'resume').replace('.pdf', '.txt');
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, selectedJobId, selectedVendor, sortOrder]);

  // --- Filter the data based on selected criteria ---
  const filteredData = useMemo(() => {
    return records.filter((record) => {
      // 1. Tab Filter
      if (activeTab === 'Ready for Submission' && record.submissionStatus !== 'READY') return false;
      if (activeTab === 'RTR Pending' && !['MASKED', 'VENDOR_SUBMITTED', 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED'].includes(record.submissionStatus)) return false;
      if (activeTab === 'Submitted' && record.submissionStatus !== 'SUBMITTED') return false;
      if (activeTab === 'Draft' && record.submissionStatus !== 'DRAFT') return false;
      if (activeTab === 'Validation Required' && !['PENDING_CONSENT', 'CONSENT_REJECTED', 'CANDIDATE_VALIDATED'].includes(record.submissionStatus)) return false;
      if (activeTab === 'Rejected' && !['REJECTED', 'WITHDRAWN', 'CONSENT_REJECTED'].includes(record.submissionStatus)) return false;

      // 2. Search Filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          record.candidateName.toLowerCase().includes(query) ||
          record.jobDescription.toLowerCase().includes(query) ||
          record.id.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // 3. JOB DESCRIPTION Filter
      if (selectedJobId !== 'all' && record.jobId !== selectedJobId) {
        return false;
      }

      // 4. VENDOR Filter
      if (selectedVendor !== 'All Vendors' && record.vendorName !== selectedVendor) {
        return false;
      }
      if (sortOrder.startsWith('Availability:')) {
        const availLower = record.availability.toLowerCase();
        if (sortOrder === 'Availability: Immediately' && !availLower.includes('immediate')) return false;
        if (sortOrder === 'Availability: In 1 week' && !availLower.includes('1 week') && !availLower.includes('week notice')) return false;
        if (sortOrder === 'Availability: In 1 month' && !availLower.includes('1 month') && !availLower.includes('4 weeks') && !availLower.includes('unavailable')) return false;
        if (sortOrder === 'Availability: Other' && (availLower.includes('immediate') || availLower.includes('1 week') || availLower.includes('week notice') || availLower.includes('1 month') || availLower.includes('4 weeks') || availLower.includes('unavailable'))) return false;
      }

      return true;
    });
  }, [activeTab, searchQuery, selectedJobId, selectedVendor, sortOrder, records]);

  // --- Sort the filtered data ---
  const sortedData = useMemo(() => {
    const data = [...filteredData];

    switch (sortOrder) {
      case 'Payrate: High to Low':
        return data.sort((a, b) => b.rateValue - a.rateValue);
      case 'Payrate: Low to High':
        return data.sort((a, b) => a.rateValue - b.rateValue);
      default:
        return data.sort((a, b) => b.updatedAt - a.updatedAt);
    }
  }, [filteredData, sortOrder]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedData.slice(start, start + itemsPerPage);
  }, [sortedData, currentPage]);

  // --- Tab Counts ---
  const tabCounts = useMemo(() => {
    return {
      'All': records.length,
      'Draft': records.filter(r => r.submissionStatus === 'DRAFT').length,
      'RTR Pending': records.filter(r => ['MASKED', 'VENDOR_SUBMITTED', 'VENDOR_ACCEPTED', 'VENDOR_VALIDATED', 'AVAILABILITY_CONFIRMED', 'RATE_CONFIRMED', 'PENDING_RTR', 'RTR_CONFIRMED', 'INTERVIEW_SCHEDULED'].includes(r.submissionStatus)).length,
      'Validation Required': records.filter(r => ['PENDING_CONSENT', 'CONSENT_REJECTED', 'CANDIDATE_VALIDATED'].includes(r.submissionStatus)).length,
      'Ready for Submission': records.filter(r => r.submissionStatus === 'READY').length,
      'Submitted': records.filter(r => r.submissionStatus === 'SUBMITTED').length,
      'Rejected': records.filter(r => ['REJECTED', 'WITHDRAWN', 'CONSENT_REJECTED'].includes(r.submissionStatus)).length,
    };
  }, [records]);

  // --- Row Selection Logic ---
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allIds = sortedData.map(r => r.id);
      setSelectedRowIds(new Set(allIds));
    } else {
      setSelectedRowIds(new Set());
    }
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`Are you sure you want to delete/withdraw ${selectedRowIds.size} selected submissions?`)) {
      const idsToProcess = Array.from(selectedRowIds);
      let deletedCount = 0;
      let withdrawnCount = 0;
      let skippedCount = 0;
      let failCount = 0;

      for (const id of idsToProcess) {
        const record = records.find(r => r.id === id);
        const status = record?.submissionStatus;

        if (!record || status === 'WITHDRAWN' || status === 'REJECTED') {
          skippedCount++;
          continue;
        }

        if (status === 'DRAFT') {
          try {
            const res = await apiFetch(`/submissions/${id}`, { method: 'DELETE' });
            if (res.ok) {
              deletedCount++;
            } else {
              failCount++;
            }
          } catch (e) {
            failCount++;
          }
        } else {
          try {
            const res = await apiFetch(`/submissions/${id}/status`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'WITHDRAWN', reason: 'Bulk withdrawal' })
            });
            if (res.ok) {
              withdrawnCount++;
            } else {
              failCount++;
            }
          } catch (e) {
            failCount++;
          }
        }
      }

      alert(`Bulk action complete. Deleted Drafts: ${deletedCount}, Withdrawn Active: ${withdrawnCount}, Skipped Terminal: ${skippedCount}, Failed: ${failCount}`);
      setSelectedRowIds(new Set());
      await fetchRecords();
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedRowIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const getRtrBadgeStyle = (status: string) => {
    switch (status) {
      case 'Approved':
      case 'SIGNED':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'Pending':
      case 'SENT':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'Rejected':
      case 'DECLINED':
      case 'Expired':
        return 'bg-red-500/15 text-red-300 border-red-500/30';
      default:
        return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
    }
  };

  const getResponseBadgeStyle = (response: string) => {
    switch (response) {
      case 'Accepted':
      case 'ACCEPTED':
      case 'APPROVED':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'Pending':
      case 'REQUESTED':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'Declined':
      case 'REJECTED':
        return 'bg-red-500/15 text-red-300 border-red-500/30';
      default:
        return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
    }
  };

  useEffect(() => {
    if (editModalId) {
      const record = records.find(r => r.id === editModalId);
      if (record) setEditForm(record);
    }
  }, [editModalId, records]);

  const handleSaveEdit = async () => {
    if (!editModalId) return;
    try {
      const res = await apiFetch(`/submissions/${editModalId}/rate-availability`, {
        method: 'PATCH',
        body: JSON.stringify({
          rate: editForm.payRate ? editForm.payRate.replace(/[^0-9.]/g, '') : null,
          rateType: editForm.payRate && editForm.payRate.includes('/yr') ? 'ANNUAL' : 'HOURLY',
          availability: editForm.availability || 'Immediate'
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert('Failed to update rate & availability: ' + (err.message || err.error || 'Unknown error'));
        return;
      }
      setEditModalId(null);
      await fetchRecords();
    } catch (err: any) {
      alert('Error updating rate & availability: ' + err.message);
    }
  };

  // =========================================================================
  // BUSINESS-LEVEL ACTION DROPDOWN
  // These map recruiter-facing labels to the existing PRISM backend workflow.
  // The 17-state PRISM state machine is NOT modified.
  // =========================================================================
  type BusinessAction =
    | 'Edit Details'
    | 'Edit Rate / Avail'
    | 'RTR Preview'
    | 'Schedule Interview'
    | 'Selected'
    | 'Under Review'
    | 'Submitted'
    | 'Rejected'
    | 'Delete'
    | 'Confirm Rate & Availability'
    | 'Initiate RTR'
    | 'Record RTR Signed'
    | 'Record RTR Declined';

  const getMissingPrerequisitesReason = (record: SubmissionRecord): string => {
    const status = record.submissionStatus;

    if (status === 'DRAFT') {
      return 'Submission is in Draft. Required workflow gates remaining:\n• Candidate Consent\n• Vendor Validation\n• Rate/Availability Confirmation\n• Right to Represent (RTR) Agreement';
    }

    if (status === 'PENDING_CONSENT') {
      return 'Awaiting Candidate Consent approval before proceeding to client submission.';
    }

    if (status === 'CONSENT_REJECTED') {
      return 'Candidate Consent request was rejected by the candidate.';
    }

    if (status === 'CANDIDATE_VALIDATED' || status === 'MASKED') {
      return 'Required workflow gates remaining:\n• Vendor Submission & Validation\n• Rate/Availability Confirmation\n• Right to Represent (RTR) Agreement';
    }

    if (status === 'VENDOR_SUBMITTED' || status === 'VENDOR_ACCEPTED') {
      return 'Required workflow gates remaining:\n• Vendor Validation\n• Rate/Availability Confirmation\n• Right to Represent (RTR) Agreement';
    }

    if (status === 'VENDOR_VALIDATED') {
      return 'Required workflow gates remaining:\n• Rate/Availability Confirmation\n• Right to Represent (RTR) Agreement';
    }

    if (status === 'AVAILABILITY_CONFIRMED' || status === 'RATE_CONFIRMED') {
      return 'Required workflow gate remaining:\n• Right to Represent (RTR) Agreement confirmation';
    }

    if (status === 'PENDING_RTR') {
      return 'Awaiting Right to Represent (RTR) agreement confirmation.';
    }

    if (['SUBMITTED', 'REJECTED', 'WITHDRAWN'].includes(status)) {
      return `Submission is already in terminal state '${status}'.`;
    }

    return `Submission must reach READY state before client submission (current status: ${status}).`;
  };

  const getBusinessActions = (record: SubmissionRecord): { label: BusinessAction; icon: React.ReactNode; destructive?: boolean; disabled?: boolean; disabledReason?: string }[] => {
    const status = record.submissionStatus;
    const isTerminal = ['SUBMITTED', 'REJECTED', 'WITHDRAWN'].includes(status);

    const actions: { label: BusinessAction; icon: React.ReactNode; destructive?: boolean; disabled?: boolean; disabledReason?: string }[] = [];

    // All actions remain visually available and clickable where workflow permits.
    // Meaningful tooltips explain current status requirements.

    // 1. Edit Rate & Availability
    actions.push({
      label: 'Edit Rate / Avail',
      icon: <DollarSign className="w-3.5 h-3.5" />,
      disabled: isTerminal,
      disabledReason: isTerminal
        ? 'Cannot edit rate for terminal submissions.'
        : 'Edit rate and availability details'
    });

    // 2. RTR Preview
    actions.push({
      label: 'RTR Preview',
      icon: <FileText className="w-3.5 h-3.5" />,
      disabled: isTerminal,
      disabledReason: isTerminal ? 'Cannot view RTR for terminal submissions.' : undefined
    });

    // 3. Schedule Interview
    actions.push({
      label: 'Schedule Interview',
      icon: <Calendar className="w-3.5 h-3.5" />,
      disabled: isTerminal,
      disabledReason: isTerminal ? 'Cannot schedule interview for terminal submissions.' : undefined
    });

    // 4. Selected
    actions.push({
      label: 'Selected',
      icon: <Star className="w-3.5 h-3.5" />,
      disabled: false,
      disabledReason: isTerminal ? 'Cannot modify recruiter triage label on terminal submissions.' : 'Mark candidate as Selected'
    });

    // 5. Under Review
    actions.push({
      label: 'Under Review',
      icon: <ClipboardCheck className="w-3.5 h-3.5" />,
      disabled: false,
      disabledReason: isTerminal ? 'Cannot modify recruiter triage label on terminal submissions.' : 'Toggle Under Review triage label'
    });

    // 6. Submitted
    actions.push({
      label: 'Submitted',
      icon: <Send className="w-3.5 h-3.5" />,
      disabled: false,
      disabledReason: status === 'READY' ? 'Submit candidate to client' : getMissingPrerequisitesReason(record)
    });

    // 7. Rejected / Withdraw (ONLY shown for non-terminal active submissions)
    if (!isTerminal) {
      actions.push({
        label: 'Rejected',
        icon: <XCircle className="w-3.5 h-3.5" />,
        destructive: true,
        disabled: false,
        disabledReason: 'Reject or withdraw submission'
      });
    }

    // 8. Delete (available only for DRAFT submissions)
    actions.push({
      label: 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      destructive: true,
      disabled: status !== 'DRAFT',
      disabledReason: status !== 'DRAFT'
        ? 'Only DRAFT submissions can be deleted.'
        : 'Delete draft submission'
    });

    // 9. Confirm Rate & Availability
    actions.push({
      label: 'Confirm Rate & Availability',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />,
      disabled: false,
      disabledReason: 'Manage consultant & vendor availability and rate confirmations'
    });

    // 10. Record RTR Signed / Declined (available when PENDING_RTR)
    if (status === 'PENDING_RTR') {
      actions.push({
        label: 'Record RTR Signed',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
        disabled: false,
        disabledReason: 'Mark Right to Represent (RTR) as signed and confirmed'
      });

      actions.push({
        label: 'Record RTR Declined',
        icon: <XCircle className="w-3.5 h-3.5 text-red-400" />,
        destructive: true,
        disabled: false,
        disabledReason: 'Mark Right to Represent (RTR) as declined and reject submission'
      });
    }


    return actions;
  };

  const handleBusinessAction = async (id: string, action: BusinessAction) => {
    setOpenActionId(null);
    const record = records.find(r => r.id === id);
    if (!record) return;

    const status = record.submissionStatus;
    const isTerminal = ['SUBMITTED', 'REJECTED', 'WITHDRAWN'].includes(status);

    try {
      switch (action) {
        case 'Edit Rate / Avail': {
          if (isTerminal) {
            alert(`Cannot edit rate/availability on a terminal submission (status: ${status}).`);
            return;
          }

          setEditModalId(id);
          break;
        }
        case 'RTR Preview': {
          setResumeModalTab('RTR Preview');
          setResumeModalId(id);
          break;
        }
        case 'Schedule Interview': {
          setInterviewModalId(id);
          break;
        }
        case 'Selected': {
          if (isTerminal) {
            alert(`Cannot modify recruiter label on a terminal submission (status: ${status}).`);
            return;
          }
          setActionLoading(id);
          const res = await apiFetch(`/submissions/${id}/label`, {
            method: 'PATCH',
            body: JSON.stringify({ label: 'SELECTED' })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert('Failed to mark as selected: ' + (err.message || err.error || 'Unknown error'));
          } else {
            await fetchRecords();
          }
          setActionLoading(null);
          break;
        }
        case 'Under Review': {
          if (isTerminal) {
            alert(`Cannot modify recruiter label on a terminal submission (status: ${status}).`);
            return;
          }
          setActionLoading(id);
          const newLabel = record.recruiterLabel === 'UNDER_REVIEW' ? null : 'UNDER_REVIEW';
          const res = await apiFetch(`/submissions/${id}/label`, {
            method: 'PATCH',
            body: JSON.stringify({ label: newLabel })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert('Failed to update review status: ' + (err.message || err.error || 'Unknown error'));
          } else {
            await fetchRecords();
          }
          setActionLoading(null);
          break;
        }
        case 'Submitted': {
          if (status !== 'READY') {
            const missingReason = getMissingPrerequisitesReason(record);
            alert(`Cannot Submit to Client Yet\n\n${missingReason}`);
            return;
          }
          setActionLoading(id);
          const res = await apiFetch(`/submissions/${id}/submit`, { method: 'POST' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert('Submission failed: ' + (err.message || err.error || 'Client submission could not be completed. Ensure all workflow gates are satisfied.'));
          } else {
            await fetchRecords();
          }
          setActionLoading(null);
          break;
        }
        case 'Rejected': {
          if (isTerminal && status !== 'CONSENT_REJECTED') {
            alert(`Submission is already in terminal state '${status}' and cannot be rejected again.`);
            return;
          }
          setRejectionReason('');
          setRejectionModalId(id);
          break;
        }
        case 'Delete': {
          if (status !== 'DRAFT') {
            alert('Only draft submissions can be deleted.\n\nActive submissions with candidate consent, vendor communications, or RTR agreements cannot be deleted to preserve compliance records.');
            return;
          }
          setDeleteModalId(id);
          break;
        }
        case 'Confirm Rate & Availability': {
          setConfirmationModalId(id);
          break;
        }
        case 'Initiate RTR': {
          if (!record.canInitiateRTR) {
            alert('RTR Initiation Blocked\n\nRTR cannot be initiated until both consultant and vendor confirm availability and rate.');
            return;
          }
          setActionLoading(id);
          const res = await apiFetch(`/submissions/${id}/rtr`, { method: 'POST' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert('Failed to initiate RTR: ' + (err.message || err.error || 'Both consultant and vendor confirmation required.'));
          } else {
            await fetchRecords();
            alert('RTR process successfully initiated!');
          }
          setActionLoading(null);
          break;
        }
        case 'Record RTR Signed': {
          if (window.confirm('Confirm RTR Signed?\n\nThis will mark the Right to Represent (RTR) as signed and transition the submission to RTR_CONFIRMED.')) {
            setActionLoading(id);
            const res = await apiFetch(`/submissions/${id}/rtr/status`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'SIGNED' })
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              alert('Failed to record RTR Signed: ' + (err.message || err.error || 'Unknown error'));
            } else {
              await fetchRecords();
              alert('RTR successfully recorded as Signed!');
            }
            setActionLoading(null);
          }
          break;
        }
        case 'Record RTR Declined': {
          if (window.confirm('Confirm RTR Declined?\n\nThis will mark the Right to Represent (RTR) as declined and reject the submission.')) {
            setActionLoading(id);
            const res = await apiFetch(`/submissions/${id}/rtr/status`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'DECLINED' })
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              alert('Failed to record RTR Declined: ' + (err.message || err.error || 'Unknown error'));
            } else {
              await fetchRecords();
              alert('RTR recorded as Declined.');
            }
            setActionLoading(null);
          }
          break;
        }
      }
    } catch (err: any) {
      alert('Action error: ' + err.message);
      setActionLoading(null);
    }
  };

  const handleConfirmRejection = async () => {
    if (!rejectionModalId) return;
    if (!rejectionReason.trim()) {
      alert('Please provide a rejection reason.');
      return;
    }
    setActionLoading(rejectionModalId);
    try {
      const record = records.find(r => r.id === rejectionModalId);
      const currentStatus = record?.submissionStatus || '';

      const targetStatus = (currentStatus === 'DRAFT' || currentStatus === 'CONSENT_REJECTED')
        ? 'WITHDRAWN'
        : 'REJECTED';

      const res = await apiFetch(`/submissions/${rejectionModalId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: targetStatus, reason: rejectionReason.trim() })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert('Failed to reject submission: ' + (err.message || err.error || 'Unknown error'));
      } else {
        await fetchRecords();
      }
    } catch (err: any) {
      alert('Rejection error: ' + err.message);
    } finally {
      setRejectionModalId(null);
      setRejectionReason('');
      setActionLoading(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalId) return;
    setActionLoading(deleteModalId);
    try {
      const res = await apiFetch(`/submissions/${deleteModalId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert('Failed to delete submission: ' + (err.message || err.error || 'Only DRAFT submissions can be deleted.'));
      } else {
        await fetchRecords();
      }
    } catch (err: any) {
      alert('Delete error: ' + err.message);
    } finally {
      setDeleteModalId(null);
      setActionLoading(null);
    }
  };

  const handleSendConsent = async (id: string) => {
    const snapshot = records.find((r) => r.id === id);
    persistRecords(
      records.map((r) =>
        r.id === id
          ? {
              ...r,
              consentStatus: 'REQUESTED',
              submissionStatus: 'PENDING_CONSENT',
              lastConsentSentAt: new Date().toISOString(),
              candidateResponse: r.candidateResponse === 'Accepted' ? r.candidateResponse : 'Pending',
            }
          : r,
      ),
    );
    setConsentModalId(null);
    setSendingConsentId(id);
    try {
      const res = await apiFetch(`/submissions/${id}/consent`, {
        method: 'POST',
        body: JSON.stringify({
          notes: 'Consent requested via PRISM portal',
          contractType: selectedContractType || 'C2C',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (snapshot) {
          persistRecords(records.map((r) => (r.id === id ? snapshot : r)));
        }
        alert('Failed to send consent request: ' + (err.message || err.error || 'Unknown error'));
        return;
      }
      await fetchRecords();
    } catch (err: any) {
      if (snapshot) {
        persistRecords(records.map((r) => (r.id === id ? snapshot : r)));
      }
      alert('Error sending consent request: ' + err.message);
    } finally {
      setSendingConsentId(null);
    }
  };

  const handleExport = (format: 'csv' | 'pdf' | 'word') => {
    const dataToExport = selectedRowIds.size > 0
      ? sortedData.filter(r => selectedRowIds.has(r.id))
      : sortedData;

    if (dataToExport.length === 0) {
      alert("No data to export.");
      return;
    }

    const headers = [
      'ID',
      'Candidate Name',
      'JOB DESCRIPTION Name',
      'Vendor Name',
      'RTR Status',
      'Candidate Response',
      'Availability',
      'Pay Rate',
      'Submission Status'
    ];
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const csvContent = [
        headers.join(','),
        ...dataToExport.map(r => [
          `"${r.id}"`,
          `"${r.candidateName}"`,
          `"${r.jobDescription}"`,
          `"${r.vendorName || 'Not specified'}"`,
          `"${r.rtrStatus}"`,
          `"${r.candidateResponse}"`,
          `"${r.availability}"`,
          `"${r.payRate}"`,
          `"${r.submissionStatus}"`
        ].join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `submissions_${timestamp}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } else if (format === 'pdf') {
      // PDF export currently disabled pending template generator
      return;

    } else if (format === 'word') {
      const htmlContent = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'><title>Export</title></head>
        <body>
          <h2>Submissions & RTR Export</h2>
          <table border="1" cellspacing="0" cellpadding="5">
            <thead>
              <tr style="background-color: #f2f2f2;">${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${dataToExport.map(r => `
                <tr>
                  <td>${r.id}</td><td>${r.candidateName}</td><td>${r.jobDescription}</td>
                  <td>${r.candidateResponse}</td><td>${r.rtrStatus}</td><td>${r.availability}</td>
                  <td>${r.payRate}</td><td>${r.submissionStatus}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
        </html>
      `;
      const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `submissions_${timestamp}.doc`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    setIsExportOpen(false);
  };

  const consentModalRecord = useMemo(() => records.find(r => r.id === consentModalId), [records, consentModalId]);
  const confirmationModalRecord = useMemo(() => records.find(r => r.id === confirmationModalId), [records, confirmationModalId]);

  useEffect(() => {
    if (!confirmationModalId || !confirmationPreviewTarget) {
      setConfirmationPreviewData(null);
      return;
    }
    let isMounted = true;
    const fetchConfirmationPreview = async () => {
      setConfirmationPreviewLoading(true);
      try {
        const res = await apiFetch(`/submissions/${confirmationModalId}/confirmation/${confirmationPreviewTarget}/preview`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted && json.data) {
            setConfirmationPreviewData(json.data);
          }
        }
      } catch {
        /* non-blocking */
      } finally {
        if (isMounted) setConfirmationPreviewLoading(false);
      }
    };
    fetchConfirmationPreview();
    return () => { isMounted = false; };
  }, [confirmationModalId, confirmationPreviewTarget]);

  useEffect(() => {
    if (!consentModalId) return;
    const rec = records.find((r) => r.id === consentModalId);
    if (rec) setSelectedContractType(rec.contractType || 'C2C');
  }, [consentModalId]);

  const consentPreview = useMemo(() => {
    if (!consentModalRecord) return null;
    return buildCanonicalConsentEmail({
      candidateName: consentModalRecord.candidateName,
      jobTitle: consentModalRecord.jobDescription,
      location: consentModalRecord.jobLocation,
      contractType: selectedContractType || consentModalRecord.contractType || 'C2C',
      immigrationStatus: consentModalRecord.candidateWorkAuth,
      requiredSkills: (consentModalRecord as any).requiredSkills,
    });
  }, [consentModalRecord, selectedContractType]);
  const vendorModalRecord = useMemo(() => records.find(r => r.id === vendorModalId), [records, vendorModalId]);
  const resumeModalRecord = useMemo(() => records.find(r => r.id === resumeModalId), [records, resumeModalId]);
  const detailsModalRecord = useMemo(() => records.find(r => r.id === detailsModalId), [records, detailsModalId]);
  const vendorSubmissionModalRecord = useMemo(() => records.find(r => r.id === vendorSubmissionModalId), [records, vendorSubmissionModalId]);
  const candidateModalRecord = useMemo(() => records.find(r => r.id === candidateModalId), [records, candidateModalId]);
  const activeCandidate = useMemo(() => candidatesList.find(c => c.id === candidateModalRecord?.candidateId), [candidatesList, candidateModalRecord]);

  const getSubmissionBadgeStyle = (status: string) => {
    switch (status) {
      case 'READY': return 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20';
      case 'SUBMITTED': return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
      case 'REJECTED':
      case 'CONSENT_REJECTED': return 'bg-red-500/15 text-red-300 border border-red-500/30';
      case 'PENDING_RTR':
      case 'PENDING_CONSENT':
      case 'VENDOR_SUBMITTED': return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
      case 'CANDIDATE_VALIDATED':
      case 'MASKED':
      case 'VENDOR_ACCEPTED':
      case 'VENDOR_VALIDATED':
      case 'AVAILABILITY_CONFIRMED':
      case 'RATE_CONFIRMED':
      case 'RTR_CONFIRMED':
      case 'INTERVIEW_SCHEDULED': return 'bg-purple-500/15 text-purple-300 border border-purple-500/30';
      case 'DRAFT':
      case 'WITHDRAWN':
      default: return 'bg-slate-500/15 text-slate-300 border border-slate-500/30';
    }
  };

  const getStatusDisplayText = (status: string, recruiterLabel?: string | null) => {
    // Show recruiter label if set (business-level view)
    if (recruiterLabel === 'SELECTED') return 'Selected';
    if (recruiterLabel === 'UNDER_REVIEW') return 'Under Review';
    switch (status) {
      case 'DRAFT': return 'Draft';
      case 'PENDING_CONSENT': return 'Validation Required';
      case 'CONSENT_REJECTED': return 'Consent Declined';
      case 'CANDIDATE_VALIDATED': return 'Candidate Validated';
      case 'MASKED': return 'Masked';
      case 'VENDOR_SUBMITTED': return 'Vendor Submitted';
      case 'VENDOR_ACCEPTED': return 'Vendor Accepted';
      case 'VENDOR_VALIDATED': return 'Vendor Validated';
      case 'AVAILABILITY_CONFIRMED': return 'Availability Confirmed';
      case 'RATE_CONFIRMED': return 'Rate Confirmed';
      case 'PENDING_RTR': return 'RTR Pending';
      case 'RTR_CONFIRMED': return 'RTR Confirmed';
      case 'INTERVIEW_SCHEDULED': return 'Interview Scheduled';
      case 'READY': return 'Ready (Submit)';
      case 'SUBMITTED': return 'Submitted';
      case 'REJECTED': return 'Rejected';
      case 'WITHDRAWN': return 'Withdrawn';
      default: return status;
    }
  };

  const getRecruiterLabelBadgeStyle = (label: string | null | undefined) => {
    if (label === 'SELECTED') return 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30';
    if (label === 'UNDER_REVIEW') return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
    return '';
  };

  const renderTab = (name: TabType) => {
    const isActive = activeTab === name;
    return (
      <button
        onClick={() => setActiveTab(name)}
        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${isActive
          ? 'bg-[#9333ea] text-white'
          : 'text-slate-400 hover:text-slate-200 font-medium'
          }`}
      >
        {name} ({tabCounts[name]})
      </button>
    );
  };

  return (
    <div className="p-6 md:p-8 space-y-5 max-w-[1600px] w-full mx-auto font-sans h-full min-h-0 flex flex-col overflow-hidden">
      {/* HEADER & FILTERS */}
      <div className="flex flex-col gap-5 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Submission & RTR Process
          </h1>
          <div className="relative inline-block text-left">
            <button
              onClick={() => setIsExportOpen(!isExportOpen)}
              className="flex items-center gap-2 px-4 py-2 bg-[#9333ea] hover:bg-[#a855f7] text-white font-semibold rounded-xl transition shadow-lg shadow-purple-900/20 hover:scale-105 active:scale-95"
            >
              <Download className="w-4 h-4" />
              Export
              <ChevronDown className="w-4 h-4 ml-1 opacity-70" />
            </button>

            {isExportOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-xl bg-[#17102b] border border-[#2b2144] shadow-2xl z-50 overflow-hidden text-left origin-top-right animate-in fade-in zoom-in duration-150">
                <div className="py-1 flex flex-col">
                  <button onClick={() => handleExport('csv')} className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-purple-600/20 hover:text-purple-300 transition-colors flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Export as CSV
                  </button>
                  <button disabled title="PDF export coming soon" className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-500 opacity-50 cursor-not-allowed flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-500" /> Export as PDF (Coming Soon)
                  </button>
                  <button onClick={() => handleExport('word')} className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-purple-600/20 hover:text-purple-300 transition-colors flex items-center gap-2">
                    <File className="w-4 h-4 text-blue-400" /> Export as Word
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative w-full max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by candidate, client, skill..."
              className="w-full bg-[#1a142c] border border-[#2b2144] rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-400">Sort:</span>
              <div className="relative">
                <button
                  onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                  className="appearance-none bg-[#1a142c] border border-[#2b2144] rounded-xl text-sm text-slate-200 py-1.5 pl-3 pr-8 focus:outline-none focus:border-purple-500 transition-colors cursor-pointer text-left min-w-[150px] truncate relative"
                >
                  {sortOrder.split(': ')[1] || sortOrder}
                  <ChevronDown className="w-4 h-4 absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
                </button>

                {isSortDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsSortDropdownOpen(false)} />
                    <div className="absolute top-full mt-2 right-0 w-48 bg-[#1a142c] border border-[#2b2144] rounded-xl shadow-xl z-50 overflow-visible py-1">

                      {/* Availability */}
                      <div
                        className="relative group"
                        onMouseEnter={() => setActiveSortSubmenu('Availability')}
                        onMouseLeave={() => setActiveSortSubmenu(null)}
                      >
                        <div className="px-3 py-2 text-sm text-slate-300 hover:bg-purple-600/20 cursor-pointer flex justify-between items-center">
                          Availability <ChevronRight className="w-4 h-4" />
                        </div>

                        {activeSortSubmenu === 'Availability' && (
                          <div className="absolute top-0 left-full ml-1 w-48 bg-[#1a142c] border border-[#2b2144] rounded-xl shadow-xl z-50 py-1">
                            {['All', 'Immediately', 'In 1 week', 'In 1 month', 'Other'].map(opt => (
                              <div
                                key={opt}
                                onClick={() => { setSortOrder(`Availability: ${opt}`); setIsSortDropdownOpen(false); }}
                                className={`px-3 py-2 text-sm cursor-pointer hover:bg-purple-600/20 transition-colors ${sortOrder === `Availability: ${opt}` ? 'bg-purple-600/10 text-purple-400 font-medium' : 'text-slate-300'}`}
                              >
                                {opt}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Payrate */}
                      <div
                        className="relative group"
                        onMouseEnter={() => setActiveSortSubmenu('Payrate')}
                        onMouseLeave={() => setActiveSortSubmenu(null)}
                      >
                        <div className="px-3 py-2 text-sm text-slate-300 hover:bg-purple-600/20 cursor-pointer flex justify-between items-center">
                          Payrate <ChevronRight className="w-4 h-4" />
                        </div>

                        {activeSortSubmenu === 'Payrate' && (
                          <div className="absolute top-0 left-full ml-1 w-48 bg-[#1a142c] border border-[#2b2144] rounded-xl shadow-xl z-50 py-1">
                            {['Low to High', 'High to Low'].map(opt => (
                              <div
                                key={opt}
                                onClick={() => { setSortOrder(`Payrate: ${opt}`); setIsSortDropdownOpen(false); }}
                                className={`px-3 py-2 text-sm cursor-pointer hover:bg-purple-600/20 transition-colors ${sortOrder === `Payrate: ${opt}` ? 'bg-purple-600/10 text-purple-400 font-medium' : 'text-slate-300'}`}
                              >
                                {opt}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  </>
                )}
              </div>
            </div>

            {/* JOB DESCRIPTION FILTER */}
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-400">JD:</span>
              <div className="relative">
                <button
                  onClick={() => setIsJobDropdownOpen(!isJobDropdownOpen)}
                  className="appearance-none bg-[#1a142c] border border-[#2b2144] rounded-xl text-sm text-slate-200 py-1.5 pl-3 pr-8 focus:outline-none focus:border-purple-500 transition-colors cursor-pointer w-[200px] text-left truncate relative"
                >
                  {selectedJobId === 'all' ? 'All JDs' : (jobsList.find(j => j.id === selectedJobId)?.title || 'All JDs')}
                  <ChevronDown className="w-4 h-4 absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
                </button>

                {isJobDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsJobDropdownOpen(false)} />
                    <div className="absolute top-full mt-2 left-0 w-full bg-[#1a142c] border border-[#2b2144] rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="max-h-60 overflow-y-auto custom-scrollbar py-1">
                        <div
                          onClick={() => {
                            setSelectedJobId('all');
                            setIsJobDropdownOpen(false);
                          }}
                          className={`px-3 py-2 text-sm cursor-pointer hover:bg-purple-600/20 transition-colors ${selectedJobId === 'all' ? 'bg-purple-600/10 text-purple-400 font-medium' : 'text-slate-300'}`}
                        >
                          All JDs
                        </div>
                        {jobsList.map(job => (
                          <div
                            key={job.id}
                            onClick={() => {
                              setSelectedJobId(job.id);
                              setIsJobDropdownOpen(false);
                            }}
                            className={`px-3 py-2 text-sm cursor-pointer hover:bg-purple-600/20 transition-colors ${selectedJobId === job.id ? 'bg-purple-600/10 text-purple-400 font-medium' : 'text-slate-300'}`}
                          >
                            {job.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-400">VENDORS:</span>
              <div className="relative">
                <style>{`
                  .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                  .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
                  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
                `}</style>
                <button
                  onClick={() => setIsVendorDropdownOpen(!isVendorDropdownOpen)}
                  className="appearance-none bg-[#1a142c] border border-[#2b2144] rounded-xl text-sm text-slate-200 py-1.5 pl-3 pr-8 focus:outline-none focus:border-purple-500 transition-colors cursor-pointer w-[200px] text-left truncate relative"
                >
                  {selectedVendor}
                  <ChevronDown className="w-4 h-4 absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
                </button>

                {isVendorDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsVendorDropdownOpen(false)} />
                    <div className="absolute top-full mt-2 left-0 w-full bg-[#1a142c] border border-[#2b2144] rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="max-h-60 overflow-y-auto custom-scrollbar py-1">
                        {['All Vendors', ...vendorsList.map(v => v.name)].map(vendor => (
                          <div
                            key={vendor}
                            onClick={() => {
                              setSelectedVendor(vendor);
                              setIsVendorDropdownOpen(false);
                            }}
                            className={`px-3 py-2 text-sm cursor-pointer hover:bg-purple-600/20 transition-colors ${selectedVendor === vendor ? 'bg-purple-600/10 text-purple-400 font-medium' : 'text-slate-300'}`}
                          >
                            {vendor}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Top Tabs */}
        <div className="flex items-center gap-1 bg-[#1a142c] p-1 rounded-xl w-max border border-[#2b2144] overflow-x-auto">
          {renderTab('All')}
          {renderTab('Draft')}
          {renderTab('RTR Pending')}
          {renderTab('Validation Required')}
          {renderTab('Ready for Submission')}
          {renderTab('Submitted')}
          {renderTab('Rejected')}
        </div>
      </div>

      {/* TABLE CONTAINER */}
      <div className="flex-1 min-h-0 w-full rounded-2xl border border-[#261e38] bg-[#0c0916]/80 backdrop-blur-xl relative z-10 font-sans flex flex-col overflow-hidden shadow-xl">
        <div className="flex-1 min-h-0 w-full overflow-auto">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead className="sticky top-0 z-20 bg-[#17102b] border-b border-[#261e38] shadow-sm">
              <tr className="border-b border-[#261e38] bg-[#17102b] text-purple-300 font-bold uppercase tracking-wider text-[11px]">
                <th className="py-4 px-5 w-12 text-center bg-[#17102b]">
                  <input
                    type="checkbox"
                    checked={sortedData.length > 0 && selectedRowIds.size === sortedData.length}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 accent-purple-600 cursor-pointer"
                  />
                </th>
                {selectedRowIds.size > 0 ? (
                  <th colSpan={10} className="py-4 px-5 bg-[#17102b]">
                    <div className="flex items-center gap-4 animate-in fade-in slide-in-from-left-4 duration-200">
                      <span className="text-white text-xs font-semibold">{selectedRowIds.size} selected</span>
                      <button
                        onClick={handleBulkDelete}
                        className="px-3 py-1.5 bg-red-500/15 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-lg flex items-center gap-2 transition cursor-pointer text-xs uppercase"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete Selected
                      </button>
                    </div>
                  </th>
                ) : (
                  <>
                    <th className="py-4 px-5 bg-[#17102b]">CANDIDATE</th>
                    <th className="py-4 px-5 bg-[#17102b]">CONSENT STATUS</th>
                    <th className="py-4 px-5 bg-[#17102b]">CANDIDATE RESPONSE</th>
                    <th className="py-4 px-5 bg-[#17102b]">RTR STATUS</th>
                    <th className="py-4 px-5 bg-[#17102b]">AVAILABILITY</th>
                    <th className="py-4 px-5 bg-[#17102b]">PAY-RATE</th>
                    <th className="py-4 px-5 bg-[#17102b]">RESUME</th>
                    <th className="py-4 px-5 text-center bg-[#17102b]">VIEW</th>
                    <th className="py-4 px-5 text-center bg-[#17102b]">ACTION</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#261e38]/60 text-xs text-slate-300">
              {isListLoading && paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                      Loading submissions...
                    </span>
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    No records found matching your filters.
                  </td>
                </tr>
              ) : (
                paginatedData.map((record) => {
                  const isSelected = selectedRowIds.has(record.id);
                  return (
                    <tr
                      key={record.id}
                      onClick={() => {
                        setDetailsModalTab('Overview');
                        setDetailsModalId(record.id);
                      }}
                      className={`transition-colors duration-150 group cursor-pointer ${isSelected ? 'bg-purple-900/20' : 'hover:bg-purple-900/10'}`}
                    >
                      {/* CHECKBOX */}
                      <td className="py-4 px-5 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectRow(record.id)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 accent-purple-600 cursor-pointer"
                        />
                      </td>

                      {/* CANDIDATE */}
                      <td className="py-4 px-5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setCandidateModalId(record.id); }}
                          className="flex items-center gap-2 hover:text-purple-400 transition cursor-pointer text-left group/cand"
                          title="View Candidate Details"
                        >
                          <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5 text-purple-400" />
                          </div>
                          <span className="font-semibold text-slate-200 group-hover/cand:text-purple-400">
                            {record.candidateName}
                          </span>
                        </button>
                      </td>


                      {/* CONSENT STATUS */}
                      <td className="py-4 px-5">
                        {record.consentStatus === 'REQUESTED' || record.submissionStatus === 'PENDING_CONSENT' || sendingConsentId === record.id ? (
                          <span className="px-2.5 py-1 rounded-lg border font-semibold text-xs inline-flex items-center gap-1.5 bg-indigo-500/10 border-indigo-500/30 text-indigo-300">
                            <Clock className="w-3 h-3 text-indigo-400" />
                            Sent
                          </span>
                        ) : record.consentStatus === 'APPROVED' ? (
                          <span className="px-2.5 py-1 rounded-lg border font-semibold text-xs inline-flex items-center gap-1.5 bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Approved
                          </span>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setConsentModalId(record.id); }}
                            className="px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer hover:scale-105 active:scale-95"
                            title="View Consent Email"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            Request
                          </button>
                        )}
                      </td>

                      {/* CANDIDATE RESPONSE */}
                      <td className="py-4 px-5">
                        <span
                          className={`px-2.5 py-1 rounded-lg border font-semibold text-xs inline-flex items-center gap-1.5 ${getResponseBadgeStyle(
                            record.candidateResponse
                          )}`}
                        >
                          {record.candidateResponse === 'Accepted' && <ThumbsUp className="w-3 h-3" />}
                          {record.candidateResponse === 'Pending' && <Clock className="w-3 h-3" />}
                          {record.candidateResponse === 'Declined' && <ThumbsDown className="w-3 h-3" />}
                          {record.candidateResponse}
                        </span>
                      </td>

                      {/* RTR STATUS */}
                      <td className="py-4 px-5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setResumeModalTab('RTR Preview');
                            setResumeModalId(record.id);
                          }}
                          className={`px-2.5 py-1 rounded-lg border font-semibold text-xs inline-flex items-center gap-1.5 transition cursor-pointer hover:scale-105 active:scale-95 shadow-sm ${getRtrBadgeStyle(
                            record.rtrStatus
                          )}`}
                          title="Click to view / edit RTR format and message"
                        >
                          {record.rtrStatus === 'Approved' && <CheckCircle2 className="w-3 h-3" />}
                          {record.rtrStatus === 'Pending' && <Clock className="w-3 h-3" />}
                          {record.rtrStatus === 'Rejected' && <XCircle className="w-3 h-3" />}
                          {record.rtrStatus === 'Expired' && <Clock className="w-3 h-3" />}
                          {record.rtrStatus}
                        </button>
                      </td>

                      {/* AVAILABILITY */}
                      <td className="py-4 px-5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditModalId(record.id);
                          }}
                          className="hover:opacity-80 transition cursor-pointer"
                          title="Click to edit rate & availability"
                        >
                          <AvailabilityBadge availability={record.availability} />
                        </button>
                      </td>

                      {/* PAY-RATE */}
                      <td className="py-4 px-5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditModalId(record.id);
                          }}
                          className="font-bold text-slate-200 hover:text-purple-400 transition cursor-pointer hover:underline"
                          title="Click to edit pay rate"
                        >
                          {record.payRate}
                        </button>
                      </td>

                      {/* RESUME */}
                      <td className="py-4 px-5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setResumeModalId(record.id); }}
                          className="px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer hover:scale-105 active:scale-95"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Preview
                        </button>
                      </td>

                      {/* VIEW DETAILS */}
                      <td className="py-4 px-5 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setDetailsModalTab('Overview');
                            setDetailsModalId(record.id);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/35 text-purple-300 border border-purple-500/40 font-semibold text-[11px] inline-flex items-center gap-1.5 transition cursor-pointer hover:scale-105 active:scale-95 shadow-sm"
                          title="View Submission Details"
                        >
                          <Eye className="w-3.5 h-3.5 text-purple-400" />
                          View
                        </button>
                      </td>

                      {/* ACTION */}
                      <td className="py-4 px-5 text-center">
                        {(() => {
                          const actions = getBusinessActions(record);
                          return (
                            <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => setOpenActionId(openActionId === record.id ? null : record.id)}
                                disabled={actionLoading === record.id}
                                className={`px-3.5 py-1.5 rounded-xl font-bold text-xs inline-flex items-center justify-center gap-1.5 transition cursor-pointer hover:scale-105 active:scale-95 ${record.recruiterLabel ? getRecruiterLabelBadgeStyle(record.recruiterLabel) : getSubmissionBadgeStyle(record.submissionStatus)
                                  }`}
                              >
                                {actionLoading === record.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : record.submissionStatus === 'READY' ? (
                                  <Send className="w-3.5 h-3.5" />
                                ) : record.recruiterLabel === 'SELECTED' ? (
                                  <Star className="w-3.5 h-3.5" />
                                ) : record.recruiterLabel === 'UNDER_REVIEW' ? (
                                  <ClipboardCheck className="w-3.5 h-3.5" />
                                ) : null}
                                {getStatusDisplayText(record.submissionStatus, record.recruiterLabel)}
                                <ChevronDown className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                              </button>

                              {openActionId === record.id && (
                                <div className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-[#17102b] border border-[#2b2144] shadow-2xl z-50 overflow-hidden text-left origin-top-right">
                                  <div className="py-1 flex flex-col">
                                    {actions.map(({ label, icon, destructive, disabled, disabledReason }) => (
                                      <button
                                        key={label}
                                        disabled={disabled}
                                        title={disabledReason || ''}
                                        onClick={() => !disabled && handleBusinessAction(record.id, label)}
                                        className={`w-full text-left px-4 py-2.5 text-xs font-semibold flex items-center gap-2.5 transition-colors ${disabled
                                          ? 'text-slate-600 bg-transparent cursor-not-allowed'
                                          : destructive
                                            ? 'text-red-400 hover:bg-red-500/15 hover:text-red-300'
                                            : label === 'Submitted'
                                              ? 'text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300'
                                              : label === 'Selected'
                                                ? 'text-cyan-400 hover:bg-cyan-500/15 hover:text-cyan-300'
                                                : 'text-slate-300 hover:bg-purple-600/20 hover:text-purple-300'
                                          }`}
                                      >
                                        {icon}
                                        {label}
                                        {!disabled && label === 'Under Review' && record.recruiterLabel === 'UNDER_REVIEW' && (
                                          <CheckCircle2 className="w-3 h-3 text-amber-400 ml-auto" />
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {sortedData.length > 0 && (
          <div className="flex justify-between items-center p-4 border-t border-[#261e38] bg-[#17102b] shrink-0 z-20">
            <span className="text-sm text-slate-400 font-medium">
              Showing {Math.min((currentPage - 1) * itemsPerPage + 1, sortedData.length)} to {Math.min(currentPage * itemsPerPage, sortedData.length)} of {sortedData.length} entries
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg bg-[#0c0916] border border-[#2b2144] text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#201936] transition cursor-pointer font-bold"
              >
                &lt;
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(Math.ceil(sortedData.length / itemsPerPage), p + 1))}
                disabled={currentPage >= Math.ceil(sortedData.length / itemsPerPage)}
                className="px-3 py-1.5 rounded-lg bg-[#0c0916] border border-[#2b2144] text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#201936] transition cursor-pointer font-bold"
              >
                &gt;
              </button>
            </div>
          </div>
        )}
      </div>



      {/* EDIT MODAL */}
      {editModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#17102b] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-[#261e38] flex justify-between items-center bg-[#0c0916]">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-indigo-400" />
                Edit Record
              </h2>
              <button onClick={() => setEditModalId(null)} className="text-slate-400 hover:text-white transition">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 flex-1 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Candidate Name</label>
                <input
                  type="text"
                  value={editForm.candidateName || ''}
                  onChange={e => setEditForm({ ...editForm, candidateName: e.target.value })}
                  className="w-full bg-[#0c0916] border border-[#2b2144] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Job Title</label>
                <input
                  type="text"
                  value={editForm.jobDescription || ''}
                  onChange={e => setEditForm({ ...editForm, jobDescription: e.target.value })}
                  className="w-full bg-[#0c0916] border border-[#2b2144] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Pay Rate</label>
                  <input
                    type="text"
                    value={editForm.payRate || ''}
                    onChange={e => setEditForm({ ...editForm, payRate: e.target.value })}
                    className="w-full bg-[#0c0916] border border-[#2b2144] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Availability</label>
                  <input
                    type="text"
                    value={editForm.availability || ''}
                    onChange={e => setEditForm({ ...editForm, availability: e.target.value })}
                    className="w-full bg-[#0c0916] border border-[#2b2144] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-[#0c0916] border-t border-[#261e38] flex justify-end gap-3">
              <button
                onClick={() => setEditModalId(null)}
                className="px-4 py-2 rounded-lg text-slate-400 hover:text-white font-semibold transition hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-lg shadow-emerald-900/20"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESUME PREVIEW MODAL */}
      {resumeModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => handleAttemptAction({ type: 'CLOSE' })}>
          <div className="bg-[#0b0914] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex overflow-hidden animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>

            {/* Sidebar */}
            <div className="w-[280px] bg-[#0c0916] border-r border-[#261e38] flex flex-col shrink-0">
              <div className="px-6 py-5 border-b border-[#261e38]">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  Resume Action
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto py-4 flex flex-col justify-between">
                <div>
                  <button
                    onClick={() => handleAttemptAction({ type: 'NAVIGATE', tab: 'Upload Resume' })}
                    className={`w-full text-left px-6 py-4 flex gap-3 transition relative ${resumeModalTab === 'Upload Resume'
                      ? 'bg-purple-900/10'
                      : 'hover:bg-white/5'
                      }`}
                  >
                    {resumeModalTab === 'Upload Resume' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-600" />}
                    <FileText className={`w-5 h-5 mt-0.5 ${resumeModalTab === 'Upload Resume' ? 'text-purple-400' : 'text-slate-400'}`} />
                    <div>
                      <h4 className={`text-sm font-bold ${resumeModalTab === 'Upload Resume' ? 'text-purple-50' : 'text-slate-200'}`}>Upload Resume</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">Upload or replace candidate resume</p>
                    </div>
                  </button>

                  <button
                    onClick={() => handleAttemptAction({ type: 'NAVIGATE', tab: 'Vendor Submission Preview' })}
                    className={`w-full text-left px-6 py-4 flex gap-3 transition relative ${resumeModalTab === 'Vendor Submission Preview'
                      ? 'bg-purple-900/10'
                      : 'hover:bg-white/5'
                      }`}
                  >
                    {resumeModalTab === 'Vendor Submission Preview' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-600" />}
                    <Edit3 className={`w-5 h-5 mt-0.5 ${resumeModalTab === 'Vendor Submission Preview' ? 'text-purple-400' : 'text-slate-400'}`} />
                    <div>
                      <h4 className={`text-sm font-bold ${resumeModalTab === 'Vendor Submission Preview' ? 'text-purple-50' : 'text-slate-200'}`}>Vendor Submission Preview</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">Fill candidate details</p>
                    </div>
                  </button>

                  <button
                    onClick={() => handleAttemptAction({ type: 'NAVIGATE', tab: 'RTR Preview' })}
                    className={`w-full text-left px-6 py-4 flex gap-3 transition relative ${resumeModalTab === 'RTR Preview'
                      ? 'bg-purple-900/10'
                      : 'hover:bg-white/5'
                      }`}
                  >
                    {resumeModalTab === 'RTR Preview' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-600" />}
                    <FileText className={`w-5 h-5 mt-0.5 ${resumeModalTab === 'RTR Preview' ? 'text-purple-400' : 'text-slate-400'}`} />
                    <div>
                      <h4 className={`text-sm font-bold ${resumeModalTab === 'RTR Preview' ? 'text-purple-50' : 'text-slate-200'}`}>RTR Preview</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">View RTR message format</p>
                    </div>
                  </button>

                  <button
                    onClick={() => handleAttemptAction({ type: 'NAVIGATE', tab: 'Candidate & Submission' })}
                    className={`w-full text-left px-6 py-4 flex gap-3 transition relative ${resumeModalTab === 'Candidate & Submission'
                      ? 'bg-purple-900/10'
                      : 'hover:bg-white/5'
                      }`}
                  >
                    {resumeModalTab === 'Candidate & Submission' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-600" />}
                    <User className={`w-5 h-5 mt-0.5 ${resumeModalTab === 'Candidate & Submission' ? 'text-purple-400' : 'text-slate-400'}`} />
                    <div>
                      <h4 className={`text-sm font-bold ${resumeModalTab === 'Candidate & Submission' ? 'text-purple-50' : 'text-slate-200'}`}>Candidate & Submission</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">Summary and details</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col bg-[#0b0914] overflow-hidden">
              <div className="px-8 py-5 flex justify-between items-start border-b border-[#261e38] bg-[#0b0914]">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">{resumeModalTab}</h3>
                  <p className="text-xs text-slate-400">
                    {resumeModalTab === 'Upload Resume' ? 'Upload the latest resume or replace the existing one for this submission.' :
                      resumeModalTab === 'Vendor Submission Preview' ? 'Fill out candidate details for the submission' :
                        resumeModalTab === 'RTR Preview' ? 'Preview the RTR message before generating' :
                          'Review candidate summary and submission details'}
                  </p>
                </div>
                <button onClick={() => handleAttemptAction({ type: 'CLOSE' })} className="text-slate-400 hover:text-white transition cursor-pointer">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {resumeModalTab === 'Upload Resume' && (
                  <div className="space-y-6 max-w-5xl mx-auto w-full">

                    {/* CURRENT RESUME */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Current Resume</h4>
                      <div className="flex items-center justify-between p-6 bg-[#17102b] border border-[#2b2144] rounded-xl shadow-sm relative overflow-hidden group">
                        <div className="flex items-center gap-5 relative z-10">
                          <div className="w-14 h-14 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-center justify-center relative shadow-inner">
                            <FileText className="w-8 h-8 text-indigo-400" />
                            <span className="absolute -bottom-2 -right-2 bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm ring-2 ring-[#17102b]">PDF</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <h5 className="font-bold text-white text-base">{resumeModalRecord?.resumeValid ? 'Resume Available' : 'No Resume Attached'}</h5>
                              <span className="bg-purple-900/50 text-purple-300 text-[10px] font-bold px-2 py-0.5 rounded">{resumeModalRecord?.resumeValid ? 'Valid' : 'Incomplete'}</span>
                            </div>
                            <p className="text-xs text-slate-400 mb-2">2.4 MB <span className="mx-1">•</span> Uploaded 3 days ago <span className="mx-1">•</span> Aug 21, 2026 10:25 AM</p>
                            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Active resume used for matching & submission
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 relative z-10">
                          <button onClick={() => {
                            const activeResume = resumeHistory.find(r => r.isCurrent) || { name: `${(resumeModalRecord?.candidateName || 'Candidate').replace(/\s+/g, '_')}_Resume.pdf` };
                            setPreviewingResume(activeResume);
                          }} className="px-3.5 py-2 rounded-lg bg-[#22183c] hover:bg-[#2c204d] text-white text-xs font-medium border border-[#3b3054] transition flex items-center gap-1.5 cursor-pointer">
                            <Eye className="w-4 h-4 text-slate-300" /> Preview
                          </button>
                          <button onClick={() => {
                            const activeResume = resumeHistory.find(r => r.isCurrent) || { name: `${(resumeModalRecord?.candidateName || 'Candidate').replace(/\s+/g, '_')}_Resume.pdf` };
                            handleDownloadResume(activeResume);
                          }} className="px-3.5 py-2 rounded-lg bg-[#22183c] hover:bg-[#2c204d] text-white text-xs font-medium border border-[#3b3054] transition flex items-center gap-1.5 cursor-pointer">
                            <Download className="w-4 h-4 text-slate-300" /> Download
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* UPLOAD NEW RESUME */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Upload New Resume Version</h4>
                      <div className="border-2 border-dashed border-[#3b3054] hover:border-purple-500/50 rounded-xl p-8 bg-[#17102b]/50 hover:bg-[#17102b] transition flex flex-col items-center justify-center text-center cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                        <div className="w-12 h-12 rounded-full bg-purple-600/10 border border-purple-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                          <UploadCloud className="w-6 h-6 text-purple-400" />
                        </div>
                        <h5 className="font-bold text-white text-sm mb-1">Click to upload or drag & drop</h5>
                        <p className="text-xs text-slate-400 mb-3">PDF, DOC, or DOCX (Max 10MB)</p>
                        <span className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold shadow-md transition">
                          Browse Files
                        </span>
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          accept=".pdf,.doc,.docx"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setIsDirty(true);
                              const file = e.target.files[0];
                              const nextVerNum = resumeHistory.length + 1;
                              const newVersion = `v${nextVerNum}`;
                              const now = new Date();
                              const formatOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
                              const formattedDate = `${now.toLocaleDateString('en-US', formatOpts)} ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;

                              const newEntry = {
                                id: resumeHistory.length + 1,
                                version: newVersion,
                                name: file.name,
                                size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
                                uploader: 'Current User',
                                date: formattedDate,
                                isCurrent: true,
                                fileObj: file
                              };

                              setResumeHistory(prev => [newEntry, ...prev.map(p => ({ ...p, isCurrent: false }))]);
                              e.target.value = '';
                            }
                          }}
                        />
                      </div>
                    </div>

                    {/* VERSION HISTORY */}
                    <div className="space-y-3 pb-8">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Resume Version History</h4>
                      <div className="bg-[#17102b] border border-[#2b2144] rounded-xl overflow-hidden">
                        <table className="w-full text-left">
                          <thead className="bg-[#120d1f] border-b border-[#2b2144]">
                            <tr>
                              <th className="px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Version</th>
                              <th className="px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">File Name</th>
                              <th className="px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Size</th>
                              <th className="px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Uploaded By</th>
                              <th className="px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Uploaded On</th>
                              <th className="px-5 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#261e38] text-xs">
                            {resumeHistory.map((rh) => (
                              <tr key={rh.id} className="hover:bg-[#201936] transition group">
                                <td className="px-5 py-4 font-bold">
                                  <div className="flex items-center gap-2">
                                    <span className={`font-bold px-2 py-1 rounded text-white text-[10px] ${rh.isCurrent ? 'bg-[#6d28d9]' : 'bg-purple-900/50 text-purple-300'}`}>{rh.version}</span>
                                    {rh.isCurrent && <span className="bg-emerald-900/30 text-emerald-400 text-[10px] px-2 py-1 rounded">Current</span>}
                                  </div>
                                </td>
                                <td className="px-5 py-4 text-slate-200 font-medium">{rh.name}</td>
                                <td className="px-5 py-4 text-slate-400">{rh.size}</td>
                                <td className="px-5 py-4 text-slate-400">{rh.uploader}</td>
                                <td className="px-5 py-4 text-slate-400">{rh.date}</td>
                                <td className="px-5 py-4">
                                  <div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => setPreviewingResume(rh)} className="p-1.5 rounded bg-[#120d1f] border border-[#261e38] hover:bg-purple-600/20 hover:text-purple-400 text-slate-300 transition cursor-pointer"><Eye className="w-4 h-4" /></button>
                                    <button onClick={() => handleDownloadResume(rh)} className="p-1.5 rounded bg-[#120d1f] border border-[#261e38] hover:bg-purple-600/20 hover:text-purple-400 text-slate-300 transition cursor-pointer"><Download className="w-4 h-4" /></button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="bg-[#120d1f] p-4 flex gap-2 items-center text-[11px] text-slate-400 border-t border-[#261e38]">
                          <Info className="w-4 h-4 text-purple-400" />
                          <span>The current selected resume <span className="text-purple-400">({resumeHistory.find(r => r.isCurrent)?.version || 'N/A'})</span> will be used for submission unless changed.</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                      <button
                        type="button"
                        onClick={() => handleAttemptAction({ type: 'CLOSE' })}
                        className="px-6 py-2.5 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white hover:bg-[#261e38] text-[13px] font-bold transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAttemptAction({ type: 'NAVIGATE', tab: 'Vendor Submission Preview' })}
                        className="px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[13px] font-bold flex items-center gap-2 transition shadow-lg shadow-purple-900/20 cursor-pointer"
                      >
                        Continue <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {resumeModalTab === 'Vendor Submission Preview' && resumeModalRecord && (
                  <div className="h-full bg-[#120d1f] rounded-xl border border-[#261e38] overflow-hidden">
                    <VendorSubmissionContent
                      record={resumeModalRecord}
                      vendors={vendorsList}
                      onChange={(updatedRecord) => { setIsDirty(true); setRecords(records.map(r => r.id === updatedRecord.id ? updatedRecord : r)); }}
                      onSave={() => { setIsDirty(false); fetchRecords(); setResumeModalTab('RTR Preview'); }}
                      onClose={() => handleAttemptAction({ type: 'CLOSE' })}
                      onDirtyChange={() => setIsDirty(true)}
                    />
                  </div>
                )}

                {resumeModalTab === 'RTR Preview' && resumeModalRecord && (
                  <div className="h-full bg-[#120d1f] rounded-xl border border-[#261e38] overflow-hidden flex flex-col">
                    <RTRPreviewContent
                      record={resumeModalRecord}
                      onNext={() => { setIsDirty(false); setResumeModalTab('Candidate & Submission'); }}
                      onClose={() => handleAttemptAction({ type: 'CLOSE' })}
                      onDirtyChange={() => setIsDirty(true)}
                    />
                  </div>
                )}

                {resumeModalTab === 'Candidate & Submission' && resumeModalRecord && (
                  <div className="h-full bg-[#120d1f] rounded-xl border border-[#261e38] overflow-hidden flex flex-col">
                    <CandidateSubmissionSidebarContent
                      record={resumeModalRecord}
                      onClose={() => handleAttemptAction({ type: 'CLOSE' })}
                      onSubmit={() => {
                        setIsDirty(false);
                        setRecords(records.map(r => r.id === resumeModalRecord.id ? { ...r, vendorStatus: 'Submitted' } : r));
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* SAVE CHANGES? CONFIRMATION MODAL OVERLAY */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
          <div className="bg-[#120d1f] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-md p-6 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">Save Changes?</h3>
              </div>
            </div>

            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              You have unsaved changes. What would you like to do before leaving?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#261e38]">
              <button
                type="button"
                onClick={handleDiscardChanges}
                className="px-4 py-2 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white hover:bg-[#261e38] text-xs font-bold transition cursor-pointer"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSaveDraftChanges}
                className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 transition shadow-lg shadow-purple-900/20 cursor-pointer"
              >
                <Save className="w-4 h-4" /> Save as Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANDIDATE DETAILS MODAL */}
      {candidateModalRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setCandidateModalId(null)}>
          <div className="bg-[#120d1f] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-[#261e38] flex justify-between items-center bg-[#0f0a18]">
              <h2 className="text-sm font-bold text-purple-400 uppercase tracking-wider">
                Candidate Profile
              </h2>
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-400">ID: {candidateModalRecord.candidateId || 'CAND-001'}</span>
                <button onClick={() => setCandidateModalId(null)} className="text-slate-400 hover:text-white transition">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-2 flex-1 text-sm">
              <div className="space-y-0">
                <div className="flex justify-between items-center py-4 border-b border-[#261e38]/50">
                  <span className="text-slate-400">Full Name</span>
                  <span className="font-bold text-white">{activeCandidate ? (activeCandidate.fullName || activeCandidate.name || 'Not Available') : 'Not Available'}</span>
                </div>
                <div className="flex justify-between items-center py-4 border-b border-[#261e38]/50">
                  <span className="text-slate-400">Title / Specialization</span>
                  <span className="font-bold text-white">{activeCandidate?.primaryRole || activeCandidate?.currentRole || 'Not Available'}</span>
                </div>
                <div className="flex justify-between items-center py-4 border-b border-[#261e38]/50">
                  <span className="text-slate-400">Total Experience</span>
                  <span className="font-bold text-white">{activeCandidate?.totalExperience != null ? `${activeCandidate.totalExperience} Years` : 'Not Available'}</span>
                </div>
                <div className="flex justify-between items-center py-4 border-b border-[#261e38]/50">
                  <span className="text-slate-400">Work Authorization</span>
                  <span className="font-bold text-emerald-400">{activeCandidate?.immigrationStatus || 'Not Available'}</span>
                </div>
                <div className="flex justify-between items-center py-4 border-b border-[#261e38]/50">
                  <span className="text-slate-400">Current Location</span>
                  <span className="font-bold text-white">{activeCandidate?.location || 'Not Available'}</span>
                </div>
                <div className="flex justify-between items-center py-4 border-b border-[#261e38]/50">
                  <span className="text-slate-400">Pay Rate</span>
                  <span className="font-bold text-white">{candidateModalRecord.payRate !== '-' ? candidateModalRecord.payRate : 'Not Available'}</span>
                </div>
                <div className="flex justify-between items-center py-4 border-b border-[#261e38]/50">
                  <span className="text-slate-400">Availability</span>
                  <span className="font-bold text-white">{candidateModalRecord.availability || 'Not Available'}</span>
                </div>
                <div className="flex justify-between items-center py-4">
                  <span className="text-slate-400">Email Address</span>
                  <span className="font-bold text-white">{activeCandidate?.email || 'Not Available'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VENDOR DETAILS MODAL */}
      {vendorModalRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#17102b] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-[#261e38] flex justify-between items-center bg-[#0c0916]">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-400" />
                Vendor Details
              </h2>
              <button onClick={() => setVendorModalId(null)} className="text-slate-400 hover:text-white transition cursor-pointer">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 flex-1 text-sm text-slate-300 space-y-6">

              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xl font-extrabold text-white">{vendorModalRecord.vendorName || 'Not specified'}</h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    {vendorModalRecord.vendorStatus && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        {vendorModalRecord.vendorStatus}
                      </span>
                    )}
                    {vendorModalRecord.vendorId && (
                      <span className="text-slate-400 text-xs font-mono">
                        ID: {vendorModalRecord.vendorId}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-[#261e38]">
                <div className="flex items-center gap-4">
                  <User className="w-5 h-5 text-slate-500" />
                  <div>
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Contact Name</p>
                    <p className="font-semibold text-slate-200">
                      {vendorModalRecord.vendorContactName || vendorModalRecord.vendorName || 'Not specified'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <MapPin className="w-5 h-5 text-slate-500" />
                  <div>
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Location</p>
                    <p className="font-semibold text-slate-200">
                      {vendorModalRecord.vendorLocation || 'Not specified'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Mail className="w-5 h-5 text-slate-500" />
                  <div>
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Email Address</p>
                    <p className="font-semibold text-slate-200">
                      {vendorModalRecord.vendorEmail || 'Not specified'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Phone className="w-5 h-5 text-slate-500" />
                  <div>
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Phone Number</p>
                    <p className="font-semibold text-slate-200">
                      {vendorModalRecord.vendorPhone || 'Not specified'}
                    </p>
                  </div>
                </div>
              </div>

            </div>

            <div className="px-6 py-4 bg-[#0c0916] border-t border-[#261e38] flex justify-end">
              <button
                onClick={() => setVendorModalId(null)}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition shadow-lg shadow-indigo-900/20 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONSENT EMAIL MODAL */}
      {consentModalRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#171b26] border border-[#2b3040] rounded-xl shadow-2xl w-full max-w-[750px] max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200 font-sans overflow-hidden">
            <div className="px-5 py-3 border-b border-[#2b3040] flex justify-between items-center bg-[#171b26] shrink-0">
              <h2 className="text-[17px] font-bold text-white flex items-center gap-3">
                <div className="bg-[#4b6bfb] p-1.5 rounded-lg flex items-center justify-center">
                  <Mail className="w-5 h-5 text-white" />
                </div>
                Consent Request Email
              </h2>
              <button onClick={() => setConsentModalId(null)} className="text-[#646e82] hover:text-white transition rounded-full p-1.5 border border-[#2b3040] hover:bg-[#2b3040] cursor-pointer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-0 flex-1 overflow-y-auto custom-scrollbar text-[14px] text-[#9ba1b0] space-y-0">
              <div className="px-5 py-3 flex gap-6 items-center border-b border-[#2b3040]">
                <span className="text-[#646e82] w-14 font-medium text-[13px]">To:</span>
                <span className="font-bold text-white text-[13px]">{consentModalRecord.candidateName} ({consentModalRecord.candidateEmail || 'No email'})</span>
              </div>
              <div className="px-5 py-3 flex gap-6 items-center border-b border-[#2b3040]">
                <span className="text-[#646e82] w-14 font-medium text-[13px]">Subject:</span>
                <span className="font-bold text-white text-[13px]">{consentPreview?.subject || `Job opening matching your profile - ${consentModalRecord.jobDescription}`}</span>
              </div>

              <div className="px-5 py-3 bg-[#13161f] border-b border-[#2b3040] flex items-center gap-4">
                <label className="text-xs font-semibold text-slate-300">Contract Type:</label>
                <select
                  value={selectedContractType}
                  onChange={(e) => setSelectedContractType(e.target.value)}
                  className="bg-[#171b26] border border-[#2b3040] text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#4b6bfb]"
                >
                  <option value="C2C">C2C (Corp-to-Corp)</option>
                  <option value="W2">W2</option>
                  <option value="1099">1099</option>
                  <option value="Full-Time">Full-Time</option>
                  <option value="Contract">Contract</option>
                </select>
                <span className="text-[11px] text-slate-400">Selecting a contract type updates "Contract Type : {selectedContractType}" in the canonical email template.</span>
              </div>

              <div className="p-5 font-mono text-[13px] bg-[#0d1017] text-[#d8dde8] whitespace-pre-wrap leading-relaxed border-b border-[#2b3040] select-text">
                  {consentPreview?.body}
                </div>

              <div className="p-5 space-y-3">
                {consentModalRecord.submissionStatus === 'PENDING_CONSENT' && (
                  <div className="bg-[#13161f] border border-[#2b3040] p-3.5 rounded-xl space-y-2 text-xs text-[#9ba1b0]">
                    <div className="font-bold text-white flex items-center justify-between">
                      <span>Consent Reminder Status</span>
                      <span className="text-[#4b6bfb] font-semibold">Resends: {consentModalRecord.consentResendCount || 0} / {consentModalRecord.maxConsentResends || 3}</span>
                    </div>
                    {consentModalRecord.lastConsentSentAt && (
                      <div className="flex justify-between">
                        <span>Last Sent:</span>
                        <span className="text-slate-300">{new Date(consentModalRecord.lastConsentSentAt).toLocaleString()}</span>
                      </div>
                    )}
                    {consentModalRecord.nextConsentResendAt && !consentModalRecord.canResendConsent && (
                      <div className="flex justify-between text-amber-400">
                        <span>Next Resend Available:</span>
                        <span>{new Date(consentModalRecord.nextConsentResendAt).toLocaleString()}</span>
                      </div>
                    )}
                    {(consentModalRecord.consentResendCount || 0) >= (consentModalRecord.maxConsentResends || 3) && (
                      <div className="text-red-400 font-semibold mt-1">
                        Maximum resend limit reached. No further resends allowed.
                      </div>
                    )}
                  </div>
                )}

                {consentModalRecord.submissionStatus === 'PENDING_CONSENT' && (
                  <div className="bg-purple-950/30 border border-purple-800/40 p-3.5 rounded-xl space-y-2">
                    <div className="text-xs font-semibold text-purple-300">Simulate or Record Candidate Response:</div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={async () => {
                          try {
                            const res = await apiFetch(`/submissions/${consentModalRecord.id}/consent/response`, {
                              method: 'PATCH',
                              body: JSON.stringify({ response: 'YES' })
                            });
                            if (!res.ok) throw new Error(await res.text());
                            await fetchRecords();
                            setConsentModalId(null);
                          } catch (err: any) {
                            alert('Error recording consent: ' + err.message);
                          }
                        }}
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" /> Candidate Accepted (YES)
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const res = await apiFetch(`/submissions/${consentModalRecord.id}/consent/response`, {
                              method: 'PATCH',
                              body: JSON.stringify({ response: 'NO' })
                            });
                            if (!res.ok) throw new Error(await res.text());
                            await fetchRecords();
                            setConsentModalId(null);
                          } catch (err: any) {
                            alert('Error recording consent: ' + err.message);
                          }
                        }}
                        className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow"
                      >
                        <ThumbsDown className="w-3.5 h-3.5" /> Candidate Declined (NO)
                      </button>
                    </div>
                  </div>
                )}

                {consentModalRecord.submissionStatus === 'CONSENT_REJECTED' && (
                  <div className="bg-red-950/40 border border-red-800/50 p-3.5 rounded-xl space-y-1 text-xs text-red-300">
                    <div className="font-bold flex items-center gap-1.5 text-red-400">
                      <span>Consent Declined by Candidate</span>
                    </div>
                    <p>Candidate declined consent for this submission. Resending consent email is prohibited for rejected submissions.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3 bg-[#171b26] border-t border-[#2b3040] flex justify-end gap-3 items-center shrink-0">
              <button
                onClick={() => setConsentModalId(null)}
                className="px-4 py-2 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white text-xs font-bold transition cursor-pointer"
              >
                Close
              </button>
              {(() => {
                const isSendDisabled = sendingConsentId === consentModalRecord.id
                  || (consentModalRecord.submissionStatus === 'DRAFT'
                  ? false
                  : consentModalRecord.submissionStatus === 'PENDING_CONSENT'
                    ? !consentModalRecord.canResendConsent
                    : true);

                return (
                  <button
                    disabled={isSendDisabled}
                    onClick={() => handleSendConsent(consentModalRecord.id)}
                    className={`px-5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition shadow ${isSendDisabled
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-600'
                      : 'bg-[#4b6bfb] hover:bg-[#3b5bdb] text-white cursor-pointer'
                      }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sendingConsentId === consentModalRecord.id
                      ? 'Sending...'
                      : consentModalRecord.submissionStatus === 'DRAFT' ? 'Send Consent Email' : 'Resend Email'}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULE INTERVIEW MODAL */}
      {interviewModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setInterviewModalId(null)}>
          <div className="bg-[#120d1f] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#261e38] flex justify-between items-center bg-[#17102b]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Schedule Technical Interview</h3>
                  <p className="text-[11px] text-slate-400">Record interview details to advance workflow</p>
                </div>
              </div>
              <button onClick={() => setInterviewModalId(null)} className="text-slate-400 hover:text-white p-1 rounded-lg">
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Interview Date & Time</label>
                <input
                  type="datetime-local"
                  value={interviewForm.scheduledAt}
                  onChange={e => setInterviewForm({ ...interviewForm, scheduledAt: e.target.value })}
                  className="w-full bg-[#17102b] border border-[#261e38] rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Interview Type</label>
                  <select
                    value={interviewForm.interviewType}
                    onChange={e => setInterviewForm({ ...interviewForm, interviewType: e.target.value })}
                    className="w-full bg-[#17102b] border border-[#261e38] rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="Technical Round">Technical Round</option>
                    <option value="Managerial Round">Managerial Round</option>
                    <option value="Screening">Screening</option>
                    <option value="Client Final">Client Final</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Round Number</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={interviewForm.round}
                    onChange={e => setInterviewForm({ ...interviewForm, round: parseInt(e.target.value) || 1 })}
                    className="w-full bg-[#17102b] border border-[#261e38] rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Meeting Link (Optional)</label>
                <input
                  type="text"
                  placeholder="https://meet.google.com/..."
                  value={interviewForm.meetingLink}
                  onChange={e => setInterviewForm({ ...interviewForm, meetingLink: e.target.value })}
                  className="w-full bg-[#17102b] border border-[#261e38] rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Additional instructions..."
                  value={interviewForm.notes}
                  onChange={e => setInterviewForm({ ...interviewForm, notes: e.target.value })}
                  className="w-full bg-[#17102b] border border-[#261e38] rounded-xl p-3 text-white focus:outline-none focus:border-purple-500 resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-[#17102b] border-t border-[#261e38] flex justify-end gap-3">
              <button
                onClick={() => setInterviewModalId(null)}
                className="px-4 py-2 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white font-bold transition cursor-pointer text-xs"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    const scheduledAt = interviewForm.scheduledAt ? new Date(interviewForm.scheduledAt).toISOString() : new Date(Date.now() + 86400000).toISOString();
                    const res = await apiFetch(`/submissions/${interviewModalId}/interview`, {
                      method: 'POST',
                      body: JSON.stringify({
                        scheduledAt,
                        interviewType: interviewForm.interviewType,
                        round: interviewForm.round,
                        meetingLink: interviewForm.meetingLink || undefined,
                        notes: interviewForm.notes || undefined
                      })
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      alert('Failed to schedule interview: ' + (err.message || err.error));
                      return;
                    }
                    setInterviewModalId(null);
                    await fetchRecords();
                  } catch (err: any) {
                    alert('Error scheduling interview: ' + err.message);
                  }
                }}
                className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold transition shadow-lg shadow-purple-900/20 cursor-pointer text-xs"
              >
                Schedule & Advance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUBMISSION PREVIEW MODAL */}
      <SubmissionPreviewModal
        isOpen={!!detailsModalId}
        onClose={() => setDetailsModalId(null)}
        record={detailsModalRecord || null}
        initialTab={detailsModalTab}
        onViewResume={() => {
          setDetailsModalId(null);
          setResumeModalId(detailsModalRecord?.id || null);
        }}
      />

      {/* VENDOR SUBMISSION MODAL */}
      <VendorSubmissionModal
        isOpen={!!vendorSubmissionModalId}
        onClose={() => setVendorSubmissionModalId(null)}
        record={vendorSubmissionModalRecord || null}
        vendors={vendorsList}
      />

      {/* PREVIEW RESUME MODAL */}
      {previewingResume && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewingResume(null)}>
          <div className="bg-[#120d1f] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#261e38] flex justify-between items-center bg-[#0c0916]">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                Previewing: {previewingResume?.name || 'Resume'}
              </h2>
              <div className="flex gap-2">
                <button onClick={() => handleDownloadResume(previewingResume)} className="text-slate-400 hover:text-white transition rounded p-1.5 bg-[#17102b] border border-[#2b2144] hover:bg-[#201936] cursor-pointer">
                  <Download className="w-4 h-4" />
                </button>
                <button onClick={() => setPreviewingResume(null)} className="text-slate-400 hover:text-white transition rounded p-1.5 bg-[#17102b] border border-[#2b2144] hover:bg-[#201936] cursor-pointer">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden bg-slate-900 relative flex items-center justify-center">
              {/* Fake PDF viewer visual */}
              <div className="w-[794px] h-[1123px] max-h-full max-w-full bg-white shadow-2xl overflow-y-auto transform scale-[0.85] origin-top my-4">
                <TemplateDesign templateId={1} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REJECTION CONFIRMATION MODAL */}
      {rejectionModalId && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={() => setRejectionModalId(null)}>
          <div className="bg-[#120d1f] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#261e38] flex justify-between items-center bg-[#17102b]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-400">
                  <XCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Reject Submission</h3>
                  <p className="text-[11px] text-slate-400">This action cannot be undone</p>
                </div>
              </div>
              <button onClick={() => setRejectionModalId(null)} className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer">
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to reject this submission? The submission will be moved to a terminal state and no further workflow actions will be available.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Rejection Reason <span className="text-red-400">*</span></label>
                <textarea
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder="Please provide the reason for rejection..."
                  rows={3}
                  className="w-full bg-[#0b0716] border border-[#261e38] rounded-xl p-3 text-xs text-white focus:outline-none focus:border-red-500/50 resize-none placeholder:text-slate-600"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-[#17102b] border-t border-[#261e38] flex justify-end gap-3">
              <button
                onClick={() => setRejectionModalId(null)}
                className="px-4 py-2 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white font-bold transition cursor-pointer text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRejection}
                disabled={!rejectionReason.trim()}
                className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold transition shadow-lg shadow-red-900/20 cursor-pointer text-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <XCircle className="w-4 h-4" />
                Reject Submission
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteModalId && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={() => setDeleteModalId(null)}>
          <div className="bg-[#120d1f] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#261e38] flex justify-between items-center bg-[#17102b]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-400">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Delete Submission</h3>
                  <p className="text-[11px] text-slate-400">Only DRAFT submissions can be deleted</p>
                </div>
              </div>
              <button onClick={() => setDeleteModalId(null)} className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer">
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to delete this submission? This action <span className="text-red-400 font-bold">cannot be undone</span>.
              </p>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-300 leading-relaxed">
                  The submission record will be permanently removed. Related candidate, job, and vendor records will <strong>not</strong> be affected.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 bg-[#17102b] border-t border-[#261e38] flex justify-end gap-3">
              <button
                onClick={() => setDeleteModalId(null)}
                className="px-4 py-2 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white font-bold transition cursor-pointer text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold transition shadow-lg shadow-red-900/20 cursor-pointer text-xs flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOTH-PARTY AVAILABILITY & RATE CONFIRMATION MODAL */}
      {confirmationModalRecord && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={() => { setConfirmationModalId(null); setConfirmationPreviewTarget(null); }}>
          <div className="bg-[#120d1f] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#261e38] flex justify-between items-center bg-[#17102b]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Availability & Rate Confirmation</h3>
                  <p className="text-[11px] text-slate-400">Both consultant and vendor confirmation required before RTR initiation</p>
                </div>
              </div>
              <button onClick={() => { setConfirmationModalId(null); setConfirmationPreviewTarget(null); }} className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer">
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
              {/* Opportunity Summary Card */}
              <div className="bg-[#0b0716] border border-[#261e38] p-4 rounded-xl space-y-3">
                <h4 className="text-[11px] font-bold text-purple-400 uppercase tracking-widest">Opportunity Details</h4>
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Availability:</span>
                    <span className="font-bold text-slate-200">{confirmationModalRecord.availability}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Pay Rate:</span>
                    <span className="font-bold text-slate-200">{confirmationModalRecord.payRate}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Rate Type:</span>
                    <span className="font-bold text-slate-200">{confirmationModalRecord.contractType || 'C2C'}</span>
                  </div>
                </div>
              </div>

              {/* Consultant Confirmation Card */}
              <div className="bg-[#17102b] border border-[#2b2144] p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-purple-400" />
                    <span className="font-bold text-xs text-white">Consultant / Candidate Confirmation</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold ${confirmationModalRecord.consultantConfirmation?.status === 'CONFIRMED'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : confirmationModalRecord.consultantConfirmation?.status === 'DECLINED'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}>
                    {confirmationModalRecord.consultantConfirmation?.status || 'PENDING'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Recipient: <strong className="text-slate-200">{confirmationModalRecord.candidateName}</strong> ({confirmationModalRecord.candidateEmail || 'No email'})
                </p>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    onClick={() => setConfirmationPreviewTarget('consultant')}
                    className="px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview Email
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await apiFetch(`/submissions/${confirmationModalRecord.id}/confirmation/consultant/send`, { method: 'POST' });
                        if (!res.ok) throw new Error((await res.json()).message || 'Send failed');
                        await fetchRecords();
                        alert('Consultant confirmation email sent via RELAY!');
                      } catch (err: any) {
                        alert('Error sending consultant confirmation email: ' + err.message);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    <Send className="w-3.5 h-3.5" /> Send Confirmation Email
                  </button>
                </div>

                {/* Simulated / Manual Response Action */}
                <div className="pt-2 border-t border-[#261e38] flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">Record Response:</span>
                  <button
                    onClick={async () => {
                      try {
                        const res = await apiFetch(`/submissions/${confirmationModalRecord.id}/confirmation/consultant/response`, {
                          method: 'PATCH',
                          body: JSON.stringify({ response: 'YES' })
                        });
                        if (!res.ok) throw new Error((await res.json()).message || 'Response error');
                        await fetchRecords();
                      } catch (err: any) {
                        alert('Error recording consultant response: ' + err.message);
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <ThumbsUp className="w-3 h-3" /> Candidate YES
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await apiFetch(`/submissions/${confirmationModalRecord.id}/confirmation/consultant/response`, {
                          method: 'PATCH',
                          body: JSON.stringify({ response: 'NO' })
                        });
                        if (!res.ok) throw new Error((await res.json()).message || 'Response error');
                        await fetchRecords();
                      } catch (err: any) {
                        alert('Error recording consultant response: ' + err.message);
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <ThumbsDown className="w-3 h-3" /> Candidate NO
                  </button>
                </div>
              </div>

              {/* Vendor Confirmation Card */}
              <div className="bg-[#17102b] border border-[#2b2144] p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-purple-400" />
                    <span className="font-bold text-xs text-white">Vendor Confirmation</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold ${confirmationModalRecord.vendorConfirmation?.status === 'CONFIRMED'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : confirmationModalRecord.vendorConfirmation?.status === 'DECLINED'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}>
                    {confirmationModalRecord.vendorConfirmation?.status || 'PENDING'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Vendor: <strong className="text-slate-200">{confirmationModalRecord.vendorName || 'Not specified'}</strong> ({confirmationModalRecord.vendorEmail || 'No email'})
                </p>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    onClick={() => setConfirmationPreviewTarget('vendor')}
                    className="px-3 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" /> Preview Email (Masked)
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await apiFetch(`/submissions/${confirmationModalRecord.id}/confirmation/vendor/send`, { method: 'POST' });
                        if (!res.ok) throw new Error((await res.json()).message || 'Send failed');
                        await fetchRecords();
                        alert('Vendor confirmation email sent via RELAY!');
                      } catch (err: any) {
                        alert('Error sending vendor confirmation email: ' + err.message);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    <Send className="w-3.5 h-3.5" /> Send Confirmation Email
                  </button>
                </div>

                {/* Record Response */}
                <div className="pt-2 border-t border-[#261e38] flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">Record Response:</span>
                  <button
                    onClick={async () => {
                      try {
                        const res = await apiFetch(`/submissions/${confirmationModalRecord.id}/confirmation/vendor/response`, {
                          method: 'PATCH',
                          body: JSON.stringify({ response: 'YES' })
                        });
                        if (!res.ok) throw new Error((await res.json()).message || 'Response error');
                        await fetchRecords();
                      } catch (err: any) {
                        alert('Error recording vendor response: ' + err.message);
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <ThumbsUp className="w-3 h-3" /> Vendor YES
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await apiFetch(`/submissions/${confirmationModalRecord.id}/confirmation/vendor/response`, {
                          method: 'PATCH',
                          body: JSON.stringify({ response: 'NO' })
                        });
                        if (!res.ok) throw new Error((await res.json()).message || 'Response error');
                        await fetchRecords();
                      } catch (err: any) {
                        alert('Error recording vendor response: ' + err.message);
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <ThumbsDown className="w-3 h-3" /> Vendor NO
                  </button>
                </div>
              </div>

              {/* Both-Party Confirmation Status & RTR Gate / Status */}
              <div className="bg-[#0b0716] border border-[#261e38] p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-white">RTR Gate & Status</span>
                  {confirmationModalRecord.submissionStatus === 'RTR_CONFIRMED' || confirmationModalRecord.rtr?.status === 'SIGNED' ? (
                    <span className="text-emerald-400 font-bold text-xs flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" /> RTR Signed & Confirmed
                    </span>
                  ) : confirmationModalRecord.submissionStatus === 'PENDING_RTR' || confirmationModalRecord.rtr?.status === 'SENT' ? (
                    <span className="text-amber-400 font-bold text-xs flex items-center gap-1">
                      <Clock className="w-4 h-4 text-amber-400" /> RTR Pending Response
                    </span>
                  ) : confirmationModalRecord.submissionStatus === 'REJECTED' || confirmationModalRecord.rtr?.status === 'DECLINED' ? (
                    <span className="text-red-400 font-bold text-xs flex items-center gap-1">
                      <XCircle className="w-4 h-4 text-red-400" /> RTR Declined
                    </span>
                  ) : confirmationModalRecord.canInitiateRTR ? (
                    <span className="text-emerald-400 font-bold text-xs flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Ready for RTR
                    </span>
                  ) : (
                    <span className="text-amber-400 font-bold text-xs flex items-center gap-1">
                      <Clock className="w-4 h-4" /> Confirmation Pending
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {confirmationModalRecord.submissionStatus === 'RTR_CONFIRMED' || confirmationModalRecord.rtr?.status === 'SIGNED'
                    ? 'Right to Represent (RTR) has been signed and confirmed. PRISM submission workflow is complete.'
                    : confirmationModalRecord.submissionStatus === 'PENDING_RTR' || confirmationModalRecord.rtr?.status === 'SENT'
                      ? 'Right to Represent (RTR) has been initiated and sent to candidate. Select an action below to record response.'
                      : confirmationModalRecord.submissionStatus === 'REJECTED' || confirmationModalRecord.rtr?.status === 'DECLINED'
                        ? 'Right to Represent (RTR) was declined.'
                        : confirmationModalRecord.canInitiateRTR
                          ? 'Both consultant and vendor have explicitly confirmed rate and availability. You can now initiate the Right to Represent (RTR) process.'
                          : 'RTR initiation is locked. Both consultant and vendor must confirm availability and rate before proceeding.'}
                </p>

                <div className="pt-2 flex flex-wrap items-center justify-end gap-3">
                  {confirmationModalRecord.submissionStatus === 'PENDING_RTR' || confirmationModalRecord.rtr?.status === 'SENT' ? (
                    <>
                      <button
                        onClick={async () => {
                          if (window.confirm('Confirm RTR Signed?\n\nThis will mark the RTR as signed and complete the PRISM candidate submission workflow.')) {
                            try {
                              const res = await apiFetch(`/submissions/${confirmationModalRecord.id}/rtr/status`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'SIGNED' })
                              });
                              if (!res.ok) {
                                const err = await res.json().catch(() => ({}));
                                throw new Error(err.message || 'Failed to record RTR Signed');
                              }
                              await fetchRecords();
                              setConfirmationModalId(null);
                              alert('RTR recorded as Signed!');
                            } catch (err: any) {
                              alert('Error: ' + err.message);
                            }
                          }
                        }}
                        className="px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 cursor-pointer transition"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Record RTR Signed
                      </button>

                      <button
                        onClick={async () => {
                          if (window.confirm('Confirm RTR Declined?\n\nThis will mark the RTR as declined and reject the submission.')) {
                            try {
                              const res = await apiFetch(`/submissions/${confirmationModalRecord.id}/rtr/status`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'DECLINED' })
                              });
                              if (!res.ok) {
                                const err = await res.json().catch(() => ({}));
                                throw new Error(err.message || 'Failed to record RTR Declined');
                              }
                              await fetchRecords();
                              setConfirmationModalId(null);
                              alert('RTR recorded as Declined.');
                            } catch (err: any) {
                              alert('Error: ' + err.message);
                            }
                          }
                        }}
                        className="px-4 py-2.5 rounded-xl font-bold text-xs bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 flex items-center gap-1.5 cursor-pointer transition"
                      >
                        <XCircle className="w-4 h-4" />
                        Record RTR Declined
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      {confirmationModalRecord.canInitiateRTR ? (
                        confirmationModalRecord.submissionStatus === 'PENDING_RTR' ? (
                          <div className="px-4 py-2.5 rounded-xl font-bold text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-2">
                            <Clock className="w-4 h-4 text-purple-400 animate-pulse" />
                            RTR Package Sent to Vendor (Pending Response)
                          </div>
                        ) : ['RTR_CONFIRMED', 'INTERVIEW_SCHEDULED', 'READY', 'SUBMITTED'].includes(confirmationModalRecord.submissionStatus) ? (
                          <div className="px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            RTR Signed & Confirmed — Submission Complete
                          </div>
                        ) : (
                          <div className="px-4 py-2.5 rounded-xl font-bold text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-indigo-400 animate-spin" />
                            Both Confirmed — RTR Automatically Initiating...
                          </div>
                        )
                      ) : (
                        <div className="px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-2">
                          <FileText className="w-4 h-4 text-slate-500" />
                          RTR Not Ready (Waiting for Both Confirmations)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-[#17102b] border-t border-[#261e38] flex justify-end">
              <button
                onClick={() => { setConfirmationModalId(null); setConfirmationPreviewTarget(null); }}
                className="px-4 py-2 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white font-bold transition cursor-pointer text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION EMAIL PREVIEW OVERLAY */}
      {confirmationPreviewTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md" onClick={() => setConfirmationPreviewTarget(null)}>
          <div className="bg-[#120d1f] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#261e38] flex justify-between items-center bg-[#17102b]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Mail className="w-4 h-4 text-purple-400" />
                {confirmationPreviewTarget === 'consultant' ? 'Consultant Confirmation Email Preview' : 'Vendor Confirmation Email Preview (Masked)'}
              </h3>
              <button onClick={() => setConfirmationPreviewTarget(null)} className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer">
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {confirmationPreviewLoading ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Loading confirmation email preview...
                </div>
              ) : confirmationPreviewData ? (
                <div className="space-y-3 text-xs">
                  <div className="bg-[#0c0916] border border-[#2b2144] p-3 rounded-lg text-slate-200">
                    <span className="text-slate-400 font-semibold mr-2">Subject:</span>
                    <span className="font-semibold text-white">{confirmationPreviewData.subject}</span>
                  </div>
                  <div className="bg-[#0c0916] border border-[#2b2144] p-4 rounded-lg font-mono text-slate-300 whitespace-pre-wrap leading-relaxed select-text">
                    {confirmationPreviewData.body}
                  </div>
                </div>
              ) : (
                <div className="p-4 text-xs text-slate-400 bg-[#0c0916] rounded-lg">
                  Failed to load email preview.
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-[#17102b] border-t border-[#261e38] flex justify-end">
              <button
                onClick={() => setConfirmationPreviewTarget(null)}
                className="px-4 py-2 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white font-bold transition cursor-pointer text-xs"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
