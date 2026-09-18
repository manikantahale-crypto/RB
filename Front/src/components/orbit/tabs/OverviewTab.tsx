import React from 'react';
import { CandidateProfile } from '../../../types';
import { StatusBadge } from '../StatusBadge';

interface OverviewTabProps {
  candidate: CandidateProfile;
  onOpenTransition?: () => void;
}

function calculateDaysOnBench(dateString?: string): string {
  if (!dateString) return '15 days';
  const createdTime = new Date(dateString).getTime();
  if (isNaN(createdTime)) return '15 days';
  const now = Date.now();
  const diffDays = Math.max(1, Math.floor((now - createdTime) / (1000 * 60 * 60 * 24)));
  return `${diffDays} days`;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ candidate, onOpenTransition }) => {
  const benchDays = calculateDaysOnBench(candidate.uploadedDate);
  const formattedAvailableFrom = candidate.uploadedDate || 'Aug 1, 2026';

  return (
    <div className="space-y-4 text-slate-200">
      {/* 1. LIFECYCLE CARD */}
      <div className="p-4 rounded-xl bg-[#120c24]/90 border border-[#261e38] space-y-3 shadow-inner shadow-black/20">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Lifecycle
          </span>
          {onOpenTransition && (
            <button
              onClick={onOpenTransition}
              className="text-[10px] font-semibold text-purple-400 hover:text-purple-300 transition cursor-pointer underline"
            >
              Update
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs">
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
              Current Status
            </span>
            <span className="font-extrabold text-white text-xs tracking-wide">
              {(candidate.orbit_lifecycle_state || 'AVAILABLE').toUpperCase()}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
              Availability
            </span>
            <span className="font-extrabold text-white text-xs tracking-wide">
              {(candidate.orbit_lifecycle_state === 'PLACED' ? 'PLACED' : candidate.orbit_lifecycle_state === 'NOTICE' ? 'NOTICE' : 'AVAILABLE')}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
              Bench Age
            </span>
            <span className="font-medium text-slate-300">
              {benchDays}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
              Available From
            </span>
            <span className="font-medium text-slate-300">
              {formattedAvailableFrom}
            </span>
          </div>
        </div>
      </div>

      {/* 2. PROFILE CARD */}
      <div className="p-4 rounded-xl bg-[#120c24]/90 border border-[#261e38] space-y-3 shadow-inner shadow-black/20">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
          Profile
        </span>
        <div className="grid grid-cols-2 gap-y-3.5 gap-x-4 text-xs">
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Full Name</span>
            <span className="font-semibold text-slate-100">{candidate.name}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Title</span>
            <span className="font-semibold text-slate-100 truncate block" title={candidate.title}>
              {candidate.title || 'Software Professional'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Email</span>
            <span className="font-medium text-slate-300 truncate block" title={candidate.email || 'Not specified'}>
              {candidate.email || '—'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Phone</span>
            <span className="font-medium text-slate-300">
              {candidate.phone || '—'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Location</span>
            <span className="font-medium text-slate-300">
              {candidate.location && candidate.location !== 'N/A' ? candidate.location : '—'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Experience</span>
            <span className="font-medium text-slate-300">
              {candidate.experience && candidate.experience !== 'Not specified' ? candidate.experience : candidate.expYears ? `${candidate.expYears} years` : '—'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Work Authorization</span>
            <span className="font-semibold text-purple-300">
              {candidate.visa && candidate.visa !== 'N/A' ? candidate.visa : '—'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Relocation</span>
            <span className="font-medium text-slate-300">Open to relocation</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Employment Model</span>
            <span className="font-medium text-slate-300">W2</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Assigned To</span>
            <span className="font-medium text-slate-300">Recruiter</span>
          </div>
        </div>
      </div>

      {/* 3. PROFESSIONAL SUMMARY CARD */}
      <div className="p-4 rounded-xl bg-[#120c24]/90 border border-[#261e38] space-y-2 shadow-inner shadow-black/20">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
          Professional Summary
        </span>
        <p className="text-xs text-slate-300 leading-relaxed font-normal whitespace-pre-wrap">
          {candidate.summary || 'No professional summary available.'}
        </p>
      </div>
    </div>
  );
};
