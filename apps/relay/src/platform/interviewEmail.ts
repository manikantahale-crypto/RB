export type InterviewEmailTemplate =
  | 'session_invite'
  | 'session_completed'
  | 'retake_invite';

function str(data: Record<string, unknown>, key: string, fallback = ''): string {
  const v = data[key];
  if (v == null || v === '') return fallback;
  return String(v);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapHtml(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#0f0a1a;font-family:Segoe UI,Arial,sans-serif;color:#e2e8f0;">
  <div style="max-width:560px;margin:0 auto;background:#1a1330;border:1px solid #6d28d9;border-radius:16px;padding:28px;">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;color:#c4b5fd;text-transform:uppercase;">TEKISHO Interview</p>
    <h1 style="margin:0 0 16px;font-size:22px;color:#fff;">${escapeHtml(title)}</h1>
    ${inner}
  </div>
</body>
</html>`;
}

export function buildInterviewEmailContent(
  template: InterviewEmailTemplate,
  data: Record<string, unknown> = {},
): { subject: string; html: string; text: string } {
  const name = str(data, 'candidateName', 'Candidate');
  const job = str(data, 'jobTitle', 'the role');
  const url =
    str(data, 'inviteUrl') ||
    str(data, 'sessionUrl') ||
    str(data, 'reportUrl') ||
    str(data, 'link');
  const attempt = str(data, 'attemptNumber');
  const fromName =
    process.env.INTERVIEW_EMAIL_FROM_NAME || 'TEKISHO Interview Platform';

  const cta = url
    ? `<p style="margin:20px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;">Open interview</a></p>
       <p style="font-size:12px;color:#94a3b8;word-break:break-all;">${escapeHtml(url)}</p>`
    : '';

  if (template === 'session_completed') {
    const subject = `Interview complete — ${job}`;
    const text = [
      `Hi ${name},`,
      '',
      `Your practice interview for ${job} is complete.`,
      url ? `View your feedback: ${url}` : '',
      '',
      `— ${fromName}`,
    ]
      .filter(Boolean)
      .join('\n');
    const html = wrapHtml(
      'Interview complete',
      `<p>Hi ${escapeHtml(name)},</p>
       <p>Your practice interview for <strong>${escapeHtml(job)}</strong> is complete. Review your feedback below.</p>
       ${cta}`,
    );
    return { subject, html, text };
  }

  if (template === 'retake_invite') {
    const subject = attempt
      ? `Retake your ${job} interview (attempt ${attempt})`
      : `Retake your ${job} interview`;
    const text = [
      `Hi ${name},`,
      '',
      `You can retake the practice interview for ${job}${attempt ? ` (attempt ${attempt})` : ''}.`,
      url ? `Start here: ${url}` : '',
      '',
      `— ${fromName}`,
    ]
      .filter(Boolean)
      .join('\n');
    const html = wrapHtml(
      'Retake your interview',
      `<p>Hi ${escapeHtml(name)},</p>
       <p>You can retake the practice interview for <strong>${escapeHtml(job)}</strong>${
         attempt ? ` (attempt ${escapeHtml(attempt)})` : ''
       }.</p>
       ${cta}`,
    );
    return { subject, html, text };
  }

  const subject = `You're invited: ${job} practice interview`;
  const text = [
    `Hi ${name},`,
    '',
    `You have been invited to a practice interview for ${job}.`,
    url ? `Join here: ${url}` : '',
    '',
    `— ${fromName}`,
  ]
    .filter(Boolean)
    .join('\n');
  const html = wrapHtml(
    'Interview invitation',
    `<p>Hi ${escapeHtml(name)},</p>
     <p>You have been invited to a practice interview for <strong>${escapeHtml(job)}</strong>.</p>
     ${cta}`,
  );
  return { subject, html, text };
}
