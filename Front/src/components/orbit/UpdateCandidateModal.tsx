import React, { useState, useEffect } from 'react';
import {
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Briefcase,
  MapPin,
  ShieldCheck,
  Clock,
  Mail,
  Phone,
  DollarSign,
  User,
  Globe,
} from 'lucide-react';
import { CandidateProfile, OrbitLifecycleState } from '../../types';
import { apiFetch } from '../../services/api';

interface UpdateCandidateModalProps {
  candidate: CandidateProfile;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedCandidate: CandidateProfile) => void;
}

const VISA_OPTIONS = [
  'US Citizen',
  'Green Card (GC)',
  'H1B',
  'OPT',
  'CPT',
  'H4 EAD',
  'TN Visa',
  'L2 EAD',
  'Other / Employment Auth',
];

const LIFECYCLE_OPTIONS: { value: OrbitLifecycleState; label: string }[] = [
  { value: 'AVAILABLE', label: 'Available (Immediate Marketing)' },
  { value: 'BENCH', label: 'Bench (Internal Pool)' },
  { value: 'NOTICE', label: 'Notice (Serving Notice Period)' },
  { value: 'PLACED', label: 'Placed (On Client Billing)' },
  { value: 'HOLD', label: 'Hold (Paused)' },
  { value: 'PRIORITIZE', label: 'Prioritize (Urgent)' },
];

