import { GenerationFailedError } from "./parse-llm-graph.js";

/**
 * Capabilities we cannot author today (no runtime tool).
 * Used as hints for the gap report — not as the only defense.
 * Layer 3 (preview + Accept) is the robust anti-silent-failure.
 */
const OUT_OF_SCOPE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(e-?mail|email|smtp|sendgrid|mailgun)\b/i, label: "email" },
  {
    re: /\b(slack|teams|discord|webhook notify|notify (me|us|slack)|ping the team)\b/i,
    label: "chat/notify (e.g. Slack)",
  },
  {
    re: /\b(whatsapp|sms|text (the |them |message)|text them)\b/i,
    label: "SMS / WhatsApp",
  },
  {
    re: /\b(video\s*call|zoom|interview|calendar|schedule a (call|meeting))\b/i,
    label: "interview / scheduling",
  },
  {
    re: /\b(workday|sap successfactors|greenhouse|lever|ats hire|auto-?hire|hire them)\b/i,
    label: "ATS / hiring systems",
  },
  {
    re: /\b(linkedin message|scrape linkedin)\b/i,
    label: "LinkedIn messaging/scraping",
  },
  { re: /\b(stripe|payment|invoice)\b/i, label: "payments" },
  {
    re: /\b(\d{1,3})\s*%?\s*similar(?:ity)?|\bsimilarity\s+(?:threshold|score)\s+(?:of\s+)?(\d{1,3})/i,
    label: "duplicate similarity threshold (not configurable in workflows yet)",
  },
  {
    re: /\bduplicate\s+(?:detection|review|check).{0,40}(\d{1,3})\s*%?/i,
    label: "duplicate similarity threshold (not configurable in workflows yet)",
  },
  {
    re: /\b(\d{1,3})\s*%?\s*(?:duplicate|dedup)/i,
    label: "duplicate similarity threshold (not configurable in workflows yet)",
  },
];

export type OutOfScopeHit = { label: string; matched: string };

/**
 * Detect admin requests that need tools we do not have.
 * Returns hits (empty = no keyword hits; LLM may still report unsupported).
 */
export function findOutOfScopeCapabilities(userRequest: string): OutOfScopeHit[] {
  const text = userRequest.trim();
  if (!text) return [];
  const hits: OutOfScopeHit[] = [];
  for (const { re, label } of OUT_OF_SCOPE_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ label, matched: m[0]! });
  }
  return hits;
}

/** Unique labels for gap reports. */
export function outOfScopeLabels(userRequest: string): string[] {
  return [...new Set(findOutOfScopeCapabilities(userRequest).map((h) => h.label))];
}

/**
 * @deprecated Prefer gap report + Accept (Layer 3). Kept for callers that want
 * a hard stop; Generate no longer throws here by default.
 */
export function assertRequestWithinToolScope(userRequest: string): void {
  const labels = outOfScopeLabels(userRequest);
  if (labels.length === 0) return;
  throw new GenerationFailedError(
    `This request needs capabilities we cannot build yet (${labels.join(", ")}). ` +
      `Today you can only compose: process JD, process resume, and score match ` +
      `(plus match filters/threshold in config). Remove those parts and try again.`,
  );
}

/** Merge LLM unsupported[] with keyword hints; de-dupe case-insensitively. */
export function mergeUnsupported(
  fromLlm: string[],
  fromRequest: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...fromLlm, ...fromRequest]) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
