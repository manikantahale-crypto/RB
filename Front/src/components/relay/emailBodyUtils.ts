/** Remove CSS / @media blocks that leak into subjects and plain-text bodies. */
function stripCssFragments(input: string): string {
  let text = input;

  // Nested @media { ... }
  for (let i = 0; i < 8 && /@media/i.test(text); i++) {
    text = text.replace(/@media[^{]*\{([^{}]|\{[^{}]*\})*\}/gi, ' ');
  }

  text = text
    .replace(/@media[^\n{]+(\([^)]*\))?/gi, ' ')
    .replace(/@import[^;]+;/gi, ' ')
    .replace(/[.#][\w-]+(?:[^{]*)\{[^}]*\}/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/(?:^|\s)([.#][\w-]+(?:\s+[.#][\w-]+)+)(?=\s|$)/g, ' ');

  return text;
}

function isCssNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^@media/i.test(t)) return true;
  if (/^<link\b/i.test(t)) return true;
  if (/^(&#\d+;\s*)+$/.test(t)) return true;
  if (/\b(body|html|table|td|\.[\w-]+)\s*\{/.test(t)) return true;
  if (/\b(font-family|min-width|max-width|padding\s*:|margin\s*:|background\s*:)/i.test(t) && t.length < 280) return true;
  if (/Mailer\s*\d/i.test(t)) return true;
  if (/^[.#][\w-]+/.test(t) && /\b(max-width|min-width|font-size|padding|margin|display)\b/i.test(t)) return true;
  if (t.length < 140 && /\b(px|rem|em|%)\b/.test(t) && /[.#][\w-]/.test(t)) return true;
  const visible = decodeHtmlEntities(t).replace(/\s/g, '');
  return visible.length < 2;
}

/** Strip HTML/CSS email markup for readable plain-text display. */
export function stripHtmlToText(input: string): string {
  if (!input?.trim()) return '';

  let text = input;
  if (text.includes('<') || text.includes('@import') || text.includes('{') || text.includes('@media')) {
    text = text
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  }

  text = decodeHtmlEntities(text);
  text = stripCssFragments(text);

  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => !isCssNoiseLine(line))
    .join('\n')
    .trim();
}

/** Clean subject lines — strip Re: prefix, CSS, first meaningful line only. */
export function cleanEmailSubject(input: string): string {
  const plain = stripHtmlToText(input || '');
  const firstLine = plain.split('\n').find((l) => l.trim().length > 3 && !isCssNoiseLine(l)) || plain;
  let oneLine = firstLine.replace(/\s+/g, ' ').trim();
  oneLine = oneLine.replace(/^(re:\s*)+/i, '').trim() || oneLine;
  if (!oneLine) return 'No Subject';
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
}

/** Plain text for detail pane — full URLs preserved, no link shortening. */
export function plainBodyForDisplay(input: string): string {
  return stripHtmlToText(input);
}

/** Replace long URLs with a short placeholder — list previews only. */
export function shortenUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
    if (url.length <= 48) return url;
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return `[${host}]`;
    } catch {
      return '[link]';
    }
  });
}

/** Drop lines that are only links/whitespace and cap consecutive noise from newsletters. */
export function compactEmailBody(input: string): string {
  let text = shortenUrls(stripHtmlToText(input));
  if (!text) return '';

  const lines = text.split('\n').filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (isCssNoiseLine(t)) return false;
    if (/^(&#\d+;\s*)+$/.test(t)) return false;
    if (/^(\[(link|[\w.-]+\.[a-z]{2,})\]\s*)+$/i.test(t)) return false;
    if (/^unsubscribe|^view in browser|^privacy policy|^terms of use/i.test(t)) return false;
    return true;
  });

  text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

export function plainEmailPreview(input: string, max = 120): string {
  const plain = compactEmailBody(input);
  if (!plain) return 'No preview available';
  const oneLine = plain.replace(/\*{4,}/g, ' ').replace(/\s+/g, ' ');
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Short inbox summary — strips marketing asterisk/CSS noise; not LLM-generated. */
export function inboxSummaryText(body: string, max = 240): string | null {
  let text = compactEmailBody(body)
    .replace(/\*{4,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 50) return null;
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

/** Readable body for detail pane — capped unless expanded. */
export function truncateEmailBody(text: string, max = 900): { text: string; truncated: boolean } {
  const plain = compactEmailBody(text);
  if (plain.length <= max) return { text: plain, truncated: false };
  return { text: `${plain.slice(0, max).trim()}…`, truncated: true };
}

export function isHtmlContent(input: string): boolean {
  return /<(?:html|body|div|table|p|span|a|img|center|td|tr)\b/i.test(input || '');
}

export function sanitizeHtmlForDisplay(html: string): string {
  if (!html?.trim()) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

/** Extract visual body HTML — keeps inline styles & body-level styles for marketing emails. */
export function extractRenderableEmailHtml(input: string): string | null {
  if (!input?.trim()) return null;

  let html = input;
  if (!/<[a-z][\s\S]*>/i.test(html)) return null;

  html = html
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '');

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) html = bodyMatch[1];

  html = sanitizeHtmlForDisplay(html.trim());
  const textOnly = html.replace(/<[^>]+>/g, '').replace(/\s/g, '');
  if (textOnly.length < 8) return null;

  return html;
}

function decodeHtmlEntities(input: string): string {
  const invisible = new Set([847, 8199, 8203, 8204, 8205, 65279]);
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      if (invisible.has(code) || code < 32) return '';
      return String.fromCharCode(code);
    })
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, '');
}
