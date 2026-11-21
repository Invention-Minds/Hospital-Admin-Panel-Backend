/**
 * Push this server's users (phone + employee ID) to the tenant directory now,
 * instead of waiting for the 30-minute cron. Uses DIRECTORY_URL and
 * DIRECTORY_API_KEY from .env (the key for THIS server's DocMinds tenant).
 *
 *   npx ts-node scripts/directory-sync.ts            # send
 *   npx ts-node scripts/directory-sync.ts --dry-run  # only count what would be sent
 */
import 'dotenv/config';
import prisma from '../src/service/prisma-client';
import { buildDirectoryEntries, directorySyncEnabled, syncAllUsersToDirectory } from '../src/service/directory-sync.service';

async function main() {
  const dry = process.argv.includes('--dry-run');
  const db = (process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0];
  console.log(`Database: ${db} · directory: ${process.env.DIRECTORY_URL ?? '(not set)'}`);
  if (dry) {
    const e = await buildDirectoryEntries();
    const phones = e.filter((x) => x.type === 'PHONE');
    const ids = e.filter((x) => x.type === 'EMPLOYEE_ID');
    console.log(`Would send ${e.length} identifiers: ${phones.length} phones, ${ids.length} employee IDs (${e.filter((x) => !x.isActive).length} inactive).`);
    return;
  }
  if (!directorySyncEnabled()) throw new Error('Set DIRECTORY_URL and DIRECTORY_API_KEY in .env first.');
  const t = await syncAllUsersToDirectory();
  console.log(`Sent ${t.sent} · created ${t.created} · updated ${t.updated} · skipped ${t.skipped}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
