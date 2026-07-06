/**
 * Seed the Ayurveda therapy master (Therapy table).
 *
 * Idempotent: upserts each row by its unique `name`. On a fresh DB the explicit
 * `id` is preserved so therapy ids match across environments; on an existing DB
 * only `duration` is refreshed (names/ids are left as-is).
 *
 * Run from Hospital-Admin-Panel-Backend/:
 *   npx ts-node prisma/seed-therapies.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_DURATION = 60;

const THERAPIES: { id: number; name: string }[] = [
  { id: 1, name: "ABHYANGAM" },
  { id: 2, name: "ABHYANGAM - SHAKA" },
  { id: 3, name: "ABHYANGAM WITH SHIRODHARA" },
  { id: 4, name: "ABHYANGAM WITH SWEDANAM" },
  { id: 5, name: "ABHYANGAM – STHANIKA" },
  { id: 6, name: "AGNIKARMA FOR Ano Rectal" },
  { id: 7, name: "AGNIKARMA FOR VATAVYADHI" },
  { id: 8, name: "ANAL DILATION ( 4 FINGER )" },
  { id: 9, name: "ANAL DILATION ( DILATOR )" },
  { id: 10, name: "ANAL INFILTRATION" },
  { id: 11, name: "ANJANAM" },
  { id: 12, name: "ANUVASANA BASTHI" },
  { id: 13, name: "ASHCOTHANA" },
  { id: 14, name: "AVAGAHAM" },
  { id: 15, name: "BASHPASWEDAM" },
  { id: 16, name: "CAUTERY CORN" },
  { id: 17, name: "CAUTERY WART" },
  { id: 18, name: "CHOORNA PINDA SWEDAM SARVANGA" },
  { id: 19, name: "CHOORNA PINDA SWEDAM SHAKA" },
  { id: 20, name: "CHOORNA PINDA SWEDAM STHANIKA" },
  { id: 21, name: "DHANYAMLA DHARA SARVANGA" },
  { id: 22, name: "DHANYAMLA DHARA STHANIKA" },
  { id: 23, name: "DHUMAPANA" },
  { id: 24, name: "JALUKAVACHARANAM" },
  { id: 25, name: "JAMBEERA PINDA SWEDA (ADHOSHAKA)" },
  { id: 26, name: "JAMBEERA PINDA SWEDA (SARVANGA)" },
  { id: 27, name: "JAMBEERA PINDA SWEDA (STHANIKA)" },
  { id: 28, name: "KALA BASTHI" },
  { id: 29, name: "KARMA BASTHI" },
  { id: 30, name: "KARNAPURANA" },
  { id: 31, name: "KASHAYA BASTHI" },
  { id: 32, name: "KATI/JANU/GREEVA BASTHI" },
  { id: 33, name: "KAVALA / GANDUSHA" },
  { id: 34, name: "KSHARAKARMA EXTERNAL" },
  { id: 35, name: "KSHEERA DHOOMAM" },
  { id: 36, name: "Kshara Sutra Thread Removal" },
  { id: 37, name: "LAVANA SWEDAM (STHANIKA)" },
  { id: 38, name: "LEPANAM (STHANIKA)" },
  { id: 39, name: "MATRA BASTHI" },
  { id: 40, name: "MUKHA SWEDA" },
  { id: 41, name: "MUKHALEPA" },
  { id: 42, name: "Minor Agnikarma" },
  { id: 43, name: "NADI SWEDAM" },
  { id: 44, name: "NASYA" },
  { id: 45, name: "PARISHEKA / KSHALANA (SARVANGA)" },
  { id: 46, name: "PARISHEKA / KSHALANA (STHANIKA)" },
  { id: 47, name: "PATRA PINDA SWEDA (ADHOSHAKA)" },
  { id: 48, name: "PATRA PINDA SWEDAM (SARVANGA)" },
  { id: 49, name: "PATRA PINDA SWEDAM (STHANIKA)" },
  { id: 50, name: "PICHU" },
  { id: 51, name: "PINDI" },
  { id: 52, name: "PIZHICHIL" },
  { id: 53, name: "PRACHANNAM" },
  { id: 54, name: "PRIMARY KSHARA SUTRA APPLICATION" },
  { id: 55, name: "PROBING" },
  { id: 56, name: "PROCTOSCOPY" },
  { id: 57, name: "PUTAPAKAM" },
  { id: 58, name: "Pada abhyanga" },
  { id: 59, name: "SADYOVAMANAM" },
  { id: 60, name: "SARVANGA ABHYANGAM BASHPA SWEEDA" },
  { id: 61, name: "SASHTIKASHALI PINDA SWEDA (SARVANGA)" },
  { id: 62, name: "SASHTIKASHALI PINDA SWEDA (SHAKA)" },
  { id: 63, name: "SASHTIKASHALI PINDA SWEDA (STHANIKA)" },
  { id: 64, name: "SEKAM" },
  { id: 65, name: "SHIRO ABHYANGAM" },
  { id: 66, name: "SHIRO BASTHI" },
  { id: 67, name: "SHIRO DHARA" },
  { id: 68, name: "SIRAVYADHANAM" },
  { id: 69, name: "Sitz bath" },
  { id: 70, name: "Snana Kit" },
  { id: 71, name: "Snehapana" },
  { id: 72, name: "Swarna Prashana" },
  { id: 73, name: "TAKRA DHARA" },
  { id: 74, name: "THALAM" },
  { id: 75, name: "THALAPOTHICHIL" },
  { id: 76, name: "THARPANAM" },
  { id: 77, name: "TRANSFIXATION & LIGATION" },
  { id: 78, name: "UDWARTHANAM" },
  { id: 79, name: "UPANAHA" },
  { id: 80, name: "UTSADANA" },
  { id: 81, name: "VAITARANA BASTHI" },
  { id: 82, name: "VALUKA SWEDA ( ADHOSHAKA )" },
  { id: 83, name: "VALUKA SWEDA ( SARVANGA )" },
  { id: 84, name: "VALUKA SWEDA ( STHANIKA )" },
  { id: 85, name: "VAMANAM" },
  { id: 86, name: "VESHTANAM" },
  { id: 87, name: "VIDALAKAM" },
  { id: 88, name: "VIRECHANAM" },
  { id: 89, name: "YOGA BASTHI" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry an upsert on MySQL lock-wait/deadlock (1205/1213) with backoff. */
async function upsertWithRetry(t: { id: number; name: string }, attempts = 5): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await prisma.therapy.upsert({
        where: { name: t.name },
        update: { duration: DEFAULT_DURATION },
        create: { id: t.id, name: t.name, duration: DEFAULT_DURATION },
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
  for (const t of THERAPIES) {
    await upsertWithRetry(t);
  }
  console.log(`✓ seed-therapies complete. ${THERAPIES.length} therapies upserted.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("seed-therapies failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
