import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/index.js';
import { pickDisplayBody } from '../src/utils/htmlText.js';
import { getThreadDetail } from '../src/inbox/threadsApi.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
dotenv.config({ path: resolve(root, '.env') });

async function main() {
  const threadId = '<1k247dckbj1bl808@indeed.com>';
  const [row] = await sql<
    Array<{ cleaned_body: string; raw_body: string; html_body: string }>
  >`
    SELECT cleaned_body, raw_body, html_body
      FROM relay.email_messages
     WHERE id = 'INBOX:18633'
     LIMIT 1
  `;
  const picked = pickDisplayBody(row.cleaned_body || '', row.raw_body || '', row.html_body || null);
  console.log('direct_pick', {
    plainLen: picked.plain.length,
    htmlLen: (picked.html || '').length,
    plainStart: picked.plain.slice(0, 200),
  });

  const d = await getThreadDetail(threadId);
  console.log('detail', {
    bodyLen: (d?.body || '').length,
    htmlLen: (d?.bodyHtml || '').length,
    msgs: d?.threadMessages?.map((m) => ({
      id: m.id,
      bodyLen: (m.body || '').length,
      htmlLen: (m.bodyHtml || '').length,
      isSelf: m.isSelf,
    })),
    latestSender: d?.latestSenderEmail,
  });
  await sql.end({ timeout: 2 });
}

main().catch(async (e) => {
  console.error(e);
  try {
    await sql.end({ timeout: 1 });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
