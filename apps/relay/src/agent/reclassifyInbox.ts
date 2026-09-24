import { query, normalizeMessage } from '../db';
import { processEmail } from '../agent/inboxAgent';
import { clearRegisteredVendorCache } from '../matching/vendorRegistry';

/** Re-run classification on stored messages (fixes category drift after rule updates). */
export async function reclassifyStoredMessages(limit = 500): Promise<number> {
  clearRegisteredVendorCache();
  const { rows } = await query('SELECT * FROM relay.email_messages LIMIT $1', [limit]);
  const messages = rows.map(normalizeMessage).filter(Boolean);
  let processed = 0;

  for (const msg of messages) {
    if (!msg) continue;
    await processEmail({
      id: msg.id,
      threadId: msg.threadId,
      fromEmail: msg.fromEmail || '',
      fromName: msg.fromName || '',
      toEmail: msg.toEmail || '',
      subject: msg.subject || '',
      date: msg.date || new Date(),
      fullBodyText: msg.rawBody || msg.cleanedBody || '',
      providerMessageId: msg.providerMessageId || msg.id,
      direction: (msg.direction as 'received' | 'sent') || 'received',
    });
    processed++;
  }

  return processed;
}
