import dotenv from 'dotenv';

dotenv.config();

const NON_REPLY_INTENTS = new Set(['Portal Notifications', 'Bounce', 'Sent']);

const INTENT_PLAYBOOKS: Record<string, string> = {
  'Need Resume':
    'Share the consultant profile/resume, highlight 2-3 matching skills from the JD they sent, confirm visa/availability, ask if they want rate before submission.',
  'Rate Asked':
    'Provide C2C/W2 rate clearly, mention negotiability if appropriate, confirm client budget alignment, offer to send profile once rate is accepted.',
  'Interview Request':
    'Confirm candidate availability with specific time windows (EST), ask for interview format (Teams/Zoom), request dial-in or calendar invite.',
  'Selected for Interview':
    'Acknowledge selection, confirm candidate is briefed and available, share contact for scheduling, offer prep support.',
  'Interview Feedback':
    'Thank them for feedback, ask next steps/timeline, if positive confirm submission packet; if negative ask gap areas for future roles.',
  'Requirement Shared':
    'Acknowledge the specific role/JD they shared, summarize fit of bench consultant(s), ask submission format (resume template, RTR, visa, location), propose profile within 1 hour.',
  'Vendor Reply':
    'Respond as bench sales partner: reference prior thread, answer their question directly, move toward profile submission or next step.',
  'Non-Vendor Reply':
    'Professional outreach tone: clarify your bench offering, ask for JD details (skills, location, rate range, duration), offer matching profiles.',
  'Follow-up':
    'Polite chase: reference the specific requirement or prior message topic, restate value (available consultant / pending submission), ask for status update.',
  'Candidate Shortlisted':
    'Confirm excitement, verify start timeline, collect any remaining docs (RTR, ID, references).',
};

function recruiterSignOff(): string {
  const name = process.env.RELAY_RECRUITER_NAME || process.env.RECRUITER_NAME || 'Bench Sales Team';
  return name;
}

function intentGuidance(intent: string): string {
  return INTENT_PLAYBOOKS[intent] || INTENT_PLAYBOOKS['Follow-up'];
}

function subjectHints(subject: string): string {
  const s = subject.replace(/^re:\s*/i, '').trim();
  const hints: string[] = [];
  if (/hot job|job opportunit|matching your profile|curated job/i.test(s)) {
    hints.push('Subject suggests job-matching / opportunity alert — if replying to a vendor, reference the role title and location from the email body.');
  }
  if (/\b(java|python|react|angular|\.net|devops|aws|full.?stack)\b/i.test(s)) {
    hints.push('Technical role mentioned in subject — tie consultant skills to that stack.');
  }
  if (/\b(c2c|w2|contract|remote|onsite|hybrid)\b/i.test(s)) {
    hints.push('Employment/location terms in subject — address them explicitly.');
  }
  return hints.length ? hints.join('\n') : 'Mirror language from the subject when acknowledging their message.';
}

export function getTemplateDraft(intent: string, candidate: any = null): { subject: string; body: string } {
  const candName = candidate ? candidate.name : 'our consultant';
  const rate = candidate ? candidate.rate : '$60/hr C2C';
  const skills = candidate ? candidate.skills : 'relevant technologies';
  const visa = candidate ? candidate.visaStatus : 'Authorized to work';
  const signOff = recruiterSignOff();

  switch (intent) {
    case 'Need Resume':
      return {
        subject: `Re: Resume / Profile — ${candName}`,
        body: `Hi,\n\nThank you for reaching out. Please find attached the profile for ${candName} (${skills}, ${visa}).\n\nThey are immediately available and a strong match for this requirement. Happy to discuss rate and submission format.\n\nBest regards,\n${signOff}`,
      };
    case 'Rate Asked':
      return {
        subject: `Re: Rate for ${candName}`,
        body: `Hi,\n\nThe all-inclusive C2C rate for ${candName} is ${rate}. They are available immediately (${visa}).\n\nPlease confirm if this works within your client budget and I will share the full profile right away.\n\nBest regards,\n${signOff}`,
      };
    case 'Interview Request':
      return {
        subject: `Re: Interview availability — ${candName}`,
        body: `Hi,\n\n${candName} is available for interview at the following slots (EST):\n• Tomorrow 10:00 AM – 4:00 PM\n• Day after 11:00 AM – 5:00 PM\n\nPlease share the interview format (Teams/Zoom) and I will confirm the exact slot.\n\nBest regards,\n${signOff}`,
      };
    case 'Requirement Shared':
      return {
        subject: `Re: Submission for requirement — ${candName}`,
        body: `Hi,\n\nThank you for sharing the requirement. ${candName} is an excellent fit (${skills}, ${visa}).\n\nI can send the formatted resume + RTR within the hour. Please confirm submission email/portal and any mandatory fields.\n\nBest regards,\n${signOff}`,
      };
    default:
      return {
        subject: `Re: Follow-up`,
        body: `Hi,\n\nFollowing up on my previous note regarding ${candName}. Please let me know if you need the profile, rate, or availability details.\n\nBest regards,\n${signOff}`,
      };
  }
}

