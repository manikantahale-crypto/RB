import React, { useState } from 'react';
import {
  User,
  Mail,
  Phone,
  Building,
  Tag,
  Plus,
  X,
  UserPlus,
  FilePlus,
  CheckSquare,
  ListPlus,
  Clock,
  ExternalLink,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import { RelayEmail } from '../../types';

interface ContactSidebarProps {
  email: RelayEmail | null;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
}

export const ContactSidebar: React.FC<ContactSidebarProps> = ({
  email,
  onAddTag,
  onRemoveTag,
}) => {
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  if (!email) {
    return (
      <div className="h-full glass-card rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-2 border border-purple-500/20">
        <User className="w-8 h-8 text-slate-600" />
        <p className="text-xs text-slate-500">Select an email to view contact & contextual actions.</p>
      </div>
    );
  }

  const handleActionClick = (actionName: string) => {
    setActionFeedback(`${actionName} action triggered (UI Placeholder).`);
    setTimeout(() => setActionFeedback(null), 2500);
  };

  const handleSaveTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagInput.trim()) {
      onAddTag?.(newTagInput.trim());
      setNewTagInput('');
      setIsAddingTag(false);
    }
  };

  return (
    <div className="h-full glass-card rounded-2xl flex flex-col overflow-y-auto divide-y divide-[#261e38] border border-purple-500/20 text-xs">
      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div className="p-3 bg-purple-600/20 border-b border-purple-500/30 text-purple-200 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* SECTION 1: Contact Details */}
      <div className="p-5 space-y-3.5 bg-[#100b20]/40">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Contact Details
          </span>
          <span className="text-[10px] text-purple-400 font-semibold bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20">
            Verified
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-sm font-bold text-white shadow-md shadow-purple-900/30">
            {email.contact.name.charAt(0)}
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-100">{email.contact.name}</h4>
            <p className="text-[11px] text-purple-300 font-medium">{email.contact.title || 'Partner'}</p>
          </div>
        </div>

        <div className="space-y-2 pt-1 text-slate-300">
          <div className="flex items-center gap-2.5">
            <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="truncate">{email.contact.email}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>{email.contact.phone}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Building className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>{email.contact.company}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => handleActionClick('View Contact')}
          className="w-full mt-2 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>View Contact</span>
        </button>
      </div>

      {/* SECTION 2: Email Details / Metadata */}
      <div className="p-5 space-y-3">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
          Email Details
        </span>

        <div className="space-y-2 text-slate-300">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Source</span>
            <span className="font-semibold text-slate-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {email.emailDetails.source}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-500">Received</span>
            <span className="font-mono text-[11px] text-slate-300">{email.emailDetails.receivedAt}</span>
          </div>

          <div className="flex items-start justify-between gap-2">
            <span className="text-slate-500">To</span>
            <span className="font-mono text-[11px] text-slate-300 truncate max-w-[140px]">
              {email.emailDetails.to}
            </span>
          </div>

          {email.emailDetails.cc && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-slate-500">CC</span>
              <span className="font-mono text-[11px] text-slate-300 truncate max-w-[140px]">
                {email.emailDetails.cc}
              </span>
            </div>
          )}

          <div className="flex items-start justify-between gap-2 pt-1 border-t border-white/5">
            <span className="text-slate-500">Message ID</span>
            <span className="font-mono text-[10px] text-slate-400 truncate max-w-[130px]" title={email.emailDetails.messageId}>
              {email.emailDetails.messageId}
            </span>
          </div>

          <div className="flex items-start justify-between gap-2">
            <span className="text-slate-500">Thread ID</span>
            <span className="font-mono text-[10px] text-slate-400 truncate max-w-[130px]">
              {email.emailDetails.threadId}
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 3: Tags */}
      <div className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            Tags
          </span>
          <Tag className="w-3.5 h-3.5 text-purple-400" />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {email.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[11px] font-semibold"
            >
              <span>{tag}</span>
              <button
                type="button"
                onClick={() => onRemoveTag?.(tag)}
                className="text-purple-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          {isAddingTag ? (
            <form onSubmit={handleSaveTag} className="inline-flex items-center gap-1">
              <input
                type="text"
                autoFocus
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                placeholder="Tag name..."
                className="w-24 px-2 py-0.5 rounded-lg bg-white/10 border border-purple-500/50 text-[11px] text-white focus:outline-none"
              />
              <button type="submit" className="text-purple-400 font-bold px-1">
                ✓
              </button>
              <button type="button" onClick={() => setIsAddingTag(false)} className="text-slate-500 px-1">
                ✕
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsAddingTag(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 text-[11px] font-semibold transition cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Add Tag</span>
            </button>
          )}
        </div>
      </div>

      {/* SECTION 4: Contextual Actions */}
      <div className="p-5 space-y-3">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
          Actions
        </span>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={() => handleActionClick('Create Candidate')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-600/15 border border-purple-500/30 hover:bg-purple-600/25 text-purple-200 font-semibold text-xs transition cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5 text-purple-400" />
            <span>Create Candidate</span>
          </button>

          <button
            type="button"
            onClick={() => handleActionClick('Create JD')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600/15 border border-emerald-500/30 hover:bg-emerald-600/25 text-emerald-200 font-semibold text-xs transition cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5 text-emerald-400" />
            <span>Create JD</span>
          </button>

          <button
            type="button"
            onClick={() => handleActionClick('Create Task')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600/15 border border-blue-500/30 hover:bg-blue-600/25 text-blue-200 font-semibold text-xs transition cursor-pointer"
          >
            <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
            <span>Create Task</span>
          </button>

          <button
            type="button"
            onClick={() => handleActionClick('Add to Sequence')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-600/15 border border-amber-500/30 hover:bg-amber-600/25 text-amber-200 font-semibold text-xs transition cursor-pointer"
          >
            <ListPlus className="w-3.5 h-3.5 text-amber-400" />
            <span>Add to Sequence</span>
          </button>
        </div>
      </div>

      {/* SECTION 5: Activity Log */}
      <div className="p-5 space-y-2 bg-[#100b20]/40">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-[11px] font-bold uppercase tracking-wider">Activity</span>
          <Eye className="w-3.5 h-3.5 text-slate-500" />
        </div>

        <div className="space-y-1 text-[11px] text-slate-400">
          <p className="flex items-center justify-between">
            <span>Opened</span>
            <span className="font-semibold text-slate-200">{email.activity.openCount} times</span>
          </p>
          <p className="flex items-center justify-between">
            <span>Last opened</span>
            <span className="font-mono text-slate-300">{email.activity.lastOpenedAt}</span>
          </p>
        </div>
      </div>
    </div>
  );
};
