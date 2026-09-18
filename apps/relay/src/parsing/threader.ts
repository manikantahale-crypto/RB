import { simpleParser } from 'mailparser';

export interface CleanedBody {
  text: string;
  html: string | null;
}

export async function cleanSentEmailBody(content: string): Promise<CleanedBody> {
  if (!content) {
    return { text: '', html: null };
  }

  // If it contains MIME headers, use mailparser
  if (content.includes('MIME-Version:') || content.includes('Content-Type:')) {
    try {
      const parsed = await simpleParser(content);
      let textBody = parsed.text || '';
      const htmlBody = parsed.html || (parsed.textAsHtml ? parsed.textAsHtml : null);

      if (htmlBody && !textBody) {
        textBody = htmlBody.replace(/<[^>]+>/g, '').trim();
      }

      return {
        text: textBody.trim(),
        html: htmlBody ? htmlBody.trim() : null,
      };
    } catch (error) {
      // Fallback
    }
  }

  // Fallback string cleaning
  let cleaned = content.trim();

  // Basic header stripping
  const lines = cleaned.split('\n');
  let headerIdx = 0;
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const line = lines[i];
    if (/^(Subject|To|From|Content-Type|Content-Transfer-Encoding|MIME-Version|Message-ID):/i.test(line)) {
      headerIdx = i + 1;
    }
  }

  if (headerIdx > 0) {
    cleaned = lines.slice(headerIdx).join('\n');
  }

  cleaned = cleaned.trim();
  const isHtml = cleaned.startsWith('<') || cleaned.toLowerCase().includes('<html>') || cleaned.toLowerCase().includes('<p>');

  return {
    text: isHtml ? cleaned.replace(/<[^>]+>/g, '').trim() : cleaned,
    html: isHtml ? cleaned : null,
  };
}

export function normalizeSubject(subject: string): string {
  if (!subject) return '';
  let subj = subject.trim();
  
  // Recursively remove Re:, Fwd:, etc.
  const pattern = /^(re|fwd|fw|re\^\[\d+\]|aw|wg|reply|fwd\^\[\d+\]):\s*/i;
  while (pattern.test(subj)) {
    subj = subj.replace(pattern, '').trim();
  }
  
  return subj.replace(/\s+/g, ' ').toLowerCase();
}

export async function groupEmailsIntoThreads(inboxEmails: any[], sentEmails: any[] = []): Promise<any[]> {
  const allMsgs: any[] = [];

  for (const m of inboxEmails) {
    const msgCopy = { ...m, isSent: false, direction: 'received' };
    allMsgs.push(msgCopy);
  }

  for (const s of sentEmails) {
    const sCopy: any = {
      ...s,
      isSent: true,
      direction: 'sent',
      isRead: true,
      id: s.id || s.sent_record_id,
      fromEmail: 'me',
      fromName: 'Bench Sales Team',
      toEmail: s.recipient || s.to || s.vendor_email || '',
      date: s.sent_at || s.created_at || '',
    };
    
    const cleanedBody = await cleanSentEmailBody(s.content || '');
    sCopy.fullBodyText = cleanedBody.text;
    sCopy.fullBodyHtml = cleanedBody.html;
    sCopy.snippet = cleanedBody.text.substring(0, 150);
    sCopy.bodyPreview = cleanedBody.text.substring(0, 300);
    allMsgs.push(sCopy);
  }

  allMsgs.sort((a, b) => {
    const dtA = new Date(a.date || 0).getTime();
    const dtB = new Date(b.date || 0).getTime();
    return dtA - dtB;
  });

  const threads: any[] = [];
  
  // Placeholder for classifying email message
  // In a real flow, this should call classifyEmailMessage
  
  for (const msg of allMsgs) {
    let matchedThread = null;
    const msgId = msg.messageId || msg.id || '';
    const inReplyTo = msg.inReplyTo || '';
    const references = msg.references || '';
    const normSubj = normalizeSubject(msg.subject || '');
    const msgVendorEmail = (msg.isSent ? msg.toEmail : msg.fromEmail || '').toLowerCase().trim();

    // 1. Message-ID / In-Reply-To / References
    if (inReplyTo || references || msgId) {
      for (const t of threads) {
        for (const existingMsg of t.messages) {
          const existingId = existingMsg.messageId || existingMsg.id || '';
          if (existingId) {
            if (inReplyTo.includes(existingId) || references.includes(existingId) || 
               (msgId && (existingMsg.inReplyTo || '').includes(msgId)) || 
               (msgId && (existingMsg.references || '').includes(msgId))) {
              matchedThread = t;
              break;
            }
          }
        }
        if (matchedThread) break;
      }
    }

    // 2. Normalized subject + vendor email
    if (!matchedThread && normSubj && msgVendorEmail) {
      for (const t of threads) {
        const tVendorEmail = (t.vendorEmail || '').toLowerCase().trim();
        const tNormSubj = normalizeSubject(t.subject);
        if (tNormSubj === normSubj && tVendorEmail === msgVendorEmail) {
          matchedThread = t;
          break;
        }
      }
    }

    // 3. Normalized subject + sender email
    if (!matchedThread && normSubj && msgVendorEmail) {
      for (const t of threads) {
        const tNormSubj = normalizeSubject(t.subject);
        if (tNormSubj === normSubj) {
          for (const existingMsg of t.messages) {
            const existingSender = (existingMsg.isSent ? existingMsg.toEmail : existingMsg.fromEmail || '').toLowerCase().trim();
            if (existingSender === msgVendorEmail) {
              matchedThread = t;
              break;
            }
          }
          if (matchedThread) break;
        }
      }
    }

    // 4. Normalized subject fallback
    if (!matchedThread && normSubj) {
      for (const t of threads) {
        const tNormSubj = normalizeSubject(t.subject);
        if (tNormSubj === normSubj) {
          matchedThread = t;
          break;
        }
      }
    }

    if (matchedThread) {
      matchedThread.messages.push(msg);
      matchedThread.messageCount += 1;
    } else {
      threads.push({
        threadId: msg.threadId || msgId || `thread_${threads.length}`,
        subject: msg.subject || '(No Subject)',
        vendorEmail: msgVendorEmail,
        vendorName: msg.isSent ? 'Recipient' : msg.fromName,
        messageCount: 1,
        messages: [msg],
      });
    }
  }

  // Post process (similar to python script, simplified)
  for (const t of threads) {
    if (t.messages.length > 0) {
      t.latestDate = t.messages[t.messages.length - 1].date || '';
    }
  }

  threads.sort((a, b) => {
    const dtA = new Date(a.latestDate || 0).getTime();
    const dtB = new Date(b.latestDate || 0).getTime();
    return dtB - dtA;
  });

  return threads;
}
