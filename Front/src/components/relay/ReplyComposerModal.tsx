import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Sparkles, RefreshCw, CheckCircle2, Paperclip, Trash2 } from 'lucide-react';
import { RelayEmail } from '../../types';
import { apiFetch } from '../../services/api';

interface ComposerAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
  size: number;
}

interface ReplyComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  replyToEmail?: RelayEmail | null;
  mode?: 'reply' | 'forward';
  initialBody?: string;
}

function readFileAsBase64(file: File): Promise<ComposerAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        contentBase64: base64,
        size: file.size,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const ReplyComposerModal: React.FC<ReplyComposerModalProps> = ({
  isOpen,
  onClose,
  replyToEmail,
  mode = 'reply',
  initialBody,
}) => {
  const [toAddress, setToAddress] = useState('');
  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<string | null>(null);
  const [replyable, setReplyable] = useState(true);
  const saveTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const persistDraft = async (overrides?: {
    body?: string;
    subject?: string;
    attachments?: ComposerAttachment[];
  }) => {
    if (!replyToEmail || mode !== 'reply') return;
    try {
      await apiFetch(`/threads/${replyToEmail.id}/draft`, {
        method: 'PUT',
        body: JSON.stringify({
          body: overrides?.body ?? messageBody,
          subject: overrides?.subject ?? subject,
          attachments: overrides?.attachments ?? attachments,
        }),
      });
    } catch {
      /* best-effort */
    }
  };

  const scheduleSave = () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      persistDraft();
    }, 800);
  };

  useEffect(() => {
    if (!isOpen || !replyToEmail) return;

    setToAddress(mode === 'reply' ? replyToEmail.senderEmail.replace(/^To: /, '') : '');
    setSubject(
      mode === 'reply'
        ? replyToEmail.subject.startsWith('Re:')
          ? replyToEmail.subject
          : `Re: ${replyToEmail.subject}`
        : `Fwd: ${replyToEmail.subject}`,
    );
    setAttachments([]);

    const loadDraft = async () => {
      if (initialBody) {
        setMessageBody(initialBody);
        return;
      }
      if (mode !== 'reply') {
        setMessageBody(
          `---------- Forwarded message ---------\nFrom: ${replyToEmail.senderName}\n\n${replyToEmail.body}`,
        );
        return;
      }

      setIsDrafting(true);
      try {
        const res = await apiFetch(`/threads/${replyToEmail.id}/draft`);
        if (res.ok) {
          const data = await res.json();
          setMessageBody(data.body || '');
          if (data.subject) setSubject(data.subject);
          setDraftSource(data.source || null);
          setReplyable(data.replyable !== false);
          if (Array.isArray(data.attachments) && data.attachments.length) {
            setAttachments(data.attachments);
          }
        } else {
          setMessageBody(replyToEmail.suggestedReply || '');
          setReplyable(true);
        }
      } catch {
        setMessageBody(replyToEmail.suggestedReply || '');
        setReplyable(true);
      } finally {
        setIsDrafting(false);
      }
    };

    loadDraft();
    setSentSuccess(false);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [isOpen, replyToEmail?.id, mode, initialBody]);

  if (!isOpen) return null;

  const handleRewrite = async () => {
    if (!replyToEmail || !messageBody.trim()) return;
    setIsRewriting(true);
    try {
      const res = await apiFetch(`/threads/${replyToEmail.id}/rewrite`, {
        method: 'POST',
        body: JSON.stringify({ body: messageBody }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessageBody(data.body || messageBody);
        scheduleSave();
      }
    } finally {
      setIsRewriting(false);
    }
  };

  const handleRegenerate = async () => {
    if (!replyToEmail || mode !== 'reply') return;
    setIsDrafting(true);
    try {
      const res = await apiFetch(`/threads/${replyToEmail.id}/draft?force=1`);
      if (res.ok) {
        const data = await res.json();
        setMessageBody(data.body || messageBody);
        setDraftSource(data.source || null);
        setReplyable(data.replyable !== false);
        if (data.subject) setSubject(data.subject);
        scheduleSave();
      }
    } finally {
      setIsDrafting(false);
    }
  };

  const handleAddAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...attachments];
    for (const file of Array.from(files)) {
      next.push(await readFileAsBase64(file));
    }
    setAttachments(next);
    persistDraft({ attachments: next });
  };

  const handleRemoveAttachment = (index: number) => {
    const next = attachments.filter((_, i) => i !== index);
    setAttachments(next);
    persistDraft({ attachments: next });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyToEmail) return;
    setIsSending(true);
    try {
      const res = await apiFetch(`/threads/${replyToEmail.id}/send`, {
        method: 'POST',
        body: JSON.stringify({
          to: toAddress,
          subject,
          body: messageBody,
          attachments: attachments.map(({ filename, contentType, contentBase64 }) => ({
            filename,
            contentType,
            contentBase64,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Send failed');
      }
      setSentSuccess(true);
      setTimeout(() => {
        setSentSuccess(false);
        onClose();
      }, 1200);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#120c24] border border-purple-500/30 rounded-2xl p-5 max-w-2xl w-full shadow-2xl flex flex-col max-h-[90vh]">
        {errorMessage && (
          <div className="mb-3 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center justify-between shrink-0">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-white font-bold ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-center justify-between border-b border-[#261e38] pb-3 mb-3 shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-100">
              {mode === 'reply' ? 'Reply' : 'Forward'}
            </h3>
            <p className="text-xs text-slate-400">{replyToEmail?.subject}</p>
            {mode === 'reply' && replyToEmail?.replyIntent && (
              <p className="text-[10px] text-purple-300 mt-0.5">
                Intent: <span className="font-semibold">{replyToEmail.replyIntent}</span>
                {replyToEmail.requiresFollowup ? ' · Follow-up required' : ''}
                {draftSource === 'llm' ? ' · AI draft (unique to this email)' : draftSource === 'cached' ? ' · Saved draft' : draftSource === 'advisory' ? ' · Advisory only' : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        {sentSuccess ? (
          <div className="py-12 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            <p className="text-sm text-emerald-200 font-semibold">Message sent</p>
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex flex-col flex-1 min-h-0 gap-3">
            <div className="space-y-2 shrink-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400 w-12">To:</span>
                <input
                  value={toAddress}
                  onChange={(e) => {
                    setToAddress(e.target.value);
                    scheduleSave();
                  }}
                  className="glass-input flex-1 px-3 py-1.5 rounded-lg"
                  required
                />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400 w-12">Subject:</span>
                <input
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    scheduleSave();
                  }}
                  className="glass-input flex-1 px-3 py-1.5 rounded-lg"
                  required
                />
              </div>
            </div>

            {!replyable && mode === 'reply' && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/25 px-3 py-2 text-[11px] text-cyan-100 leading-relaxed shrink-0">
                This is a portal/marketing notification — replying is usually not needed. Use the links in the email to review jobs, or unsubscribe from the original message.
              </div>
            )}

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={isDrafting || mode !== 'reply'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-200 text-xs font-semibold disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isDrafting ? 'animate-spin' : ''}`} />
                AI Draft
              </button>
              <button
                type="button"
                onClick={handleRewrite}
                disabled={isRewriting || !messageBody.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-200 text-xs font-semibold disabled:opacity-50"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isRewriting ? 'animate-pulse' : ''}`} />
                Rewrite
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-semibold"
              >
                <Paperclip className="w-3.5 h-3.5" />
                Attach
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleAddAttachments(e.target.files)}
              />
              {isDrafting && <span className="text-[11px] text-slate-500">Generating draft…</span>}
            </div>

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 shrink-0">
                {attachments.map((att, idx) => (
                  <div
                    key={`${att.filename}-${idx}`}
                    className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-300"
                  >
                    <Paperclip className="w-3 h-3 text-purple-400" />
                    <span className="truncate max-w-[140px]">{att.filename}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(idx)}
                      className="text-slate-500 hover:text-red-400"
                      aria-label={`Remove ${att.filename}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              value={messageBody}
              onChange={(e) => {
                setMessageBody(e.target.value);
                scheduleSave();
              }}
              required
              className="flex-1 min-h-[200px] glass-input px-3 py-2 rounded-xl text-sm text-slate-100 resize-none leading-relaxed"
              placeholder="Your reply…"
            />

            <div className="flex justify-between pt-2 border-t border-[#261e38] shrink-0">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-white/5 text-slate-300 text-xs">
                Discard
              </button>
              <button
                type="submit"
                disabled={isSending || isDrafting || (!replyable && mode === 'reply')}
                className="px-5 py-2 rounded-xl bg-purple-600 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {isSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