export const UpdateCandidateModal: React.FC<UpdateCandidateModalProps> = ({
  candidate,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [experience, setExperience] = useState('');
  const [visa, setVisa] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState<string>('AVAILABLE');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [github, setGithub] = useState('');
  const [minRate, setMinRate] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state whenever modal opens or candidate changes
  useEffect(() => {
    if (!candidate) return;
    setFullName(candidate.name && candidate.name !== 'Unnamed Candidate' ? candidate.name : '');
    setTitle(candidate.title && candidate.title !== 'Software Professional' ? candidate.title : '');
    
    const existingSkills = candidate.matchedSkills || (candidate as any).skills || [];
    setSkillsText(Array.isArray(existingSkills) ? existingSkills.join(', ') : String(existingSkills));
    
    setExperience(
      candidate.experience && candidate.experience !== 'Not specified'
        ? candidate.experience
        : candidate.expYears
        ? `${candidate.expYears} years`
        : ''
    );
    setVisa(candidate.visa && candidate.visa !== 'N/A' && candidate.visa !== 'Any' ? candidate.visa : '');
    setLocation(candidate.location && candidate.location !== 'N/A' ? candidate.location : '');
    setStatus(candidate.orbit_lifecycle_state || 'AVAILABLE');
    setEmail(candidate.email || '');
    setPhone(candidate.phone || '');
    setLinkedin(candidate.linkedin || '');
    setGithub(candidate.github || '');
    setMinRate(candidate.minRate || '');
    setError(null);
  }, [candidate, isOpen]);

  if (!isOpen || !candidate) return null;

  // Derive missing keys directly from candidate backend state
  const missingKeys = new Set(candidate.missing_keys || []);

  const isNameMissing = missingKeys.has('full_name') || !fullName.trim() || fullName === 'Unnamed Candidate' || fullName === 'Candidate';
  const isEmailMissing = missingKeys.has('email') || !email.trim() || !email.includes('@');
  const isPhoneMissing = missingKeys.has('phone') || !phone.trim() || phone.replace(/\D/g, '').length < 7;
  const isSkillsMissing = missingKeys.has('skills') || !skillsText.trim();
  const isExpMissing = missingKeys.has('experience_years') || !experience.trim();
  const isVisaMissing = missingKeys.has('work_authorization') || !visa.trim();
  const isLocationMissing = missingKeys.has('location') || !location.trim();
  const isAvailabilityMissing = missingKeys.has('availability') || !status.trim();

  // Dynamic missing fields list based on active form state
  const missingFieldsList: string[] = [];
  if (isNameMissing) missingFieldsList.push('Full Name');
  if (isEmailMissing) missingFieldsList.push('Email');
  if (isPhoneMissing) missingFieldsList.push('Phone');
  if (isSkillsMissing) missingFieldsList.push('Skills');
  if (isExpMissing) missingFieldsList.push('Experience');
  if (isVisaMissing) missingFieldsList.push('Visa / Work Authorization');
  if (isLocationMissing) missingFieldsList.push('Current Location');
  if (isAvailabilityMissing) missingFieldsList.push('Availability');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Parse skills into a clean array
      const parsedSkills = skillsText
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      // Validate all mandatory fields
      if (!fullName.trim() || !email.trim() || !phone.trim() || parsedSkills.length === 0 || !experience.trim() || !visa.trim() || !location.trim()) {
        const missing: string[] = [];
        if (!fullName.trim()) missing.push('Full Name');
        if (!email.trim() || !email.includes('@')) missing.push('Email');
        if (!phone.trim() || phone.replace(/\D/g, '').length < 7) missing.push('Phone');
        if (parsedSkills.length === 0) missing.push('Technical Skills');
        if (!experience.trim()) missing.push('Total Experience');
        if (!visa.trim()) missing.push('Visa / Work Authorization');
        if (!location.trim()) missing.push('Current Location');
        throw new Error(`Please complete all mandatory fields: ${missing.join(', ')}`);
      }

      const payload = {
        fullName: fullName.trim() || undefined,
        current_title: title.trim() || undefined,
        skills: parsedSkills,
        total_experience: experience.trim() || undefined,
        experience_years: experience.trim() || undefined,
        immigration_status: visa.trim() || undefined,
        work_authorization: visa.trim() || undefined,
        location: location.trim() || undefined,
        status: status === 'AVAILABLE' || status === 'BENCH' ? 'Active' : status,
        orbit_lifecycle_state: status,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        linkedin: linkedin.trim() || undefined,
        github: github.trim() || undefined,
        min_rate: minRate.trim() || undefined,
      };

      const res = await apiFetch(`/candidates/${candidate.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to update candidate profile');
      }

      const resData = await res.json();
      const updated = resData.candidate || {};

      // Map back to CandidateProfile format with updated missing-field status
      const updatedCandidateProfile: CandidateProfile = {
        ...candidate,
        name: updated.fullName || fullName.trim() || candidate.name,
        title: updated.currentRole || updated.primaryRole || title.trim() || candidate.title,
        location: updated.location || location.trim() || candidate.location,
        experience: updated.totalExperience || experience.trim() || candidate.experience,
        expYears: parseInt(updated.totalExperience || experience) || candidate.expYears,
        visa: updated.immigrationStatus || visa.trim() || candidate.visa,
        matchedSkills: Array.isArray(updated.skills) && updated.skills.length > 0 ? updated.skills : parsedSkills,
        email: updated.email || email.trim() || candidate.email,
        phone: updated.phone || phone.trim() || candidate.phone,
        linkedin: updated.linkedin || linkedin.trim() || candidate.linkedin,
        github: updated.github || github.trim() || candidate.github,
        minRate: updated.minRate || minRate.trim() || candidate.minRate,
        orbit_lifecycle_state: updated.orbit_lifecycle_state || (status as OrbitLifecycleState),
        action_needed: updated.action_needed ?? false,
        missing_fields: updated.missing_fields ?? [],
        missing_keys: updated.missing_keys ?? [],
      };

      onSuccess(updatedCandidateProfile);
      onClose();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during update');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#120c24] border border-purple-500/30 rounded-2xl w-full max-w-2xl shadow-2xl relative max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-[#261e38] bg-[#160f2e] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-300 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <span>Update Candidate Profile</span>
                {candidate.action_needed && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-bold uppercase tracking-wider">
                    Action Needed
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Complete consultant attributes to enable accurate AI matching & marketing
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Missing Fields Notice Banner */}
        {missingFieldsList.length > 0 && (
          <div className="px-5 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span className="font-bold text-amber-300">Missing Mandatory Fields: </span>
              <span className="text-amber-200/90 font-medium">
                {missingFieldsList.join(', ')}
              </span>
              <p className="text-[11px] text-amber-300/70 mt-0.5">
                Highlighted below. Enter the required information and save to complete the profile.
              </p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* 1. NAME & TITLE ROW */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-purple-400" />
                  Candidate Full Name *
                </span>
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Sofia Ramirez"
                className="w-full bg-[#181131] border border-purple-500/25 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400/30 transition text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-purple-400" />
                Primary Role / Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior React Developer"
                className="w-full bg-[#181131] border border-purple-500/25 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400/30 transition text-xs"
              />
            </div>
          </div>

          {/* 2. SKILLS (HIGHLIGHTED IF MISSING) */}
          <div className={`p-3.5 rounded-xl border transition-colors ${
            isSkillsMissing ? 'bg-amber-500/5 border-amber-500/40 ring-1 ring-amber-500/20' : 'bg-[#16102a] border-purple-500/20'
          }`}>
            <label className="block text-[11px] font-bold text-slate-200 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Sparkles className={`w-3.5 h-3.5 ${isSkillsMissing ? 'text-amber-400' : 'text-purple-400'}`} />
                <span>Technical Skills *</span>
              </span>
              {isSkillsMissing && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 uppercase tracking-wider">
                  Missing ÔÇö Action Required
                </span>
              )}
            </label>
            <textarea
              rows={2}
              required
              value={skillsText}
              onChange={(e) => setSkillsText(e.target.value)}
              placeholder="e.g. React, TypeScript, Redux, Node.js, GraphQL, Tailwind CSS, Jest"
              className={`w-full bg-[#181131] rounded-xl px-3 py-2 text-white focus:outline-none text-xs ${
                isSkillsMissing ? 'border border-amber-500/50 focus:border-amber-400' : 'border border-purple-500/25 focus:border-purple-400'
              }`}
            />
            <p className="text-[10px] text-slate-400 mt-1">Separate skills with commas (e.g. React, Node.js, AWS)</p>
          </div>

          {/* 3. EXPERIENCE & VISA (HIGHLIGHTED IF MISSING) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Experience */}
            <div className={`p-3.5 rounded-xl border transition-colors ${
              isExpMissing ? 'bg-amber-500/5 border-amber-500/40 ring-1 ring-amber-500/20' : 'bg-[#16102a] border-purple-500/20'
            }`}>
              <label className="block text-[11px] font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Clock className={`w-3.5 h-3.5 ${isExpMissing ? 'text-amber-400' : 'text-purple-400'}`} />
                  <span>Total Experience *</span>
                </span>
                {isExpMissing && (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 uppercase tracking-wider">
                    Missing
                  </span>
                )}
              </label>
              <input
                type="text"
                required
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                placeholder="e.g. 5 years or 7+ Years"
                className={`w-full bg-[#181131] rounded-xl px-3 py-2 text-white focus:outline-none text-xs ${
                  isExpMissing ? 'border border-amber-500/50 focus:border-amber-400' : 'border border-purple-500/25 focus:border-purple-400'
                }`}
              />
            </div>

            {/* Visa / Work Auth */}
            <div className={`p-3.5 rounded-xl border transition-colors ${
              isVisaMissing ? 'bg-amber-500/5 border-amber-500/40 ring-1 ring-amber-500/20' : 'bg-[#16102a] border-purple-500/20'
            }`}>
              <label className="block text-[11px] font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className={`w-3.5 h-3.5 ${isVisaMissing ? 'text-amber-400' : 'text-purple-400'}`} />
                  <span>Visa / Work Auth *</span>
                </span>
                {isVisaMissing && (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 uppercase tracking-wider">
                    Missing
                  </span>
                )}
              </label>
              <select
                value={visa}
                onChange={(e) => setVisa(e.target.value)}
                required
                className={`w-full bg-[#181131] rounded-xl px-3 py-2 text-white focus:outline-none text-xs cursor-pointer ${
                  isVisaMissing ? 'border border-amber-500/50 focus:border-amber-400' : 'border border-purple-500/25 focus:border-purple-400'
                }`}
              >
                <option value="">-- Select Work Authorization --</option>
                {VISA_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 4. LOCATION & AVAILABILITY (HIGHLIGHTED IF MISSING) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Location */}
            <div className={`p-3.5 rounded-xl border transition-colors ${
              isLocationMissing ? 'bg-amber-500/5 border-amber-500/40 ring-1 ring-amber-500/20' : 'bg-[#16102a] border-purple-500/20'
            }`}>
              <label className="block text-[11px] font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <MapPin className={`w-3.5 h-3.5 ${isLocationMissing ? 'text-amber-400' : 'text-purple-400'}`} />
                  <span>Current Location *</span>
                </span>
                {isLocationMissing && (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 uppercase tracking-wider">
                    Missing
                  </span>
                )}
              </label>
              <input
                type="text"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Atlanta, GA, USA"
                className={`w-full bg-[#181131] rounded-xl px-3 py-2 text-white focus:outline-none text-xs ${
                  isLocationMissing ? 'border border-amber-500/50 focus:border-amber-400' : 'border border-purple-500/25 focus:border-purple-400'
                }`}
              />
            </div>

            {/* Availability / Status */}
            <div className={`p-3.5 rounded-xl border transition-colors ${
              isAvailabilityMissing ? 'bg-amber-500/5 border-amber-500/40 ring-1 ring-amber-500/20' : 'bg-[#16102a] border-purple-500/20'
            }`}>
              <label className="block text-[11px] font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Clock className={`w-3.5 h-3.5 ${isAvailabilityMissing ? 'text-amber-400' : 'text-purple-400'}`} />
                  <span>Availability / Lifecycle *</span>
                </span>
                {isAvailabilityMissing && (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 uppercase tracking-wider">
                    Missing
                  </span>
                )}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                required
                className={`w-full bg-[#181131] rounded-xl px-3 py-2 text-white focus:outline-none text-xs cursor-pointer ${
                  isAvailabilityMissing ? 'border border-amber-500/50 focus:border-amber-400' : 'border border-purple-500/25 focus:border-purple-400'
                }`}
              >
                {LIFECYCLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 5. CONTACT & RATE DETAILS (EMAIL & PHONE ARE MANDATORY IDENTITY FIELDS) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            {/* Email */}
            <div className={`p-3 rounded-xl border transition-colors ${
              isEmailMissing ? 'bg-amber-500/5 border-amber-500/40 ring-1 ring-amber-500/20' : 'bg-[#16102a] border-purple-500/20'
            }`}>
              <label className="block text-[11px] font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Mail className={`w-3.5 h-3.5 ${isEmailMissing ? 'text-amber-400' : 'text-purple-400'}`} />
                  <span>Email *</span>
                </span>
                {isEmailMissing && (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 uppercase tracking-wider">
                    Missing
                  </span>
                )}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@email.com"
                className={`w-full bg-[#181131] rounded-xl px-3 py-1.5 text-white focus:outline-none text-xs ${
                  isEmailMissing ? 'border border-amber-500/50 focus:border-amber-400' : 'border border-purple-500/25 focus:border-purple-400'
                }`}
              />
            </div>

            {/* Phone */}
            <div className={`p-3 rounded-xl border transition-colors ${
              isPhoneMissing ? 'bg-amber-500/5 border-amber-500/40 ring-1 ring-amber-500/20' : 'bg-[#16102a] border-purple-500/20'
            }`}>
              <label className="block text-[11px] font-bold text-slate-200 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Phone className={`w-3.5 h-3.5 ${isPhoneMissing ? 'text-amber-400' : 'text-purple-400'}`} />
                  <span>Phone *</span>
                </span>
                {isPhoneMissing && (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 uppercase tracking-wider">
                    Missing
                  </span>
                )}
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className={`w-full bg-[#181131] rounded-xl px-3 py-1.5 text-white focus:outline-none text-xs ${
                  isPhoneMissing ? 'border border-amber-500/50 focus:border-amber-400' : 'border border-purple-500/25 focus:border-purple-400'
                }`}
              />
            </div>

            {/* Target Rate */}
            <div className="p-3 rounded-xl border bg-[#16102a] border-purple-500/20">
              <label className="block text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-purple-400" />
                <span>Target / Min Rate</span>
              </label>
              <input
                type="text"
                value={minRate}
                onChange={(e) => setMinRate(e.target.value)}
                placeholder="e.g. $65/hr or $110k/yr"
                className="w-full bg-[#181131] border border-purple-500/25 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400 text-xs"
              />
            </div>
          </div>

          {/* 6. SOCIAL LINKS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 mb-1 flex items-center gap-1">
                <Globe className="w-3 h-3 text-purple-400" />
                LinkedIn URL
              </label>
              <input
                type="text"
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                placeholder="https://linkedin.com/in/..."
                className="w-full bg-[#181131] border border-purple-500/25 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400 text-xs"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-400 mb-1 flex items-center gap-1">
                <Globe className="w-3 h-3 text-purple-400" />
                GitHub URL
              </label>
              <input
                type="text"
                value={github}
                onChange={(e) => setGithub(e.target.value)}
                placeholder="https://github.com/..."
                className="w-full bg-[#181131] border border-purple-500/25 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400 text-xs"
              />
            </div>
          </div>
        </form>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[#261e38] bg-[#160f2e] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-900/50 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving Changes...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Profile Changes</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
