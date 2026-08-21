import React from 'react';
import { FileText, Calendar, CheckCircle2, ShieldCheck } from 'lucide-react';
import { CandidateProfile } from '../../../types';

interface DocumentsTabProps {
  candidate: CandidateProfile;
}

export const DocumentsTab: React.FC<DocumentsTabProps> = ({ candidate }) => {
  const fileName = candidate.fileName || `${candidate.name.toLowerCase().replace(/\s+/g, '_')}_resume.pdf`;

  return (
    <div className="space-y-4">
      {/* Primary Resume Card */}
      <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Primary Resume Document
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            <span>{candidate.processingStatus === 'failed' ? 'Processing Failed' : 'Parsed & Indexed'}</span>
          </span>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-bold text-white truncate">{fileName}</h4>
            <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3 text-purple-400" />
                <span>{candidate.uploadedDate || 'Uploaded on file'}</span>
              </span>
              <span>•</span>
              <span className="text-slate-400">PDF Document</span>
            </div>
          </div>
        </div>

        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1">
          <ShieldCheck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span>Parsed via SYNTRA Canonical Extraction Pipeline</span>
        </div>
      </div>
    </div>
  );
};
