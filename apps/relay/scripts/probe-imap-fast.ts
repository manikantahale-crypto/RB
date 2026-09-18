import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImapConnector } from '../src/connectors/imap.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
dotenv.config({ path: resolve(root, '.env') });

async function main() {
  const c = new ImapConnector();
  const t = Date.now();
  const emails = await c.fetchRecentInbox();
  console.log(
    JSON.stringify({
      ms: Date.now() - t,
      count: emails.length,
      subjects: emails.slice(0, 5).map((e) => e.subject),
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('IMAP probe failed:', err?.message || err);
    process.exit(1);
  });
