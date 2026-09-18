import { db } from '../db';
import { emailMessages } from '../db/schema';
import { processEmail } from '../agent/inboxAgent';
import { clearRegisteredVendorCache } from '../matching/vendorRegistry';

/** Re-run classification on stored messages (fixes category drift after rule updates). */
export async function reclassifyStoredMessages(limit = 500): Promise<number> {
  clearRegisteredVendorCache();
  const messages = await db.select().from(emailMessages).limit(limit);
  let processed = 0;

  for (const msg of messages) {
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
