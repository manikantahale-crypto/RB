import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, RefreshCw, Filter, ChevronDown } from 'lucide-react';
import { RelayCategory, RelayEmail, NavigationScreen } from '../../types';
import { CATEGORY_ORDER, RELAY_CATEGORY_CONFIG } from './relayMockData';
import { mapReplyIntentToCategory, isRecruiterPriorityEmail } from './relayCategoryMap';
import { plainEmailPreview, cleanEmailSubject, inboxSummaryText, compactEmailBody } from './emailBodyUtils';
import { recruiterActionForIntent } from './recruiterActions';
import { EmailList } from './EmailList';
import { EmailDetail } from './EmailDetail';
import { ReplyComposerModal } from './ReplyComposerModal';
import { apiFetch, apiFetchWithTimeout } from '../../services/api';

interface RelayWorkspaceProps {
  onNavigate?: (screen: NavigationScreen) => void;
}

export const RelayWorkspace: React.FC<RelayWorkspaceProps> = ({ onNavigate }) => {
  const [emails, setEmails] = useState<RelayEmail[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<RelayCategory[]>([]);
  const [selectedEmailId, setSelectedEmailId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread' | 'priority'>('all');
  /** Keep unread-tab rows visible after opening (Gmail-style) until user leaves Unread. */
  const [readInSession, setReadInSession] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [detailById, setDetailById] = useState<Record<string, RelayEmail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const loadedDetailRef = useRef<Set<string>>(new Set());

  const fetchWithTimeout = useCallback(async (url: string, ms = 45000) => {
    return await apiFetchWithTimeout(url, {}, ms);
  }, []);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const [composerDraft, setComposerDraft] = useState<string | undefined>();
  const [replyModalState, setReplyModalState] = useState<{ isOpen: boolean; mode: 'reply' | 'forward' }>({
    isOpen: false,
    mode: 'reply',
  });

  const mapThreadToEmail = (t: any): RelayEmail => {
    const threadMsgs = t.threadMessages || [];
    const latestInbound = [...threadMsgs].reverse().find((m: any) => !m.isSelf) || threadMsgs[threadMsgs.length - 1];
    const category = mapReplyIntentToCategory(t.replyIntent, {
      direction: t.direction,
      vendorMatch: Boolean(t.vendorId),
      registeredCandidate: Boolean(t.registeredCandidate),
      hasInbound: t.hasInbound !== false && Boolean(t.hasInbound ?? t.preview),
    });
    const isSentOnly =
      Boolean(t.isSentOnly) ||
      (category === 'Sent' && t.hasInbound === false);
    const latestSent = [...threadMsgs].reverse().find((m: any) => m.isSelf);
    const relatedInbound = t.relatedInboundMessage || t.relatedInbound || undefined;
    // List payload has empty threadMessages — use short API preview only (avoid heavy HTML stripping on 400+ rows).
    const hasDetailBodies = threadMsgs.some((m: any) => m.body || m.bodyHtml);
    const displayBody = isSentOnly
      ? latestSent?.body || t.body || t.preview || ''
      : latestInbound?.body || t.body || t.preview || '';

    const plainBody = compactEmailBody(displayBody);

    const preview = plainEmailPreview(
      t.preview || (hasDetailBodies ? plainBody : '') || t.subject || '',
      72,
    );

    const recruiterAction =
      recruiterActionForIntent(t.replyIntent, category) ||
      (t.recruiterAction ? recruiterActionForIntent(t.recruiterAction, category) : null);
    const autoReplyNote =
      t.requiresFollowup && category !== 'Sent' && category !== 'Portal Notifications'
        ? 'Next: Relay auto-drafts and sends a reply based on intent and conversation history (RELAY_AUTO_REPLY=1).'
        : null;
    const staffingCategory =
      category !== 'Portal Notifications' && category !== 'Sent' && category !== 'Bounce';

    const company =
      category !== 'Portal Notifications' && category !== 'Sent'
        ? t.registeredCandidate
          ? 'Registered candidate'
          : t.vendorId
            ? 'Registered vendor'
            : undefined
        : undefined;

    const summaryText = hasDetailBodies ? inboxSummaryText(displayBody) : null;
    const followupOpen = Boolean(t.followup?.status === 'Open');
    const isPriority = isRecruiterPriorityEmail(category, {
      priority: t.priority,
      requiresFollowup: Boolean(t.requiresFollowup),
      followupOpen,
    });

    return {
      id: t.threadId,
      category,
      replyIntent: t.replyIntent,
      senderName: isSentOnly
        ? `To: ${t.sentToRecipient || t.latestSender || 'Recipient'}`
        : latestInbound?.senderName || t.latestSender || 'Unknown',
      senderEmail: isSentOnly
        ? t.sentToRecipient || t.latestSenderEmail || ''
        : latestInbound?.senderEmail || t.latestSenderEmail || '',
      senderCompany: company,
      subject: cleanEmailSubject(t.subject || 'No Subject'),
      preview,
      body: displayBody,
      bodyHtml: isSentOnly
        ? latestSent?.bodyHtml || t.bodyHtml || null
        : latestInbound?.bodyHtml || t.bodyHtml || null,
      timestamp: t.latestDate ? new Date(t.latestDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      receivedDate: t.latestDate ? new Date(t.latestDate).toLocaleDateString() : '',
      isUnread: category !== 'Sent' && !isSentOnly,
      isPriority,
      requiresFollowup: Boolean(t.requiresFollowup),
      hasAttachments: Boolean(
        t.threadMessages?.some((m: any) => m.attachments?.length) || t.attachments?.length,
      ),
      attachments:
        latestInbound?.attachments ||
        t.threadMessages?.[t.threadMessages.length - 1]?.attachments ||
        t.attachments ||
        undefined,
      tags: [category, ...(isSentOnly ? ['Sent by you'] : []), t.replyIntent].filter(Boolean) as string[],
      contact: {
        name: t.latestSender || 'Unknown',
        email: t.latestSenderEmail || '',
        phone: '',
        company: company ?? 'Unknown',
      },
      emailDetails: {
        source: 'api',
        receivedAt: t.latestDate,
        to: 'me@syntra.com',
        messageId: t.threadId,
        threadId: t.threadId,
      },
      thread: threadMsgs.map((m: any) => ({
        ...m,
        body: m.body || '',
        bodyHtml: m.bodyHtml || null,
      })),
      activity: { openCount: 0, lastOpenedAt: '' },
      relatedCandidate:
        t.registeredCandidate && category !== 'Portal Notifications' && category !== 'Sent'
          ? {
              name: t.registeredCandidate.name,
              role: 'Bench candidate',
              experience: '—',
              status: 'Registered',
            }
          : undefined,
      actionRequired:
        recruiterAction && staffingCategory && (isPriority || t.requiresFollowup)
          ? {
              status: 'Action Required' as const,
              recommendation: [recruiterAction, autoReplyNote].filter(Boolean).join(' — '),
              variant: 'orange' as const,
            }
          : undefined,
      aiSummary:
        summaryText && staffingCategory && isPriority
          ? { summary: summaryText, keyPoints: [] }
          : undefined,
      suggestedReply: t.suggestedReply || undefined,
      messageCount: t.messageCount,
      threadGroupCount: t.threadGroupCount,
      isSentOnly,
      hasInbound: Boolean(t.hasInbound),
      sentToRecipient: t.sentToRecipient || undefined,
      relatedInbound: relatedInbound
        ? {
            ...relatedInbound,
            body: relatedInbound.body || '',
            bodyHtml: relatedInbound.bodyHtml || null,
          }
        : undefined,
    };
  };

  const applyThreadPayload = useCallback((rows: any[]) => {
    if (rows?.length) {
      const mapped = rows.map(mapThreadToEmail);
      setEmails(mapped);
      setSelectedEmailId((prev) => (prev && mapped.some((e) => e.id === prev) ? prev : mapped[0]?.id || ''));
      setLoadError(null);
    } else {
      setEmails([]);
      setSelectedEmailId('');
    }
  }, []);

  const fetchThreads = useCallback(async () => {
    let lastStatus = 0;
    let lastMessage = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchWithTimeout('/threads', 20000);
      lastStatus = res.status;
      if (res.ok) {
        const data = await res.json();
        applyThreadPayload(data?.data || []);
        return data?.data?.length ?? 0;
      }
      const body = await res.json().catch(() => ({}));
      lastMessage = body.message || body.error || '';
      if (res.status === 503 && body.status !== 'failed' && body.status !== 'disabled' && attempt < 1) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      break;
    }
    throw new Error(
      lastStatus === 503
        ? lastMessage ||
            'Smart Inbox is still starting inside the API. Wait a few seconds and click Refresh.'
        : `Inbox API returned ${lastStatus}. ${lastMessage || 'Is the API server running?'}`,
    );
  }, [applyThreadPayload, fetchWithTimeout]);

  const syncMailbox = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setSyncing(true);
      setLoadError(null);
      try {
        try {
          await fetchThreads();
        } catch {
          /* list may still succeed after background sync */
        }
        setLoading(false);
        void fetchWithTimeout('/fetch-now', 8000).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 4000));
        try {
          await fetchThreads();
        } catch {
          /* keep whatever we already showed */
        }
        setLastSyncedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        loadedDetailRef.current.clear();
        setDetailById({});
      } catch (err: any) {
        console.error('Smart Inbox sync failed:', err);
        setLoadError(err?.message || 'Could not reach the inbox API.');
        try {
          await fetchThreads();
        } catch {
          /* keep cached/error state */
        }
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    },
    [fetchThreads, fetchWithTimeout],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        await fetchThreads();
        if (!cancelled) setLastSyncedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (err: any) {
        if (!cancelled) {
          const msg =
            err?.name === 'AbortError'
              ? 'Inbox load timed out. Click Refresh or restart relay (npm run dev).'
              : err?.message || 'Could not load inbox.';
          setLoadError(msg);
          setEmails([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchThreads]);

  useEffect(() => {
    if (!selectedEmailId) return;
    if (loadedDetailRef.current.has(selectedEmailId)) return;

    let cancelled = false;
    setDetailLoading(true);
    fetchWithTimeout(`/threads/${encodeURIComponent(selectedEmailId)}`, 20000)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load conversation (${res.status})`);
        const payload = await res.json();
        if (cancelled || !payload?.data) return;
        const detailed = mapThreadToEmail(payload.data);
        loadedDetailRef.current.add(selectedEmailId);
        setDetailById((prev) => ({ ...prev, [selectedEmailId]: detailed }));
      })
      .catch((err) => {
        if (!cancelled) console.warn('Thread detail load failed:', err);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEmailId, fetchWithTimeout]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(e.target as Node)) {
        setCategoryMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const categoryCounts = useMemo(() => {
    const isFollowUp = (e: RelayEmail) =>
      e.category === 'Follow-up' ||
      e.replyIntent === 'Follow-up' ||
      e.replyIntent === 'Follow-Up Needed' ||
      Boolean(e.requiresFollowup);

    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      count:
        cat === 'All'
          ? emails.length
          : cat === 'Candidate Response'
            ? emails.filter((e) => e.relatedCandidate || e.category === cat).length
            : cat === 'Follow-up'
              ? emails.filter(isFollowUp).length
              : emails.filter((e) => e.category === cat).length,
      badgeBg: RELAY_CATEGORY_CONFIG[cat].badgeBg,
      badgeText: RELAY_CATEGORY_CONFIG[cat].badgeText,
    }));
  }, [emails]);

  const toggleCategory = (cat: RelayCategory) => {
    if (cat === 'All') {
      setSelectedCategories([]);
      return;
    }
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const filteredEmails = useMemo(() => {
    let result = [...emails];

    if (selectedCategories.length > 0) {
      result = result.filter((e) => {
        const followUpMatch =
          selectedCategories.includes('Follow-up') &&
          (e.category === 'Follow-up' ||
            e.replyIntent === 'Follow-up' ||
            e.replyIntent === 'Follow-Up Needed' ||
            e.requiresFollowup);
        const candidateMatch =
          selectedCategories.includes('Candidate Response') && e.relatedCandidate;
        const catMatch = selectedCategories.includes(e.category);
        return followUpMatch || candidateMatch || catMatch;
      });
    }

    if (filterStatus === 'unread') {
      result = result.filter(
        (e) =>
          (e.isUnread || readInSession.has(e.id)) &&
          e.category !== 'Sent' &&
          !e.isSentOnly,
      );
    } else if (filterStatus === 'priority') {
      result = result.filter((e) => e.isPriority);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.senderName.toLowerCase().includes(q) ||
          e.subject.toLowerCase().includes(q) ||
          e.preview.toLowerCase().includes(q),
      );
    }

    result.sort((a, b) => (b.emailDetails.receivedAt || '').localeCompare(a.emailDetails.receivedAt || ''));
    return result;
  }, [emails, selectedCategories, filterStatus, searchQuery, readInSession]);

  useEffect(() => {
    if (filterStatus !== 'unread') {
      setReadInSession(new Set());
    }
  }, [filterStatus]);

  useEffect(() => {
    if (!filteredEmails.length) return;
    if (selectedEmailId && filteredEmails.some((e) => e.id === selectedEmailId)) return;
    setSelectedEmailId(filteredEmails[0].id);
  }, [filteredEmails, filterStatus, selectedCategories]);

  const selectedEmail = useMemo(() => {
    const base =
      (selectedEmailId ? emails.find((e) => e.id === selectedEmailId) : undefined) ||
      filteredEmails.find((e) => e.id === selectedEmailId) ||
      filteredEmails[0] ||
      null;
    if (!base) return null;
    const detail = detailById[base.id];
    if (!detail) return base;
    const hasInbound = detail.thread?.some((m) => !m.isSelf) || Boolean(detail.relatedInbound);
        const merged = {
      ...base,
      ...detail,
      preview: base.preview || detail.preview,
      body: (detail.body && detail.body.trim()) || base.body || '',
      bodyHtml: detail.bodyHtml || base.bodyHtml || null,
      thread: detail.thread?.length ? detail.thread : base.thread,
    };
    if (!hasInbound && base.category === 'Sent') {
      merged.senderName = base.senderName;
      merged.senderEmail = base.senderEmail;
      merged.relatedCandidate = undefined;
      merged.senderCompany = base.senderCompany;
    }
    return merged;
  }, [emails, filteredEmails, selectedEmailId, detailById]);

  const handleOpenReply = async (mode: 'reply' | 'forward', draft?: string) => {
    if (mode === 'reply' && selectedEmail && !draft) {
      try {
        const res = await apiFetch(`/threads/${selectedEmail.id}/draft`);
        if (res.ok) {
          const data = await res.json();
          setComposerDraft(data.body);
        } else {
          setComposerDraft(selectedEmail.suggestedReply);
        }
      } catch {
        setComposerDraft(selectedEmail.suggestedReply);
      }
    } else {
      setComposerDraft(draft);
    }
    setReplyModalState({ isOpen: true, mode });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden px-3 py-2 max-w-[1800px] mx-auto w-full">
      <div className="shrink-0 mb-1 flex items-center justify-between gap-2 min-h-[1.25rem]">
        {loading ? (
          <span className="text-[11px] text-slate-500">Loading inbox…</span>
        ) : loadError ? (
          <span className="text-[11px] text-amber-400 flex items-center gap-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{loadError}</span>
          </span>
        ) : (
          <span className="text-[11px] text-slate-500">
            {emails.length} conversation{emails.length === 1 ? '' : 's'}
            {lastSyncedAt ? ` · synced ${lastSyncedAt}` : ''}
          </span>
        )}
        <button
          type="button"
          onClick={() => syncMailbox()}
          disabled={syncing}
          className="flex items-center gap-1 text-[11px] font-semibold text-purple-300 hover:text-purple-200 disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      <div className="shrink-0 flex items-center gap-2 pb-1 mb-2 flex-wrap">
        {selectedCategories.map((cat) => (
          <span
            key={cat}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-600/30 text-purple-100 border border-purple-400/30 shrink-0"
          >
            {cat}
            <button type="button" onClick={() => toggleCategory(cat)} className="text-purple-300 hover:text-white">
              ×
            </button>
          </span>
        ))}

        <div className="relative shrink-0" ref={categoryMenuRef}>
          <button
            type="button"
            onClick={() => setCategoryMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#140e24]/80 text-slate-300 border border-purple-500/15 hover:bg-white/10 transition"
          >
            <Filter className="w-3.5 h-3.5" />
            Categories
            {selectedCategories.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/30 text-purple-100">
                {selectedCategories.length}
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 transition ${categoryMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {categoryMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-30 w-72 max-h-80 overflow-y-auto rounded-xl border border-purple-500/25 bg-[#120b22] shadow-xl shadow-black/40 p-2">
              <div className="flex items-center justify-between px-2 pb-2 border-b border-purple-500/15 mb-1">
                <span className="text-[10px] text-slate-400">Select one or more · none = All</span>
                {selectedCategories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCategories([])}
                    className="text-[10px] font-semibold text-purple-300 hover:text-purple-200"
                  >
                    Clear
                  </button>
                )}
              </div>
              {categoryCounts
                .filter((cat) => cat.category !== 'All')
                .map((cat) => {
                  const checked = selectedCategories.includes(cat.category);
                  return (
                    <label
                      key={cat.category}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition ${
                        checked ? 'bg-purple-600/25 text-purple-100' : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCategory(cat.category)}
                          className="rounded border-purple-500/40 bg-transparent text-purple-500 focus:ring-purple-500/30"
                        />
                        <span className="truncate">{cat.category}</span>
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${cat.badgeBg} ${cat.badgeText}`}>
                        {cat.count}
                      </span>
                    </label>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Gmail-style split: fixed height, list + detail scroll internally */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">
        <div className="lg:col-span-5 min-h-0 h-full overflow-hidden">
          <EmailList
            emails={filteredEmails}
            selectedEmailId={selectedEmailId || null}
            onSelectEmail={(email) => {
              setSelectedEmailId(email.id);
              setReadInSession((prev) => new Set(prev).add(email.id));
              setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, isUnread: false } : e)));
            }}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterStatus={filterStatus}
            onFilterStatusChange={setFilterStatus}
          />
        </div>

        <div className="lg:col-span-7 min-h-0 h-full overflow-hidden">
          <EmailDetail
            email={selectedEmail}
            loadingDetail={detailLoading}
            onOpenReply={handleOpenReply}
            onNavigate={onNavigate}
          />
        </div>
      </div>

      <ReplyComposerModal
        isOpen={replyModalState.isOpen}
        mode={replyModalState.mode}
        replyToEmail={selectedEmail}
        initialBody={composerDraft}
        onClose={() => {
          setReplyModalState({ isOpen: false, mode: 'reply' });
          setComposerDraft(undefined);
        }}
      />
    </div>
  );
};
