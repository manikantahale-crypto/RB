import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
dotenv.config({ path: resolve(root, '.env') });

async function main() {
  const { listThreadsForInbox, getThreadDetail } = await import('../src/inbox/threadsApi.js');
  const list = await listThreadsForInbox();
  console.log('list_count', list.length);
  for (const t of list.slice(0, 5)) {
    console.log('try', t.threadId, t.replyIntent, 'preview', String(t.preview || '').slice(0, 60));
    try {
      const d = await getThreadDetail(t.threadId);
      console.log(
        '  OK body',
        (d?.body || '').length,
        'html',
        (d?.bodyHtml || '').length,
        'msgs',
        d?.threadMessages?.length,
      );
    } catch (err: any) {
      console.error('  FAIL', err?.message || err);
      console.error(err?.stack?.split('\n').slice(0, 15).join('\n'));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
