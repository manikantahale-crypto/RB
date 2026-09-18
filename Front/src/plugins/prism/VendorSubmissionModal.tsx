import React from 'react';
import { 
  X, ExternalLink, Info, Upload, CheckCircle2, Send, Save
} from 'lucide-react';
import { apiFetch } from '../../services/api';
import type { SubmissionRecord } from './SubmissionRTR';

interface VendorSubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: SubmissionRecord | null;
}

export const CandidateSubmissionSidebarContent: React.FC<{ record: SubmissionRecord, onClose: () => void, onSubmit?: () => void }> = ({ record, onClose, onSubmit }) => {
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'summary' | 'preview'>('preview');
  const [vendorPreviewData, setVendorPreviewData] = React.useState<{ subject: string; body: string } | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  React.useEffect(() => {
    let isMounted = true;
    const fetchPreview = async () => {
      setPreviewLoading(true);
      try {
        const res = await apiFetch(`/submissions/${record.id}/vendor/preview`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted && json.data) {
            setVendorPreviewData(json.data);
          }
        }
      } catch {
        /* non-blocking */
      } finally {
        if (isMounted) setPreviewLoading(false);
      }
    };
    fetchPreview();
    return () => { isMounted = false; };
  }, [record.id]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/submissions/${record.id}/send-vendor`, {
        method: 'POST'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSubmitError(err.message || err.error || 'Failed to submit candidate to vendor');
        setIsSubmitting(false);
        return;
      }
      setIsSubmitting(false);
      if (onSubmit) onSubmit();
      onClose();
    } catch (err: any) {
      setSubmitError(err.message || 'Submission error');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0914]">
      <div className="px-6 pt-5 pb-3 border-b border-[#261e38] flex gap-3 shrink-0">
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'preview'
              ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Vendor Email Preview (Masked)
        </button>
        <button
          onClick={() => setActiveTab('summary')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'summary'
              ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Candidate Summary
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
        {submitError && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-4 flex items-start gap-3 animate-in fade-in">
            <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <X className="w-3 h-3 text-red-400" />
            </div>
            <p className="text-red-400 text-sm font-medium">{submitError}</p>
          </div>
        )}

        {activeTab === 'preview' ? (
          <div className="bg-[#120d1f] border border-[#261e38] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-purple-400 tracking-widest uppercase">Canonical Vendor Email Preview</h4>
              <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-semibold">
                Masked (No Candidate PII)
              </span>
            </div>

            {previewLoading ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                Loading vendor email preview...
              </div>
            ) : vendorPreviewData ? (
              <div className="space-y-3">
                <div className="bg-[#0c0916] border border-[#2b2144] p-3 rounded-lg text-xs text-slate-200">
                  <span className="text-slate-400 font-semibold mr-2">Subject:</span>
                  <span className="font-semibold text-white">{vendorPreviewData.subject}</span>
                </div>
                <div className="bg-[#0c0916] border border-[#2b2144] p-4 rounded-lg font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed select-text">
                  {vendorPreviewData.body}
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-slate-400 bg-[#0c0916] rounded-lg">
                Preview not available. Standard canonical vendor email template will be generated upon submission.
              </div>
            )}
          </div>
        ) : (
          /* CANDIDATE SUMMARY */
          <div className="bg-[#120d1f] border border-[#261e38] rounded-xl p-5">
            <h4 className="text-[11px] font-bold text-purple-400 tracking-widest uppercase mb-5">Candidate Summary</h4>
            
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center text-lg font-bold text-white shadow-lg shrink-0">
                {(record.candidateName || 'Candidate').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{record.candidateName || 'Not specified'}</h3>
                <div className="text-xs text-slate-400">{record.jobDescription || 'Not specified'}</div>
              </div>
              <div className="ml-auto">
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold flex items-center gap-1 uppercase tracking-wide">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> {record.availability || 'Available'}
                </span>
              </div>
            </div>

            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center pb-3 border-b border-[#261e38]">
                <span className="text-slate-400 text-[13px]">Experience</span>
                <span className="text-white font-semibold text-[13px]">{record.candidateExperience || 'Not specified'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-[#261e38]">
                <span className="text-slate-400 text-[13px]">Client</span>
                <span className="text-white font-semibold text-[13px]">{record.clientName || 'Not specified'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-[#261e38]">
                <span className="text-slate-400 text-[13px]">Location</span>
                <span className="text-white font-semibold text-[13px]">{record.candidateLocation || 'Not specified'}</span>
              </div>
              <div className="flex justify-between items-center pb-1">
                <span className="text-slate-400 text-[13px]">Work Authorization</span>
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-[13px]">{record.candidateWorkAuth || 'Not specified'}</span>
                  {record.candidateWorkAuth && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold flex items-center gap-1 uppercase">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Provided
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-[#261e38] bg-[#120d1f] flex justify-end gap-3 shrink-0">
        <button 
          onClick={onClose}
          className="px-6 py-2.5 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white hover:bg-[#261e38] text-[13px] font-bold transition cursor-pointer"
        >
          Cancel
        </button>
        <button 
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[13px] font-bold flex items-center gap-2 transition shadow-lg shadow-purple-900/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
             <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Sending...</>
          ) : (
             <><Send className="w-4 h-4" /> Submit to Vendor</>
          )}
        </button>
      </div>
    </div>
  );
};

export const VendorSubmissionContent: React.FC<{ record: SubmissionRecord, onChange?: (record: SubmissionRecord) => void, onSave: () => void, onClose: () => void, onDirtyChange?: (dirty: boolean) => void }> = ({ record, onChange, onSave, onClose, onDirtyChange }) => {
  const [brief, setBrief] = React.useState(record.brief || '');
  const [candidateName, setCandidateName] = React.useState(record.candidateName || '');
  const [candidatePhone, setCandidatePhone] = React.useState(record.candidatePhone || '');
  const [candidateLocation, setCandidateLocation] = React.useState(record.candidateLocation || '');
  const [candidateEmail, setCandidateEmail] = React.useState(record.candidateEmail || '');
  const [relocation, setRelocation] = React.useState(record.relocation || 'No');
  const [candidateWorkAuth, setCandidateWorkAuth] = React.useState(record.candidateWorkAuth || '');
  const [availability, setAvailability] = React.useState(record.availability || 'Not specified');
  
  const initialRate = record.rateValue ? String(record.rateValue) : (record.payRate && record.payRate !== '—' && record.payRate !== 'Not specified' ? record.payRate.replace(/[^0-9.]/g, '') : '');
  const [rate, setRate] = React.useState(initialRate);
  const [rateType, setRateType] = React.useState<'HOURLY' | 'ANNUAL'>(record.payRate?.includes('/yr') ? 'ANNUAL' : 'HOURLY');
  const [linkedinProfile, setLinkedinProfile] = React.useState(record.linkedinProfile || '');

  const [attachments, setAttachments] = React.useState<Array<{ type: string; name: string; size: string; fileObj?: File }>>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const attachmentInputRef = React.useRef<HTMLInputElement>(null);

  const notifyChange = (updatedRecord: SubmissionRecord) => {
    onDirtyChange?.(true);
    onChange?.(updatedRecord);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const parsedRate = rate ? parseFloat(rate) : null;
      const res = await apiFetch(`/submissions/${record.id}/rate-availability`, {
        method: 'PATCH',
        body: JSON.stringify({
          rate: parsedRate,
          rateType: rateType,
          availability: availability || 'Not specified'
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.message || err.error || 'Failed to update rate & availability');
        setIsSaving(false);
        return;
      }

      const formattedPayRate = parsedRate ? `$${parsedRate}/${rateType === 'HOURLY' ? 'hr' : 'yr'}` : 'Not specified';
      const updatedRec: SubmissionRecord = {
        ...record,
        candidateName,
        candidatePhone,
        candidateLocation,
        candidateEmail,
        candidateWorkAuth,
        availability: availability || 'Not specified',
        payRate: formattedPayRate,
        rateValue: parsedRate || 0,
        linkedinProfile,
        brief,
        relocation
      };

      notifyChange(updatedRec);
      setIsSaving(false);
      onSave();
    } catch (err: any) {
      setSaveError(err.message || 'Error updating submission rate & availability');
      setIsSaving(false);
    }
  };

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      const allowedExts = ['pdf', 'png', 'jpg', 'jpeg'];
      const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
      if (!allowedExts.includes(fileExt)) {
        setUploadError('Unsupported file type. Please upload PDF, PNG, or JPG.');
        e.target.value = '';
        return;
      }

      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        setUploadError('File size exceeds the maximum allowed size of 5 MB.');
        e.target.value = '';
        return;
      }

      const docType = 'Supporting Document';
      const formattedSize = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
      onDirtyChange?.(true);
      setAttachments(prev => [...prev, {
        type: docType,
        name: file.name,
        size: formattedSize,
        fileObj: file
      }]);
      e.target.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    onDirtyChange?.(true);
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col h-full bg-[#0b0914]">
      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

          {saveError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-4 flex items-start gap-3 animate-in fade-in">
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <X className="w-3 h-3 text-red-400" />
              </div>
              <p className="text-red-400 text-sm font-medium">{saveError}</p>
            </div>
          )}
          
          {/* Top Unified Vendor & Opportunity Card */}
          <div className="bg-[#120d1f] border border-[#261e38] rounded-xl p-5 relative">
            <div className="text-[10px] font-bold text-purple-400 mb-4 tracking-widest uppercase">
              Vendor & Opportunity
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 divide-y md:divide-y-0 md:divide-x divide-[#261e38]">
              {/* Left Section — Vendor Information */}
              <div className="flex items-start gap-4 pr-0 md:pr-6 pt-1 md:pt-0">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-white text-base">
                      {record.vendorName || 'Not specified'}
                    </span>
                    {record.vendorStatus && (
                      <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[9px] font-bold tracking-wide uppercase">
                        {record.vendorStatus}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mb-1">
                    Vendor ID: {record.vendorId ? `VEN-${String(record.vendorId).substring(0, 4).toUpperCase()}` : 'Not specified'}
                  </div>
                  <div className="text-xs text-slate-400 mb-3">
                    Vendor Name: {record.vendorName || 'Not specified'}
                  </div>
                </div>
              </div>

              {/* Right Section — Opportunity / Job Information */}
              <div className="pl-0 md:pl-6 pt-4 md:pt-0 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <h3 className="font-bold text-white text-base leading-tight">
                      {record.jobDescription || 'Not specified'}
                    </h3>
                  </div>
                  <p className="text-[13px] text-slate-400">
                    Client: {record.clientName || 'Not specified'}
                  </p>
                </div>

                <div className="text-[11px] text-slate-400 font-medium space-y-1">
                  <div>
                    Job ID: {record.jobId ? `JOB-${String(record.jobId).substring(0, 4).toUpperCase()}` : 'Not specified'} &nbsp;&bull;&nbsp; Location: {record.jobLocation || 'Not specified'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full">
            {/* Form */}
            <div className="space-y-8">
              <div>
                <h3 className="text-sm font-bold text-purple-400 tracking-widest uppercase mb-5">Candidate Details</h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                  {/* Brief */}
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-1 text-xs font-medium text-slate-400 mb-1.5">
                      Submission Brief <Info className="w-3 h-3 text-slate-500" />
                    </label>
                    <textarea 
                      value={brief}
                      onChange={(e) => { setBrief(e.target.value); onDirtyChange?.(true); }}
                      className="w-full h-24 bg-[#0b0914] border border-[#261e38] rounded-xl p-3 text-[13px] text-white focus:outline-none focus:border-purple-500/50 resize-none"
                      placeholder="Brief description of candidate qualifications for this role"
                    ></textarea>
                  </div>

                  {/* Inputs */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Full Name
                    </label>
                    <input 
                      type="text" 
                      value={candidateName} 
                      onChange={e => { setCandidateName(e.target.value); notifyChange({...record, candidateName: e.target.value}); }} 
                      className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50" 
                      placeholder="Full Name"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Phone No
                    </label>
                    <input 
                      type="text" 
                      value={candidatePhone} 
                      onChange={e => { setCandidatePhone(e.target.value); notifyChange({...record, candidatePhone: e.target.value}); }} 
                      className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50" 
                      placeholder="e.g. +1 (512) 555-0199"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Present Location (City, State)
                    </label>
                    <input 
                      type="text" 
                      value={candidateLocation} 
                      onChange={e => { setCandidateLocation(e.target.value); notifyChange({...record, candidateLocation: e.target.value}); }} 
                      className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50" 
                      placeholder="e.g. Austin, TX"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Email ID
                    </label>
                    <input 
                      type="email" 
                      value={candidateEmail} 
                      onChange={e => { setCandidateEmail(e.target.value); notifyChange({...record, candidateEmail: e.target.value}); }} 
                      className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50" 
                      placeholder="e.g. candidate@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Relocation
                    </label>
                    <select 
                      value={relocation}
                      onChange={e => { setRelocation(e.target.value); onDirtyChange?.(true); }} 
                      className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50 appearance-none"
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Work Authorization Status
                    </label>
                    <input
                      type="text"
                      value={candidateWorkAuth}
                      onChange={e => { setCandidateWorkAuth(e.target.value); notifyChange({...record, candidateWorkAuth: e.target.value}); }}
                      placeholder="e.g. Green Card (GC), US Citizen, H1B"
                      className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Availability to Join
                    </label>
                    <select 
                      value={availability} 
                      onChange={e => { setAvailability(e.target.value); onDirtyChange?.(true); }}
                      className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50 appearance-none"
                    >
                      <option value="Immediate">Immediate</option>
                      <option value="15 Days">15 Days</option>
                      <option value="30 Days">30 Days</option>
                      <option value="1 Month">1 Month</option>
                      <option value="Notice Period Required">Notice Period Required</option>
                      <option value="Not specified">Not specified</option>
                    </select>
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-slate-400 mb-1.5">
                      Rate Amount
                    </label>
                    <input 
                      type="number" 
                      step="any"
                      value={rate} 
                      onChange={e => { setRate(e.target.value); onDirtyChange?.(true); }}
                      placeholder="e.g. 65"
                      className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50" 
                    />
                  </div>

                  <div>
                    <label className="flex items-center gap-1 text-xs font-medium text-slate-400 mb-1.5">
                      Rate Type
                    </label>
                    <select 
                      value={rateType}
                      onChange={e => { setRateType(e.target.value as 'HOURLY' | 'ANNUAL'); onDirtyChange?.(true); }}
                      className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50 appearance-none"
                    >
                      <option value="HOURLY">Hourly ($/hr)</option>
                      <option value="ANNUAL">Annual ($/yr)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      LinkedIn Profile
                    </label>
                    <div className="relative">
                      <input 
                        type="url" 
                        value={linkedinProfile}
                        onChange={e => { setLinkedinProfile(e.target.value); onDirtyChange?.(true); }}
                        placeholder="e.g. https://www.linkedin.com/in/username"
                        className="w-full bg-[#0b0914] border border-[#261e38] rounded-lg px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-purple-500/50" 
                      />
                      {linkedinProfile && (
                        <a href={linkedinProfile} target="_blank" rel="noopener noreferrer" className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 hover:text-purple-300">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Attachments Section */}
              <div className="pt-4">
                <h3 className="flex items-center gap-2 text-sm font-bold text-purple-400 tracking-widest uppercase mb-5">
                  Attachments <Info className="w-4 h-4 text-slate-500 normal-case" />
                </h3>
                
                {uploadError && (
                  <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 mb-4 flex items-center gap-2 text-red-400 text-xs font-medium">
                    <X className="w-4 h-4 shrink-0 text-red-400" />
                    <span>{uploadError}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-4">
                  {attachments.length === 0 && (
                    <div className="text-xs text-slate-500 py-2">No documents attached yet.</div>
                  )}

                  {attachments.map((att, idx) => (
                    <div key={idx} className="bg-[#120d1f] border border-[#261e38] rounded-xl p-3 pr-10 relative flex items-center gap-3 max-w-[280px]">
                      <div className="w-8 h-8 rounded bg-red-500/10 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-red-500">{att.name.endsWith('.pdf') ? 'PDF' : 'IMG'}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-white truncate">{att.type}</div>
                        <div className="text-[10px] text-slate-500 truncate">{att.name} &bull; {att.size}</div>
                      </div>
                      <button type="button" onClick={() => removeAttachment(idx)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-red-400 transition cursor-pointer">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  {/* Upload Button */}
                  <button 
                    type="button" 
                    onClick={() => attachmentInputRef.current?.click()} 
                    className="border border-dashed border-[#3b3054] bg-[#120d1f] hover:bg-[#1a142d] rounded-xl p-3 flex items-center gap-3 transition cursor-pointer px-5 group"
                  >
                    <Upload className="w-5 h-5 text-purple-400 shrink-0 group-hover:-translate-y-1 transition-transform" />
                    <div className="text-left">
                      <div className="text-[11px] font-bold text-purple-300">Upload Document</div>
                      <div className="text-[10px] text-slate-500">PDF, PNG, JPG (Max 5MB)</div>
                    </div>
                  </button>
                  <input
                    type="file"
                    ref={attachmentInputRef}
                    className="hidden"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleAttachmentUpload}
                  />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#261e38] bg-[#120d1f] flex justify-end gap-3 shrink-0">
          <button 
            onClick={onClose}
            className="px-6 py-2.5 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white hover:bg-[#261e38] text-[13px] font-bold transition cursor-pointer"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[13px] font-bold flex items-center gap-2 transition shadow-lg shadow-purple-900/20 cursor-pointer disabled:opacity-50"
          >
            {isSaving ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Saving...</>
            ) : (
              <><Save className="w-4 h-4" /> Save</>
            )}
          </button>
        </div>
    </div>
  );
};

export const VendorSubmissionModal: React.FC<VendorSubmissionModalProps> = ({ 
  isOpen, 
  onClose, 
  record 
}) => {
  if (!isOpen || !record) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-[#0b0914]/80 backdrop-blur-md" onClick={onClose}>
      <div 
        className="bg-[#0b0914] border border-[#261e38] rounded-2xl shadow-2xl w-full max-w-[1200px] h-auto max-h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" 
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-[#261e38] bg-[#120d1f] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-900/30 border border-purple-500/20 flex items-center justify-center text-purple-400 font-bold">
              VS
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Vendor Submission / RTR</h2>
              <p className="text-[13px] text-slate-400 mt-0.5">Submit candidate to vendor in RTR format</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-500 hover:text-white bg-[#261e38]/50 hover:bg-[#261e38] p-2 rounded-full transition cursor-pointer border border-transparent hover:border-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <VendorSubmissionContent 
          record={record} 
          onSave={onClose} 
          onClose={onClose} 
        />
      </div>
    </div>
  );
};

export const RTRPreviewContent: React.FC<{ record: SubmissionRecord, onNext: () => void, onClose: () => void, onDirtyChange?: (dirty: boolean) => void }> = ({ record, onNext, onClose, onDirtyChange }) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [isFormatEditing, setIsFormatEditing] = React.useState(false);
  const [messageText, setMessageText] = React.useState(
    `I would like to submit candidate ${record.candidateName || 'Candidate'} for the ${record.jobDescription || 'role'} position.\n\nPlease confirm availability (${record.availability || 'Not specified'}) and expected rate (${record.payRate || 'Not specified'}) for this opportunity.`
  );
  const [formatData, setFormatData] = React.useState({
    fullName: record.candidateName || 'Not specified',
    phoneNo: record.candidatePhone || 'Not specified',
    emailId: record.candidateEmail || 'Not specified',
    presentLocation: record.candidateLocation || 'Not specified',
    relocation: record.relocation || 'No',
    workAuthStatus: record.candidateWorkAuth || 'Not specified',
    availabilityToJoin: record.availability || 'Not specified',
    expectedHourlyRate: record.payRate || 'Not specified',
    linkedinProfile: record.linkedinProfile || 'Not specified'
  });

  return (
    <div className="flex flex-col h-full bg-[#0b0914]">
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-bold text-white uppercase tracking-widest">RTR Message Preview</h3>
          <button 
            onClick={() => setIsEditing(!isEditing)}
            className="px-3 py-1.5 rounded bg-[#261e38]/50 text-purple-400 text-xs font-semibold hover:bg-[#261e38] transition border border-transparent hover:border-[#3b3054] cursor-pointer"
          >
            {isEditing ? 'Save' : 'Editable'}
          </button>
        </div>

        {/* Message Text */}
        {isEditing ? (
          <textarea
            value={messageText}
            onChange={(e) => { onDirtyChange?.(true); setMessageText(e.target.value); }}
            className="w-full bg-[#120d1f] border border-purple-500/50 rounded-xl p-4 text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-purple-500 min-h-[120px] resize-y custom-scrollbar leading-relaxed"
            autoFocus
          />
        ) : (
          <div className="text-[13px] text-slate-300 leading-relaxed whitespace-pre-wrap">
            {messageText}
          </div>
        )}

        {/* RTR FORMAT PREVIEW Box */}
        <div className="bg-[#120d1f] border border-[#261e38] rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-[11px] font-bold text-slate-400 tracking-widest uppercase">RTR Format Preview</h4>
            <button 
              onClick={() => setIsFormatEditing(!isFormatEditing)}
              className="px-3 py-1.5 rounded bg-[#261e38]/50 text-purple-400 text-xs font-semibold hover:bg-[#261e38] transition border border-transparent hover:border-[#3b3054] cursor-pointer"
            >
              {isFormatEditing ? 'Save' : 'Editable'}
            </button>
          </div>
          
          <div className="space-y-4 text-[13px]">
            <div className="grid grid-cols-[160px_10px_1fr] items-center min-h-[32px]">
              <div className="text-slate-400">Full Name</div>
              <div className="text-slate-500">:</div>
              {isFormatEditing ? <input type="text" value={formatData.fullName} onChange={e => setFormatData({...formatData, fullName: e.target.value})} className="bg-[#0b0914] border border-purple-500/30 rounded px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 w-full text-[13px]" /> : <div className="text-white font-medium">{formatData.fullName}</div>}
            </div>
            
            <div className="grid grid-cols-[160px_10px_1fr] items-center min-h-[32px]">
              <div className="text-slate-400">Phone No</div>
              <div className="text-slate-500">:</div>
              {isFormatEditing ? <input type="text" value={formatData.phoneNo} onChange={e => setFormatData({...formatData, phoneNo: e.target.value})} className="bg-[#0b0914] border border-purple-500/30 rounded px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 w-full text-[13px]" /> : <div className="text-white font-medium">{formatData.phoneNo}</div>}
            </div>

            <div className="grid grid-cols-[160px_10px_1fr] items-center min-h-[32px]">
              <div className="text-slate-400">Email ID</div>
              <div className="text-slate-500">:</div>
              {isFormatEditing ? <input type="text" value={formatData.emailId} onChange={e => setFormatData({...formatData, emailId: e.target.value})} className="bg-[#0b0914] border border-purple-500/30 rounded px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 w-full text-[13px]" /> : <div className="text-white font-medium">{formatData.emailId}</div>}
            </div>

            <div className="grid grid-cols-[160px_10px_1fr] items-center min-h-[32px]">
              <div className="text-slate-400">Present Location</div>
              <div className="text-slate-500">:</div>
              {isFormatEditing ? <input type="text" value={formatData.presentLocation} onChange={e => setFormatData({...formatData, presentLocation: e.target.value})} className="bg-[#0b0914] border border-purple-500/30 rounded px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 w-full text-[13px]" /> : <div className="text-white font-medium">{formatData.presentLocation}</div>}
            </div>

            <div className="grid grid-cols-[160px_10px_1fr] items-center min-h-[32px]">
              <div className="text-slate-400">Relocation</div>
              <div className="text-slate-500">:</div>
              {isFormatEditing ? <input type="text" value={formatData.relocation} onChange={e => setFormatData({...formatData, relocation: e.target.value})} className="bg-[#0b0914] border border-purple-500/30 rounded px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 w-full text-[13px]" /> : <div className="text-white font-medium">{formatData.relocation}</div>}
            </div>

            <div className="grid grid-cols-[160px_10px_1fr] items-start min-h-[32px]">
              <div className="text-slate-400 pt-1.5">Work Authorization Status</div>
              <div className="text-slate-500 pt-1.5">:</div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {isFormatEditing ? <input type="text" value={formatData.workAuthStatus} onChange={e => setFormatData({...formatData, workAuthStatus: e.target.value})} className="bg-[#0b0914] border border-purple-500/30 rounded px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 w-full max-w-[200px] text-[13px]" /> : <span className="text-white font-medium">{formatData.workAuthStatus}</span>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[160px_10px_1fr] items-center min-h-[32px]">
              <div className="text-slate-400">Availability to Join</div>
              <div className="text-slate-500">:</div>
              {isFormatEditing ? <input type="text" value={formatData.availabilityToJoin} onChange={e => setFormatData({...formatData, availabilityToJoin: e.target.value})} className="bg-[#0b0914] border border-purple-500/30 rounded px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 w-full text-[13px]" /> : <div className="text-white font-medium">{formatData.availabilityToJoin}</div>}
            </div>

            <div className="grid grid-cols-[160px_10px_1fr] items-center min-h-[32px]">
              <div className="text-slate-400">Expected Rate</div>
              <div className="text-slate-500">:</div>
              {isFormatEditing ? <input type="text" value={formatData.expectedHourlyRate} onChange={e => setFormatData({...formatData, expectedHourlyRate: e.target.value})} className="bg-[#0b0914] border border-purple-500/30 rounded px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 w-full text-[13px]" /> : <div className="text-white font-medium">{formatData.expectedHourlyRate}</div>}
            </div>

            <div className="grid grid-cols-[160px_10px_1fr] items-center min-h-[32px]">
              <div className="text-slate-400">LinkedIn Profile</div>
              <div className="text-slate-500">:</div>
              {isFormatEditing ? <input type="text" value={formatData.linkedinProfile} onChange={e => setFormatData({...formatData, linkedinProfile: e.target.value})} className="bg-[#0b0914] border border-purple-500/30 rounded px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 w-full text-[13px]" /> : (
                <div className="text-purple-400 font-semibold flex items-center gap-1.5 cursor-pointer hover:text-purple-300">
                  {formatData.linkedinProfile} {formatData.linkedinProfile !== 'Not specified' && <ExternalLink className="w-3.5 h-3.5" />}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-[#261e38] bg-[#120d1f] flex justify-end gap-3 shrink-0">
        <button 
          onClick={onClose}
          className="px-6 py-2.5 rounded-lg border border-[#3b3054] text-slate-300 hover:text-white hover:bg-[#261e38] text-[13px] font-bold transition cursor-pointer"
        >
          Cancel
        </button>
        <button 
          onClick={onNext}
          className="px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[13px] font-bold flex items-center gap-2 transition shadow-lg shadow-purple-900/20 cursor-pointer"
        >
          Continue <CheckCircle2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

