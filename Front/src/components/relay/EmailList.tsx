import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Mail, Paperclip } from 'lucide-react';
import { RelayEmail } from '../../types';
import { inboxBadgeLabel } from './relayCategoryMap';

interface EmailListProps {
  emails: RelayEmail[];
  selectedEmailId: string | null;
  onSelectEmail: (email: RelayEmail) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterStatus: 'all' | 'unread' | 'priority';
  onFilterStatusChange: (status: 'all' | 'unread' | 'priority') => void;
}

const BADGE_STYLES: Record<string, { bg: string; text: string; border: string; accent: string; avatar: string }> = {
  'Vendor Reply': { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/30', accent: 'border-l-amber-400', avatar: 'from-amber-600 to-orange-500' },
  'Non-Vendor Reply': { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30', accent: 'border-l-emerald-400', avatar: 'from-emerald-600 to-teal-500' },
  'Candidate Response': { bg: 'bg-teal-500/15', text: 'text-teal-300', border: 'border-teal-500/30', accent: 'border-l-teal-400', avatar: 'from-teal-600 to-cyan-500' },
  'Interview Response': { bg: 'bg-blue-500/15', text: 'text-blue-300', border: 'border-blue-500/30', accent: 'border-l-blue-400', avatar: 'from-blue-600 to-indigo-500' },
  Bounce: { bg: 'bg-red-500/15', text: 'text-red-300', border: 'border-red-500/30', accent: 'border-l-red-400', avatar: 'from-red-600 to-rose-500' },
  'Follow-up': { bg: 'bg-purple-500/15', text: 'text-purple-300', border: 'border-purple-500/30', accent: 'border-l-purple-400', avatar: 'from-purple-600 to-violet-500' },
  'Portal Notifications': { bg: 'bg-cyan-500/15', text: 'text-cyan-300', border: 'border-cyan-500/30', accent: 'border-l-cyan-400', avatar: 'from-cyan-600 to-sky-500' },
  Sent: { bg: 'bg-slate-500/15', text: 'text-slate-300', border: 'border-slate-500/30', accent: 'border-l-slate-400', avatar: 'from-slate-600 to-zinc-500' },
};

/** Fixed row height for windowed rendering (~5–6 visible rows). */
const ROW_PX = 92;
const OVERSCAN = 8;

export const EmailList: React.FC<EmailListProps> = ({
  emails,
  selectedEmailId,
  onSelectEmail,
  searchQuery,
  onSearchChange,
  filterStatus,
  onFilterStatusChange,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight || 600);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
  }, []);

  const { start, end, offsetY, totalH } = useMemo(() => {
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_PX) - OVERSCAN);
    const visible = Math.ceil(viewportH / ROW_PX) + OVERSCAN * 2;
    const endIdx = Math.min(emails.length, startIdx + visible);
    return {
      start: startIdx,
      end: endIdx,
      offsetY: startIdx * ROW_PX,
      totalH: emails.length * ROW_PX,
    };
  }, [emails.length, scrollTop, viewportH]);

  const visibleEmails = emails.slice(start, end);

  return (
    <div className="h-full flex flex-col overflow-hidden glass-card rounded-2xl border border-purple-500/20">
      <div className="shrink-0 p-2.5 border-b border-[#261e38] space-y-2 bg-[#100b20]/60">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations, skills, candidates..."
            className="w-full glass-input pl-9 pr-3 py-2 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center bg-white/5 p-0.5 rounded-xl border border-white/5 text-[11px]">
          {(['all', 'unread', 'priority'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onFilterStatusChange(key)}
              className={`flex-1 py-1 rounded-lg font-semibold transition capitalize ${
                filterStatus === key
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
      >
        {emails.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500 space-y-2">
            <Mail className="w-8 h-8 text-slate-600 mx-auto" />
            <p>No messages in this category.</p>
          </div>
        ) : (
          <div style={{ height: totalH, position: 'relative' }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
              {visibleEmails.map((email, i) => {
                const isSelected = selectedEmailId === email.id;
                const badgeStyle = BADGE_STYLES[email.category] || BADGE_STYLES['Portal Notifications'];
                const initial = (email.senderName.replace(/^To: /, '').charAt(0) || '?').toUpperCase();
                const previewOneLine = (email.preview || '').replace(/\s+/g, ' ').trim();

                return (
                  <button
                    type="button"
                    key={email.id || `${start + i}`}
                    onClick={() => onSelectEmail(email)}
                    style={{ height: ROW_PX }}
                    className={`shrink-0 w-full text-left px-2.5 py-2 border-b border-[#261e38]/60 border-l-[3px] cursor-pointer transition-colors overflow-hidden ${
                      badgeStyle.accent
                    } ${isSelected ? 'glass-card-selected bg-purple-500/10 ring-1 ring-purple-500/40' : 'hover:bg-white/[0.04]'}`}
                  >
                    <div className="flex items-start justify-between gap-2 h-full overflow-hidden">
                      <div className="flex gap-2 min-w-0 flex-1 h-full overflow-hidden">
                        <div
                          className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${badgeStyle.avatar} border border-white/10 flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm`}
                        >
                          {initial}
                        </div>
                        <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5 overflow-hidden">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {email.isUnread && (
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                            )}
                            <p className="text-xs font-bold text-slate-100 truncate">{email.senderName}</p>
                          </div>
                          <p
                            className={`text-[11px] truncate ${email.isUnread ? 'text-slate-200 font-semibold' : 'text-slate-400'}`}
                          >
                            {email.subject}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate">{previewOneLine}</p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-0.5 overflow-hidden max-h-5">
                            {(email.threadGroupCount ?? 0) > 1 && (
                              <span className="text-[9px] font-bold text-violet-200 bg-violet-500/20 px-1.5 py-0.5 rounded border border-violet-400/30">
                                {email.threadGroupCount} threads
                              </span>
                            )}
                            {(email.messageCount ?? 0) > 1 && (
                              <span className="text-[9px] font-semibold text-indigo-200 bg-indigo-500/15 px-1.5 py-0.5 rounded border border-indigo-400/25">
                                {email.messageCount} msgs
                              </span>
                            )}
                            {email.hasAttachments && <Paperclip className="w-3 h-3 text-purple-400" />}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0 gap-1 h-full justify-between py-0.5">
                        <span className="text-[10px] text-slate-500 font-mono">{email.timestamp}</span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border leading-tight text-center max-w-[6.5rem] truncate ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                          title={email.replyIntent ? `Intent: ${email.replyIntent}` : email.category}
                        >
                          {inboxBadgeLabel(email.category, email.replyIntent)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};