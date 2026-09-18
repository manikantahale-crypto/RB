import dotenv from 'dotenv';
import { hasStaffingSignals } from './staffingSignals';
import { OPERATIONAL_INTENTS } from './vendor-category';

dotenv.config();

const VALID_INTENTS = new Set<string>(OPERATIONAL_INTENTS);

export async function llmClassifyEmailMessage(emailData: any, ruleClassification: any): Promise<any> {
  const openRouterKey =
    process.env.OPENROUTER_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.AI_API_KEY;

  if (!openRouterKey) {
    console.warn('[relay-llm] API key missing — using rule classification.');
    return ruleClassification;
  }

  const body = (ruleClassification.latestBody || emailData.fullBodyText || '').slice(0, 4000);
  const staffingHint = hasStaffingSignals(emailData.subject || '', body);
  const vendorRegistered = Boolean(ruleClassification.vendorMatch);
  const vendorName = ruleClassification.vendor?.name || '';

  const prompt = `You classify inbound email for a US IT bench sales recruiter Smart Inbox.

IMPORTANT — two layers (do not confuse them):
- CATEGORY is determined by vendor registry (not your job). If vendorRegistered=yes, category is always Vendor Reply.
- INTENT is what the sender wants — pick ONE operational intent below.

From: ${emailData.fromName || ''} <${emailData.fromEmail || ''}>
Registered vendor: ${vendorRegistered ? `yes (${vendorName})` : 'no'}
Subject: ${emailData.subject || ''}
Staffing keywords in body: ${staffingHint ? 'yes' : 'no'}

Email body (latest message):
"""
${body}
"""

Pick ONE replyIntent (operational intent only):
Requirement Shared | Rate Asked | Need Resume | Interview Request | Selected for Interview | Candidate Shortlisted | Interview Feedback | Client Submission | Follow-up | Non-Vendor Reply | Candidate Response | Portal Notifications | Bounce

Rules:
1. Requirement Shared: email shares a job description, JD, role opening, or asks for profiles/candidates for a specific position — EVEN IF the footer mentions "availability for interview" or interview logistics. Full JD + rate/resume ask = Requirement Shared.
2. Interview Request: vendor/client asks to SCHEDULE an interview for an already-submitted candidate (not a new JD share).
3. Rate Asked: primary ask is rate/C2C/W2/billing.
4. Need Resume: primary ask is send/share resume or profile.
5. Portal Notifications: newsletters, Indeed/LinkedIn job alerts, marketing — NOT a direct vendor email.
6. Non-Vendor Reply: staffing-related but sender is NOT a registered vendor.
7. Do NOT return "Vendor Reply" as intent — use the specific operational intent (Requirement Shared, Rate Asked, etc.).
8. Candidate Response: candidate replying about interest, consent, or submission.

Respond ONLY with JSON:
{"replyIntent":"...","requiresFollowup":true|false,"classificationReason":"one sentence","confidence":0.0-1.0}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.RELAY_LLM_MODEL || 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[ERROR] [AI] classification_failed provider=openrouter status=${response.status} reason="${errText.slice(0, 100)}"`);
      console.warn('[WARN] [AI] fallback=deterministic');
      return ruleClassification;
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[WARN] [AI] could not parse JSON from LLM output — fallback=deterministic');
      return ruleClassification;
    }

    const llmResult = JSON.parse(jsonMatch[0]);
    let replyIntent = llmResult.replyIntent || ruleClassification.replyIntent;
    if (replyIntent === 'Vendor Reply' && vendorRegistered) {
      replyIntent = staffingHint ? 'Requirement Shared' : 'Follow-up';
    }
    if (!VALID_INTENTS.has(replyIntent)) {
      replyIntent = ruleClassification.replyIntent;
    }

    const requiresFollowup = Boolean(llmResult.requiresFollowup);
    let priority = 'Low';
    if (requiresFollowup) {
      if (
        [
          'Interview Request',
          'Selected for Interview',
          'Candidate Shortlisted',
          'Need Resume',
          'Rate Asked',
          'Requirement Shared',
          'Client Submission',
        ].includes(replyIntent)
      ) {
        priority = 'High';
      } else {
        priority = 'Medium';
      }
    }

    return {
      ...ruleClassification,
      replyIntent,
      requiresFollowup,
      classificationReason: `LLM: ${llmResult.classificationReason || 'classified'}`,
      priority,
      confidenceScore: typeof llmResult.confidence === 'number' ? llmResult.confidence : 0.92,
      status: requiresFollowup ? 'Follow-Up Needed' : 'New',
    };
  } catch (error) {
    console.error(`[ERROR] [AI] classification_failed provider=openrouter reason="${(error as Error)?.message || error}"`);
    console.warn('[WARN] [AI] fallback=deterministic');
    return ruleClassification;
  }
}