function portalDraft(ctx: { subject: string; fromName: string }): { subject: string; body: string; replyable: false } {
  const firstName = (ctx.fromName || 'there').split(' ')[0];
  return {
    subject: ctx.subject.startsWith('Re:') ? ctx.subject : `Re: ${ctx.subject}`,
    body: `Hi ${firstName},\n\n[This is an automated job portal notification — a reply is usually not expected.]\n\nSuggested actions for you:\n• Open the job links in the email to review matching roles\n• Forward relevant openings to your bench candidates internally\n• Use Unsubscribe in the original email if you no longer want these alerts\n\nIf you still need to reply (rare), keep it brief and reference the specific job title from their email.`,
    replyable: false,
  };
}

export async function draftReplyFromContext(ctx: {
  subject: string;
  body: string;
  fromName: string;
  fromEmail?: string;
  replyIntent: string;
  requiresFollowup?: boolean;
  priority?: string;
  candidate?: { name?: string; skills?: string; visaStatus?: string; rate?: string } | null;
  threadHistory?: string;
}): Promise<{ subject: string; body: string; intent: string; source: 'llm' | 'template' | 'advisory'; replyable: boolean }> {
  const firstName = (ctx.fromName || 'there').split(' ')[0];
  const signOff = recruiterSignOff();

  if (NON_REPLY_INTENTS.has(ctx.replyIntent)) {
    const advisory = portalDraft(ctx);
    return { ...advisory, intent: ctx.replyIntent, source: 'advisory' };
  }

  const template = getTemplateDraft(ctx.replyIntent, ctx.candidate);
  const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY || process.env.AI_API_KEY;

  if (!openRouterKey) {
    return {
      subject: ctx.subject.startsWith('Re:') ? ctx.subject : `Re: ${ctx.subject}`,
      body: template.body.replace(/^Hi,/i, `Hi ${firstName},`),
      intent: ctx.replyIntent,
      source: 'template',
      replyable: true,
    };
  }

  const candBlock = ctx.candidate?.name
    ? `Matched bench candidate: ${ctx.candidate.name}${ctx.candidate.skills ? ` | Skills: ${ctx.candidate.skills}` : ''}${ctx.candidate.visaStatus ? ` | Visa: ${ctx.candidate.visaStatus}` : ''}${ctx.candidate.rate ? ` | Rate: ${ctx.candidate.rate}` : ''}`
    : 'No matched candidate on bench yet — respond professionally, ask for full JD (skills, location, rate, duration) if missing.';

  const prompt = `You are an experienced US IT bench sales recruiter drafting an AUTO-SEND reply (no human review). The email will be sent immediately — it must be accurate, specific, and professional.

RECIPIENT: ${ctx.fromName}${ctx.fromEmail ? ` <${ctx.fromEmail}>` : ''} — address them as "${firstName}"
EMAIL SUBJECT: ${ctx.subject}
SUBJECT ANALYSIS: ${subjectHints(ctx.subject)}
CLASSIFICATION INTENT: ${ctx.replyIntent}
PRIORITY: ${ctx.priority || 'Low'} | Follow-up required: ${ctx.requiresFollowup ? 'yes' : 'no'}
${candBlock}

INTENT PLAYBOOK (follow exactly):
${intentGuidance(ctx.replyIntent)}

THEIR LATEST MESSAGE (read carefully — quote specific role titles, companies, skills, rates they mention):
"""
${ctx.body.slice(0, 3000)}
"""

FULL CONVERSATION HISTORY (use for context — reference prior messages when relevant):
"""
${(ctx.threadHistory || ctx.body).slice(0, 3500)}
"""

AUTO-SEND RULES:
1. Opening must reference something SPECIFIC from their email or subject — never generic "following up".
2. Answer their exact ask in the first paragraph (resume, rate, availability, submission format, interview slots).
3. If Requirement Shared: acknowledge the JD, confirm you will match bench and submit profiles within 1 hour.
4. If Need Resume / Rate Asked: include concrete candidate details from MATCHED CANDIDATE block when present.
5. One clear call-to-action; 4–8 sentences; US bench sales tone.
6. Sign off as "${signOff}" — NEVER "Marketing Team".
7. Plain text only; line breaks between paragraphs.

Output ONLY valid JSON: {"subject":"Re: ...","body":"..."}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.RELAY_LLM_MODEL || 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.45,
        max_tokens: 1024,
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[ERROR] [AI] draft_generation_failed provider=openrouter status=${response.status} reason="${errText.slice(0, 100)}"`);
      console.warn('[WARN] [AI] fallback=template');
      throw new Error(`OpenRouter ${response.status}`);
    }
    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('no json in LLM response');
    const draft = JSON.parse(jsonMatch[0]);
    const body = (draft.body || '').replace(/Marketing Team/gi, signOff);
    return {
      subject: draft.subject || template.subject,
      body: body || template.body,
      intent: ctx.replyIntent,
      source: 'llm',
      replyable: true,
    };
  } catch (err) {
    console.warn(`[WARN] [AI] fallback=template reason="${(err as Error)?.message || err}"`);
    return {
      subject: ctx.subject.startsWith('Re:') ? ctx.subject : `Re: ${ctx.subject}`,
      body: template.body.replace(/^Hi,/i, `Hi ${firstName},`),
      intent: ctx.replyIntent,
      source: 'template',
      replyable: true,
    };
  }
}

