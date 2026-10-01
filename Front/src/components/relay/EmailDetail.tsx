import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Reply,
  Forward,
  Mail,
  Clock,
  Sparkles,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  UserCheck,
  Briefcase,
  MoreHorizontal,
  Send,
  ArrowDown,
  Inbox,
  Loader2,
} from 'lucide-react';
import { RelayEmail, NavigationScreen, RelayThreadMessage, RelayTopMatch } from '../../types';
import { cleanEmailSubject, extractRenderableEmailHtml, plainBodyForDisplay } from './emailBodyUtils';
import { ThreadView } from './ThreadView';
import { EmailBodyView } from './EmailBodyView';
import { apiFetch, apiFetchWithRetry } from '../../services/api';
import { inboxBadgeLabel } from './relayCategoryMap';

interface EmailDetailProps {
  email: RelayEmail | null;
  loadingDetail?: boolean;
  onOpenReply: (mode: 'reply' | 'forward', draft?: string) => void;
  onNavigate?: (screen: NavigationScreen) => void;
}

function latestSentMessage(thread: RelayThreadMessage[]): RelayThreadMessage | null {
  if (!thread.length) return null;
  return [...thread].reverse().find((m) => m.isSelf) || null;
}

function MessageContextCard({
  title,
  subtitle,
  message,
  accent,
  icon,
}: {
  title: string;
  subtitle: string;
  message: RelayThreadMessage;
  accent: 'cyan' | 'purple';
  icon: React.ReactNode;
}) {
  const accentStyles =
    accent === 'cyan'
      ? 'border-cyan-500/35 bg-cyan-950/25'
      : 'border-purple-500/35 bg-purple-950/25';
  const titleColor = accent === 'cyan' ? 'text-cyan-300' : 'text-purple-300';

  return (
    <div className={`rounded-xl border ${accentStyles} overflow-hidden`}>
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
        {icon}
        <div className="min-w-0">
          <p className={`text-[11px] font-bold uppercase tracking-wide ${titleColor}`}>{title}</p>
          <p className="text-[10px] text-slate-400 truncate">{subtitle}</p>
        </div>
        <span className="text-[10px] text-slate-500 font-mono ml-auto shrink-0">{message.timestamp}</span>
      </div>
      <div className="px-3 py-3">
        <EmailBodyView plain={message.body} html={message.bodyHtml} attachments={message.attachments} />
      </div>
    </div>
  );
}

