function stripCssFragments(input: string): string {
  let text = input;
  for (let i = 0; i < 8 && /@media/i.test(text); i++) {
    text = text.replace(/@media[^{]*\{([^{}]|\{[^{}]*\})*\}/gi, ' ');
  }
  return text
    .replace(/@media[^\n{]+(\([^)]*\))?/gi, ' ')
    .replace(/@import[^;]+;/gi, ' ')
    .replace(/[.#][\w-]+(?:[^{]*)\{[^}]*\}/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/(?:^|\s)([.#][\w-]+(?:\s+[.#][\w-]+)+)(?=\s|$)/g, ' ');
}

const INVISIBLE_CHAR_CODES = new Set([
  0, 9, 10, 13, 32, 847, 8199, 8203, 8204, 8205, 65279, 8288, 8289, 8290, 8291,
]);

/** Decode HTML entities and drop invisible tracking characters. */
export function decodeHtmlEntities(input: string): string {
  if (!input?.trim()) return '';

  let text = input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      if (INVISIBLE_CHAR_CODES.has(code) || code < 32) return '';
      return String.fromCharCode(code);
    });

  return text.replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, '');
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

/** Extract visual body HTML for Gmail-style iframe rendering. */
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
  if (html.replace(/<[^>]+>/g, '').replace(/\s/g, '').length < 8) return null;
  return html;
}

/** Convert HTML email to readable plain text (preserves message content, drops CSS/head). */
export function htmlToPlainText(html: string): string {
  if (!html?.trim()) return '';

  let text = html
    .replace(/<!DOCTYPE[\s\S]*?>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<link[^>]*>/gi, ' ')
    .replace(/<meta[^>]*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|td|li|h[1-6])>/gi, '\n')
    .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, ' [image: $1] ')
    .replace(/<img[^>]*>/gi, ' [image] ')
    .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const t = decodeHtmlEntities(label.replace(/<[^>]+>/g, ' ').trim());
      return t ? `${t} (${href})` : href;
    })
    .replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text);
  text = stripCssFragments(text);
  text = text.replace(/\[(FIRSTNAME|NAME|EMAIL|COMPANY|LASTNAME|FULLNAME|UNSUBSCRIBE|.*?)\]/gi, ' ');

  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => !isCssNoiseLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripHtmlToText(input: string): string {
  if (!input?.trim()) return '';
  return htmlToPlainText(input);
}

export function cleanEmailSubject(input: string): string {
  const plain = stripHtmlToText(input || '');
  const firstLine = plain.split('\n').find((l) => l.trim().length > 3 && !isCssNoiseLine(l)) || plain;
  let oneLine = firstLine.replace(/\s+/g, ' ').trim();
  oneLine = oneLine.replace(/^(re:\s*)+/i, '').trim() || oneLine;
  if (!oneLine) return 'No Subject';
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
}

export function isHtmlContent(input: string): boolean {
  return /<(?:html|body|div|table|p|span|a|img|center|td|tr)\b/i.test(input || '');
}

/** Safe subset of HTML for inbox rendering — preserves styles, links, images. */
export function sanitizeHtmlForDisplay(html: string): string {
  if (!html?.trim()) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export function pickDisplayBody(cleaned: string, raw: string, html?: string | null): { plain: string; html: string | null } {
  const sources = [html, raw, cleaned].filter(Boolean) as string[];
  let renderHtml: string | null = null;
  for (const src of sources) {
    renderHtml = extractRenderableEmailHtml(src);
    if (renderHtml) break;
  }

  let plain = cleaned?.trim() ? decodeHtmlEntities(cleaned) : htmlToPlainText(raw || html || '');
  if (/body\s*\{|font-family|Mailer\s*\d|&#\d+;/.test(plain)) {
    plain = htmlToPlainText(renderHtml || html || raw || plain);
  }

  return {
    plain: plain || htmlToPlainText(renderHtml || ''),
    html: renderHtml,
  };
}