export async function rewriteReplyText(
  currentText: string,
  ctx: { subject: string; fromName: string; replyIntent?: string; body?: string },
): Promise<string> {
  const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY || process.env.AI_API_KEY;
  if (!openRouterKey) return currentText;
  if (ctx.replyIntent && NON_REPLY_INTENTS.has(ctx.replyIntent)) return currentText;

  const signOff = recruiterSignOff();
  const prompt = `Improve this bench sales recruiter email. Keep intent "${ctx.replyIntent || 'follow-up'}" but make it clearer, warmer, and action-oriented.

Recipient: ${ctx.fromName}
Subject: ${ctx.subject}
Original email context: ${(ctx.body || '').slice(0, 800)}

Draft to improve:
${currentText}

Rules: Reference specific details from the original email/subject. Sign off as "${signOff}". No "Marketing Team".

Output ONLY the revised email body (plain text).`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.RELAY_LLM_MODEL || 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 800,
      }),
    });
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    return (data.choices[0].message.content || currentText).replace(/Marketing Team/gi, signOff).trim();
  } catch {
    return currentText;
  }
}

export async function generateSuggestedReplyWithLlm(intent: string, candidate: any): Promise<{ subject: string; body: string }> {
  const draft = await draftReplyFromContext({
    subject: `Re: ${intent}`,
    body: '',
    fromName: 'there',
    replyIntent: intent,
    candidate,
  });
  return { subject: draft.subject, body: draft.body };
}

export async function generateSuggestedReply(intent: string, candidate: any): Promise<{ subject: string; body: string }> {
  const draft = await generateSuggestedReplyWithLlm(intent, candidate);
  return { subject: draft.subject, body: draft.body };
}

export async function autoDraftChaseEmail(intent: string, vendorName: string, threadSubject: string, previousMessageBody: string): Promise<string> {
  if (NON_REPLY_INTENTS.has(intent)) return '';
  const draft = await draftReplyFromContext({
    subject: threadSubject,
    body: previousMessageBody,
    fromName: vendorName || 'there',
    replyIntent: intent || 'Follow-up',
    requiresFollowup: true,
    priority: 'Medium',
  });
  return draft.body;
}
