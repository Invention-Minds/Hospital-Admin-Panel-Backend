import { PrismaClient } from '@prisma/client';
import { FALLBACKS } from '../src/service/notification-recipients';

/**
 * Seed NotificationRecipient from the code fallbacks (the numbers previously
 * hardcoded in controllers). Idempotent — upserts by (groupKey, phone).
 *
 * Run:  npm run seed:notification-recipients
 * After this, edit numbers per client via the /api/notification-recipients API.
 */
const prisma = new PrismaClient();

async function main() {
  let created = 0;
  let skipped = 0;
  for (const [groupKey, phones] of Object.entries(FALLBACKS)) {
    for (const phone of phones) {
      const normalized = phone.replace(/[^0-9]/g, '');
      const existing = await prisma.notificationRecipient.findUnique({
        where: { groupKey_phone: { groupKey, phone: normalized } },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await prisma.notificationRecipient.create({
        data: { groupKey, phone: normalized, isActive: true },
      });
      created += 1;
    }
  }
  console.log(`[seed:notification-recipients] created ${created}, skipped ${skipped} existing`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
