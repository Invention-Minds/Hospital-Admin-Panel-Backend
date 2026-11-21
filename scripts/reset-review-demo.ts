/**
 * Reset the app-store reviewer demo now (same as the daily 00:05 IST job):
 * creates today's 4 fictional OPD visits for the demo doctor and un-acknowledges
 * the demo critical results the reviewer acknowledged. Run it before recording
 * a demo video or submitting to Google Play / the App Store.
 *
 *   npx ts-node scripts/reset-review-demo.ts
 *
 * Needs DEMO_REVIEWER_DOCTOR_ID in .env (dev/demo only) and refuses to run on
 * any database other than the dev one (admin_panel).
 */
import 'dotenv/config';
import prisma from '../src/service/prisma-client';
import { resetReviewerDemo } from '../src/service/demo-reset.service';

const DEV_DB = 'admin_panel';

async function main() {
  const db = (process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0];
  console.log(`Database: ${db} · demo doctor: ${process.env.DEMO_REVIEWER_DOCTOR_ID ?? '(not set)'}`);
  if (db !== DEV_DB) throw new Error(`Refusing to run: database is "${db}", not the dev database "${DEV_DB}".`);
  const r = await resetReviewerDemo();
  console.log(`${r.date}: ${r.visitsCreated} OPD visits created (0 = today's already exist) · ${r.criticalsReset} critical results reset`);
  r.warnings.forEach((w) => console.warn(`Warning: ${w}`));
}

main()
  .catch((e) => { console.error((e as Error).message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