export const EmailDetail: React.FC<EmailDetailProps> = ({ email, loadingDetail, onOpenReply, onNavigate }) => {
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const [topMatches, setTopMatches] = useState<RelayTopMatch[]>(email?.topMatches || []);
  const [shortlistJobId, setShortlistJobId] = useState<string | undefined>(email?.shortlistJobId);
  const [shortlistStatus, setShortlistStatus] = useState<string | undefined>(email?.shortlistStatus);
  const [approving, setApproving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [promotedJobId, setPromotedJobId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!email?.id) return;
    setPromoteError(null);
    setPromotedJobId(null);
    const isJd =
      email.replyIntent === 'Requirement Shared' ||
      email.category === 'Vendor Reply' ||
      Boolean(email.linkedRequirement);
    if (!isJd) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/threads/${email.id}/matches`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setTopMatches(data.topMatches || []);
        setShortlistJobId(data.jobId || undefined);
        setShortlistStatus(data.shortlistStatus || undefined);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email?.id, email?.replyIntent, email?.category, email?.linkedRequirement]);

  const isSentOnly =
    Boolean(email?.isSentOnly) ||
    (email?.category === 'Sent' && email?.hasInbound === false);

  const handleApproveShortlist = async () => {
    if (!shortlistJobId) return;
    setApproving(true);
    try {
      const res = await apiFetchWithRetry(`/jobs/${shortlistJobId}/shortlist/approve`, {
        method: 'POST',
        body: JSON.stringify({ relayThreadId: email?.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Approve failed');
      }
      setShortlistStatus('approved');
    } catch (err: unknown) {
      setPromoteError(err instanceof Error ? err.message : 'Failed to send consent');
    } finally {
      setApproving(false);
    }
  };

  const canPromoteToJd =
    !isSentOnly &&
    email?.replyIntent !== 'Portal Notifications' &&
    email?.replyIntent !== 'Bounce' &&
    email?.category !== 'Sent' &&
    !shortlistJobId &&
    !email?.linkedRequirement?.jobId &&
    !promotedJobId;

  const handlePromoteToJd = async () => {
    if (!email?.id) return;
    setPromoting(true);
    setPromoteError(null);
    try {
      const res = await apiFetch(`/threads/${encodeURIComponent(email.id)}/promote-to-jd`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.rejectReason || data.error || data.message || 'Could not add to JD library');
      }
      const jobId = data.jobId || data.job?.id;
      if (jobId) {
        setPromotedJobId(String(jobId));
        setShortlistJobId(String(jobId));
      }
    } catch (err: unknown) {
      setPromoteError(err instanceof Error ? err.message : 'Failed to add to JD library');
    } finally {
      setPromoting(false);
    }
  };

  const threadForView = useMemo(
    () =>
      email?.thread?.length
        ? email.thread.map((m) => ({
            ...m,
            body: plainBodyForDisplay(m.body),
            bodyHtml: m.bodyHtml || extractRenderableEmailHtml(m.body) || null,
          }))
        : [],
    [email?.thread],
  );

  const latestInbound = useMemo(() => {
    if (!threadForView.length) return email?.relatedInbound || null;
    return [...threadForView].reverse().find((m) => !m.isSelf) || email?.relatedInbound || null;
  }, [threadForView, email?.relatedInbound]);

  const latestSent = useMemo(() => latestSentMessage(threadForView), [threadForView]);

  const primaryMessage = useMemo(() => {
    if (!email) return null;
    if (isSentOnly && latestSent) return latestSent;
    if (latestInbound) return latestInbound;
    if (latestSent) return latestSent;
    if (isSentOnly) {
      return {
        id: email.id,
        senderName: 'You',
        senderEmail: email.sentToRecipient || email.senderEmail,
        toEmail: email.sentToRecipient || email.senderEmail,
        isSelf: true,
        body: plainBodyForDisplay(email.body),
        bodyHtml: email.bodyHtml || extractRenderableEmailHtml(email.body) || null,
        timestamp: email.timestamp,
        attachments: email.attachments,
      } as RelayThreadMessage;
    }
    if (email.body || email.preview || email.suggestedReply) {
      return {
        id: email.id,
        senderName: email.senderName.replace(/^To: /, ''),
        senderEmail: email.senderEmail,
        isSelf: false,
        body: plainBodyForDisplay(email.body || email.preview || email.suggestedReply || ''),
        bodyHtml: email.bodyHtml || extractRenderableEmailHtml(email.body || email.preview || '') || null,
        timestamp: email.timestamp,
        attachments: email.attachments,
      } as RelayThreadMessage;
    }
    return null;
  }, [email, isSentOnly, latestInbound, latestSent]);

  /** Full chronology for multi-message threads (includes latest — avoids hiding vendor replies). */
  const conversationMessages = useMemo(() => {
    if (threadForView.length > 0) return threadForView;
    if (primaryMessage) return [primaryMessage];
    return [];
  }, [threadForView, primaryMessage]);

  const showConversationTimeline =
    conversationMessages.length > 1 ||
    Boolean(email?.relatedInbound) ||
    (email?.messageCount ?? 0) > 1;

  const originalMessage = useMemo(() => {
    const raw = email?.relatedInbound || (!isSentOnly ? null : latestInbound);
    if (!raw) return null;
    return {
      ...raw,
      body: plainBodyForDisplay(raw.body),
      bodyHtml: raw.bodyHtml || extractRenderableEmailHtml(raw.body) || null,
    };
  }, [email?.relatedInbound, isSentOnly, latestInbound]);

  useEffect(() => {
    if (!email || !primaryMessage) {
      setFocusedMessageId(null);
      return;
    }
    setFocusedMessageId(primaryMessage.id);
  }, [email?.id, primaryMessage?.id]);

  if (!email || !primaryMessage) {
    return (
      <div className="h-full glass-card rounded-2xl flex flex-col items-center justify-center p-6 text-center border border-purple-500/20">
        <Mail className="w-10 h-10 text-purple-400/40 mb-2" />
        <h4 className="text-sm font-bold text-slate-300">Select a conversation</h4>
        <p className="text-xs text-slate-500 max-w-xs mt-1">Choose an email from the list to view details here.</p>
      </div>
    );
  }

  const subjectText = cleanEmailSubject(email.subject);
  const sentRecipient = email.sentToRecipient || email.senderEmail.replace(/^To: /i, '').trim();

  return (
    <div className="h-full flex flex-col overflow-hidden glass-card rounded-2xl border border-purple-500/20 min-h-0">
      <div className="shrink-0 px-4 py-3 border-b border-[#261e38] bg-[#100b20]/70 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-white leading-snug">{subjectText}</h2>
            {isSentOnly && (
              <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1.5">
                <Send className="w-3 h-3 text-purple-400" />
                Sent by you to <span className="text-purple-300 font-medium">{sentRecipient || 'recipient'}</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-200 border border-amber-500/25">
                {inboxBadgeLabel(email.category, email.replyIntent)}
              </span>
              {email.senderCompany &&
                email.senderCompany !== 'Unknown' &&
                email.category === 'Vendor Reply' && (
                <span className="text-[10px] text-slate-400">{email.senderCompany}</span>
              )}
              {((email.messageCount ?? email.thread.length) > 1 || (email.threadGroupCount ?? 0) > 1) && (
                <span className="text-[10px] text-violet-300/90 font-medium">
                  {(email.messageCount ?? email.thread.length) > 1 &&
                    `${email.messageCount ?? email.thread.length} messages`}
                  {(email.messageCount ?? email.thread.length) > 1 &&
                    (email.threadGroupCount ?? 0) > 1 &&
                    ' · '}
                  {(email.threadGroupCount ?? 0) > 1 && `${email.threadGroupCount} merged threads`}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            {canPromoteToJd && (
              <button
                type="button"
                onClick={handlePromoteToJd}
                disabled={promoting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50"
              >
                {promoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Briefcase className="w-3.5 h-3.5" />}
                Add to JD Library
              </button>
            )}
            {(promotedJobId || shortlistJobId || email.linkedRequirement?.jobId) && (
              <span className="text-[10px] font-semibold text-emerald-400 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                In JD library
              </span>
            )}
            {onNavigate && (promotedJobId || shortlistJobId) && (
              <button
                type="button"
                onClick={() => onNavigate('jobs')}
                className="text-[10px] font-bold text-purple-300 hover:text-purple-200"
              >
                View JDs →
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenReply('reply')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold"
            >
              <Reply className="w-3.5 h-3.5" />
              Reply
            </button>
            <button
              type="button"
              onClick={() => onOpenReply('forward')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-xs font-semibold"
            >
              <Forward className="w-3.5 h-3.5" />
              Forward
            </button>
            <button
              type="button"
              className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0 ${
              isSentOnly
                ? 'bg-gradient-to-tr from-purple-600 to-violet-500'
                : 'bg-gradient-to-tr from-amber-500 to-orange-500'
            }`}
          >
            {isSentOnly ? 'You' : primaryMessage.senderName.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-100">
              {isSentOnly ? 'Your sent message' : primaryMessage.senderName}
            </p>
            <p className="text-xs text-slate-500 truncate">
              {isSentOnly
                ? `To: ${sentRecipient || primaryMessage.toEmail || 'recipient'}`
                : primaryMessage.senderEmail}
            </p>
          </div>
          {email.senderCompany && email.senderCompany !== 'Unknown' && (
            <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 shrink-0">
              {email.senderCompany}
            </span>
          )}
          <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0 ml-auto">
            <Clock className="w-3.5 h-3.5" />
            {email.receivedDate} · {primaryMessage.timestamp}
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-3">
        {isSentOnly && (
          <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 px-3 py-2.5 flex items-start gap-2">
            <Send className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-purple-200">This is a message you sent</p>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                {originalMessage
                  ? 'Below is the original email you were replying to, followed by your sent message.'
                  : 'No matching received email was found in your inbox for this thread — it may have been an automated follow-up.'}
              </p>
            </div>
          </div>
        )}

        {isSentOnly && originalMessage && (
          <>
            <MessageContextCard
              title="Original message"
              subtitle={`From ${originalMessage.senderName} · ${originalMessage.senderEmail}`}
              message={originalMessage}
              accent="cyan"
              icon={<Inbox className="w-4 h-4 text-cyan-400" />}
            />
            <div className="flex justify-center py-0.5">
              <div className="flex flex-col items-center gap-0.5 text-slate-500">
                <ArrowDown className="w-4 h-4 text-purple-400" />
                <span className="text-[10px] font-semibold text-purple-300">You replied</span>
              </div>
            </div>
          </>
        )}

        {isSentOnly && primaryMessage ? (
          loadingDetail && !primaryMessage.body?.trim() ? (
            <p className="text-[11px] text-slate-400 text-center py-6 animate-pulse">
              Loading full email content…
            </p>
          ) : (
            <MessageContextCard
              title="Your sent message"
              subtitle={`To ${sentRecipient || primaryMessage.toEmail || 'recipient'}`}
              message={primaryMessage}
              accent="purple"
              icon={<Send className="w-4 h-4 text-purple-400" />}
            />
          )
        ) : (
          <>
        {promoteError && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs text-red-300">
            {promoteError}
          </div>
        )}

        {email.actionRequired && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-orange-950/30 border border-orange-500/30">
            <Lightbulb className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-orange-400 mb-0.5">
                Recommended Action
              </p>
              <p className="text-xs text-orange-100 leading-relaxed">{email.actionRequired.recommendation}</p>
            </div>
          </div>
        )}

        {email.aiSummary && (
          <div className="rounded-xl border border-indigo-500/25 bg-indigo-950/20 overflow-hidden">
            <button
              type="button"
              onClick={() => setSummaryOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/[0.03]"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-indigo-200">
                <Sparkles className="w-4 h-4" />
                Message preview
              </span>
              {summaryOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {summaryOpen && (
              <div className="px-3 pb-3 text-xs text-slate-300 leading-relaxed border-t border-indigo-500/15 pt-2">
                {email.aiSummary.summary}
              </div>
            )}
          </div>
        )}

        {email.linkedRequirement && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
              <Briefcase className="w-4 h-4" />
              Linked Requirement (Astra)
            </div>
            <p className="text-sm font-semibold text-slate-100">{email.linkedRequirement.role}</p>
            <div className="flex flex-wrap gap-2 text-[10px] text-slate-400">
              <span className="font-mono text-emerald-300">{email.linkedRequirement.jdCode}</span>
              <span>·</span>
              <span>{email.linkedRequirement.experience}</span>
              <span>·</span>
              <span>{email.linkedRequirement.location}</span>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('jobs')}
                className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
              >
                View JD →
              </button>
            )}
          </div>
        )}

        {topMatches.length > 0 && (
          <div className="rounded-xl border border-teal-500/30 bg-teal-950/20 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-teal-300">
                <UserCheck className="w-4 h-4" />
                Syntra Top Matches
              </div>
              {shortlistStatus === 'pending_approval' && shortlistJobId && (
                <button
                  type="button"
                  onClick={handleApproveShortlist}
                  disabled={approving}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold disabled:opacity-50"
                >
                  {approving ? 'Sending…' : 'Approve & Send Consent'}
                </button>
              )}
              {shortlistStatus === 'approved' && (
                <span className="text-[10px] font-semibold text-emerald-400">Consent sent</span>
              )}
            </div>
            <div className="space-y-1.5">
              {topMatches.map((m) => (
                <div
                  key={m.candidateId}
                  className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg bg-black/20"
                >
                  <span className="text-xs font-semibold text-slate-200 truncate">{m.candidateName}</span>
                  <span className="text-xs font-bold text-teal-300 shrink-0">{Math.round(m.score)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!showConversationTimeline && (
          <>
            {loadingDetail && !primaryMessage.body?.trim() ? (
              <p className="text-[11px] text-slate-400 text-center py-6 animate-pulse">
                Loading full email content…
              </p>
            ) : (
              <EmailBodyView
                plain={primaryMessage.body}
                html={primaryMessage.bodyHtml}
                attachments={primaryMessage.attachments || email.attachments}
              />
            )}
          </>
        )}

        {loadingDetail && conversationMessages.length <= 1 && (email.messageCount ?? 0) > 1 && (
          <p className="text-[11px] text-slate-400 text-center py-3 animate-pulse">
            Loading full conversation…
          </p>
        )}

        {showConversationTimeline && conversationMessages.length > 0 && (
          <ThreadView
            thread={conversationMessages}
            activeMessageId={focusedMessageId}
            onSelectMessage={(msg) => setFocusedMessageId(msg.id)}
          />
        )}

        {email.relatedCandidate && (
          <div className="rounded-xl border border-purple-500/30 bg-purple-950/25 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
              <UserCheck className="w-4 h-4" />
              Related Candidate
            </div>
            <p className="text-sm font-semibold text-slate-100">
              {email.relatedCandidate.name}
              {email.relatedCandidate.role ? ` — ${email.relatedCandidate.role}` : ''}
            </p>
            <p className="text-[11px] text-slate-400">
              {email.relatedCandidate.experience}
              {email.relatedCandidate.status ? ` · ${email.relatedCandidate.status}` : ''}
            </p>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('resumes')}
                className="text-xs font-semibold text-purple-300 hover:text-purple-200"
              >
                View Candidate →
              </button>
            )}
          </div>
        )}
          </>
        )}

      </div>
    </div>
  );
};
