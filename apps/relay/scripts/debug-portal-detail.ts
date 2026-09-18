import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
dotenv.config({ path: resolve(root, '.env') });

async function main() {
  const { listThreadsForInbox, getThreadDetail } = await import('../src/inbox/threadsApi.js');
  const list = await listThreadsForInbox();
  const portal =
    list.find((t) => t.replyIntent === 'Portal Notifications') ||
    list.find((t) => /indeed|spotify|pinecone/i.test(String(t.subject || '') + String(t.latestSender || '')));
  if (!portal) {
    console.log('no portal thread found');
    return;
  }
  console.log('picked', {
    id: portal.threadId,
    intent: portal.replyIntent,
    vendor: portal.registeredVendor,
    subject: String(portal.subject || '').slice(0, 80),
  });
  const d = await getThreadDetail(portal.threadId);
  console.log({
    bodyLen: (d?.body || '').length,
    htmlLen: (d?.bodyHtml || '').length,
    msgs: d?.threadMessages?.length,
    preview: String(d?.body || '').slice(0, 160),
    vendor: d?.registeredVendor,
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
