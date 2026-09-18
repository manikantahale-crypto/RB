import React, { useEffect, useRef, useMemo } from 'react';
import { Paperclip } from 'lucide-react';
import { RelayAttachment } from '../../types';
import { extractRenderableEmailHtml, plainBodyForDisplay } from './emailBodyUtils';

interface EmailBodyViewProps {
  plain: string;
  html?: string | null;
  attachments?: RelayAttachment[];
}

/** Dark-themed HTML render — preserves sender layout (buttons, cards, images). */
export const EmailBodyView: React.FC<EmailBodyViewProps> = ({ plain, html, attachments }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const renderHtml = useMemo(
    () => extractRenderableEmailHtml(html || '') || extractRenderableEmailHtml(plain) || null,
    [html, plain],
  );

  const cleanPlain = useMemo(() => plainBodyForDisplay(plain), [plain]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !renderHtml) return;

    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank" rel="noopener">
<style>
  html, body {
    margin: 0;
    padding: 16px 20px;
    background: #130e24 !important;
    color: #e2e8f0 !important;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
  }
  table, tbody, tr, td, div, center, section, article {
    background-color: transparent !important;
    background: transparent !important;
  }
  table[bgcolor], td[bgcolor], div[bgcolor],
  [bgcolor="#ffffff"], [bgcolor="#fff"], [bgcolor="#FFFFFF"], [bgcolor="white"] {
    background-color: #1a1229 !important;
    background: #1a1229 !important;
  }
  td[style*="background-color:#fff"], td[style*="background-color: #fff"],
  td[style*="background:#fff"], td[style*="background: #fff"],
  div[style*="background-color:#fff"], div[style*="background-color: #fff"] {
    background-color: #1a1229 !important;
  }
  font, p, span, li, h1, h2, h3, h4, h5, h6, label {
    color: #e2e8f0 !important;
  }
  a, a font { color: #a78bfa !important; }
  a:hover { color: #c4b5fd !important; }
  img { max-width: 100%; height: auto; border: 0; opacity: 0.98; }
  table { max-width: 100%; border-color: #3b2d5c !important; }
  hr { border-color: #3b2d5c !important; }
  p { margin: 0 0 1em; }
</style></head><body>${renderHtml}</body></html>`;

    iframe.srcdoc = doc;

    const resize = () => {
      try {
        const h = iframe.contentDocument?.body?.scrollHeight;
        if (h && h > 0) iframe.style.height = `${Math.min(Math.max(h + 24, 120), 2400)}px`;
      } catch {
        iframe.style.height = '480px';
      }
    };

    iframe.onload = resize;
    const t = window.setTimeout(resize, 120);
    const t2 = window.setTimeout(resize, 400);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [renderHtml]);

  return (
    <div className="overflow-hidden rounded-xl border border-purple-500/20 bg-[#130e24]/80 shadow-inner">
      {renderHtml ? (
        <iframe
          ref={iframeRef}
          title="Email content"
          sandbox="allow-same-origin allow-popups"
          className="w-full border-0 block bg-[#130e24]"
          style={{ minHeight: 120, height: 320 }}
        />
      ) : (
        <div className="p-4 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
          {cleanPlain || '(No message content)'}
        </div>
      )}

      {attachments && attachments.length > 0 && (
        <div className="px-4 py-3 border-t border-purple-500/20 bg-[#100b20]/60 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-purple-300/80">Attachments</p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((att) => (
              <span
                key={att.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-300"
              >
                <Paperclip className="w-3.5 h-3.5 text-purple-400" />
                <span className="font-medium">{att.name}</span>
                <span className="text-slate-500">· {att.size}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
