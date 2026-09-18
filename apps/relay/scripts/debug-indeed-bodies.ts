import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/index.js';
import { pickDisplayBody } from '../src/utils/htmlText.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
dotenv.config({ path: resolve(root, '.env') });

async function main() {
  const threadId = '<1k247dckbj1bl808@indeed.com>';
  const rows = await sql<
    Array<{
      id: string;
      subject: string | null;
      direction: string | null;
      cleaned_len: number;
      raw_len: number;
      html_len: number;
      cleaned_sample: string | null;
      raw_sample: string | null;
      html_sample: string | null;
    }>
  >`
    SELECT id,
           subject,
           direction,
           length(COALESCE(cleaned_body, '')) AS cleaned_len,
           length(COALESCE(raw_body, '')) AS raw_len,
           length(COALESCE(html_body, '')) AS html_len,
           left(COALESCE(cleaned_body, ''), 180) AS cleaned_sample,
           left(COALESCE(raw_body, ''), 180) AS raw_sample,
           left(COALESCE(html_body, ''), 180) AS html_sample
      FROM relay.email_messages
     WHERE thread_id = ${threadId}
     ORDER BY date ASC NULLS LAST
  `;
  console.log('rows', rows.length);
  for (const r of rows) {
    const picked = pickDisplayBody(r.cleaned_sample || '', r.raw_sample || '', r.html_sample);
    console.log({
      id: r.id,
      direction: r.direction,
      cleaned_len: r.cleaned_len,
      raw_len: r.raw_len,
      html_len: r.html_len,
      picked_plain_len: (picked.plain || '').length,
      picked_html_len: (picked.html || '').length,
      cleaned_sample: r.cleaned_sample,
      raw_sample: r.raw_sample,
    });
  }
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
