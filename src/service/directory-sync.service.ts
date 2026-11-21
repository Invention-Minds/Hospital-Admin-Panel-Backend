import cron from 'node-cron';
import prisma from './prisma-client';

/**
 * Tenant directory sync — keeps the shared HRMinds/Smart Assets directory
 * (hrminds-directory, product = DOCMINDS) told which phones and employee IDs
 * belong to THIS DocMinds backend, so the one DocMinds app on Google Play can
 * send each person to their own hospital's server.
 *
 * Off unless both are set (each DocMinds server has its own tenant key):
 *   DIRECTORY_URL      e.g. https://hrmindsdirectory.imapps.in
 *   DIRECTORY_API_KEY  the tenant apiKey printed by scripts/add-docminds-tenants.ts
 *
 * The User table has no updatedAt, so this pushes the whole list (a few
 * hundred rows) every 30 minutes — inactive users go as isActive:false so the
 * directory stops routing them. No web endpoint is touched.
 */

const PRODUCT = 'DOCMINDS';
const CHUNK = 500;

export function directorySyncEnabled(): boolean {
  return !!process.env.DIRECTORY_URL?.trim() && !!process.env.DIRECTORY_API_KEY?.trim();
}

type Entry = { type: 'PHONE' | 'EMPLOYEE_ID'; value: string; fullName: string | null; isActive: boolean };

/** Phones as the app sends them: digits, Indian 10-digit numbers with the 91 prefix. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d.length >= 11 ? d : null;
}

/**
 * Everything someone can type on the DocMinds sign-in screen, mirroring the
 * login controller: an employee ID (every user), or a phone number — which
 * signs in doctors (Doctor.phone_number) and therapists (Therapist.phoneNumber)
 * linked to a user. User.phoneNumber is sent too, for staff who have one.
 */
export async function buildDirectoryEntries(): Promise<Entry[]> {
  const [users, doctors, therapists] = await Promise.all([
    prisma.user.findMany({ select: { id: true, employeeId: true, phoneNumber: true, fullName: true, username: true, isActive: true } }),
    prisma.doctor.findMany({ where: { userId: { not: null } }, select: { userId: true, phone_number: true, name: true } }),
    prisma.therapist.findMany({ where: { userId: { not: null } }, select: { userId: true, phoneNumber: true } }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const seen = new Set<string>();
  const out: Entry[] = [];
  const push = (e: Entry) => {
    const k = `${e.type}:${e.type === 'EMPLOYEE_ID' ? e.value.toUpperCase() : e.value}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };
  for (const u of users) {
    const name = u.fullName?.trim() || u.username || null;
    if (u.employeeId?.trim()) push({ type: 'EMPLOYEE_ID', value: u.employeeId.trim(), fullName: name, isActive: u.isActive });
    const phone = normalizePhone(u.phoneNumber);
    if (phone) push({ type: 'PHONE', value: phone, fullName: name, isActive: u.isActive });
  }
  for (const d of doctors) {
    const u = byId.get(d.userId!);
    const phone = normalizePhone(d.phone_number);
    if (u && phone) push({ type: 'PHONE', value: phone, fullName: d.name ?? u.fullName ?? u.username, isActive: u.isActive });
  }
  for (const t of therapists) {
    const u = byId.get(t.userId!);
    const phone = normalizePhone(t.phoneNumber);
    if (u && phone) push({ type: 'PHONE', value: phone, fullName: u.fullName ?? u.username, isActive: u.isActive });
  }
  return out;
}

/** Push every user's phone / employee ID to the directory. Returns the totals the directory reports. */
export async function syncAllUsersToDirectory(): Promise<{ sent: number; created: number; updated: number; skipped: number }> {
  if (!directorySyncEnabled()) throw new Error('Directory sync is off: set DIRECTORY_URL and DIRECTORY_API_KEY');
  const base = process.env.DIRECTORY_URL!.trim().replace(/\/$/, '');
  const entries = await buildDirectoryEntries();
  const totals = { sent: entries.length, created: 0, updated: 0, skipped: 0 };
  for (let i = 0; i < entries.length; i += CHUNK) {
    const res = await fetch(`${base}/api/directory/sync/identifier/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-key': process.env.DIRECTORY_API_KEY!.trim() },
      body: JSON.stringify({ product: PRODUCT, entries: entries.slice(i, i + CHUNK) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Directory answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { created?: number; updated?: number; skipped?: number };
    totals.created += body.created ?? 0;
    totals.updated += body.updated ?? 0;
    totals.skipped += body.skipped ?? 0;
  }
  return totals;
}

/** Every 30 minutes (and once shortly after start). No-op unless the env is set. */
export function registerDirectorySyncCron(): void {
  if (!directorySyncEnabled()) {
    console.log('[directory-sync] off (DIRECTORY_URL / DIRECTORY_API_KEY not set)');
    return;
  }
  const run = async () => {
    try {
      const t = await syncAllUsersToDirectory();
      console.log(`[directory-sync] sent ${t.sent} · created ${t.created} · updated ${t.updated} · skipped ${t.skipped}`);
    } catch (err) {
      console.error('[directory-sync] failed:', (err as Error).message);
    }
  };
  setTimeout(() => void run(), 60_000);
  cron.schedule('*/30 * * * *', () => void run());
}
