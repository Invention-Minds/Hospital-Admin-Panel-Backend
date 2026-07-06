/**
 * Seed the Therapist master (Therapist table).
 *
 * Idempotent: upserts each row by `id`. Phone numbers are DUMMY placeholders
 * (9000000001..). Gender is required (the booking form filters therapists by
 * patient gender) — only Gireesh's was confirmed; the rest are inferred from
 * names, correct if wrong. `userId` is left NULL on create for FK-safety on a
 * fresh DB; existing userId values are NOT overwritten on re-run.
 *
 * Run from Hospital-Admin-Panel-Backend/:
 *   npx ts-node prisma/seed-therapists.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const THERAPISTS: { id: number; name: string; phoneNumber: string; gender: string }[] = [
  { id: 1, name: "Abhijith", phoneNumber: "9000000001", gender: "Male" },
  { id: 2, name: "Arun Kumar P", phoneNumber: "9000000002", gender: "Male" },
  { id: 3, name: "Gireesh", phoneNumber: "9000000003", gender: "Male" },
  { id: 4, name: "Arpitha BN", phoneNumber: "9000000004", gender: "Female" },
  { id: 5, name: "Shalini E", phoneNumber: "9000000005", gender: "Female" },
  { id: 6, name: "Madhavi", phoneNumber: "9000000006", gender: "Female" },
  { id: 7, name: "Testing", phoneNumber: "9000000007", gender: "Male" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry an upsert on MySQL lock-wait/deadlock (1205/1213) with backoff. */
async function upsertWithRetry(
  t: { id: number; name: string; phoneNumber: string; gender: string },
  attempts = 5
): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await prisma.therapist.upsert({
        where: { id: t.id },
        update: {
          name: t.name,
          phoneNumber: t.phoneNumber,
          gender: t.gender,
          isActive: true,
        },
        create: {
          id: t.id,
          name: t.name,
          phoneNumber: t.phoneNumber,
          gender: t.gender,
          isActive: true,
        },
      });
      return;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      const isLock =
        msg.includes("1205") ||
        msg.includes("Lock wait timeout") ||
        msg.includes("1213") ||
        msg.includes("Deadlock");
      if (isLock && i < attempts) {
        console.warn(`  lock on "${t.name}" — retry ${i}/${attempts - 1}…`);
        await sleep(750 * i);
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  for (const t of THERAPISTS) {
    await upsertWithRetry(t);
  }
  console.log(`✓ seed-therapists complete. ${THERAPISTS.length} therapists upserted.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("seed-therapists failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
