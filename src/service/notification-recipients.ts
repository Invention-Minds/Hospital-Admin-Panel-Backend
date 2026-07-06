import prisma from './prisma-client';

/**
 * Message recipient phone numbers, resolved by purpose (groupKey) from the
 * NotificationRecipient table. Replaces phone numbers hardcoded in controllers.
 *
 * Each deployment's DB (= one Hospital/client) holds its own numbers, so this
 * is editable per client without a code change.
 *
 * FALLBACK: if a group has no active rows yet (e.g. before the seed runs),
 * getRecipientPhones returns the original hardcoded list from FALLBACKS so
 * existing message flows keep working. Seed the table, then the DB wins.
 */

export type RecipientGroup =
  | 'appointment_confirm'
  | 'estimation_alert'
  | 'mhc_checkin'
  | 'radiology_queue'
  | 'dashboard_screenshot'
  | 'whatsapp_admin'
  | 'today_consultation_admin'
  | 'support_contact';

/** The numbers currently hardcoded in the codebase, keyed by group. */
export const FALLBACKS: Record<RecipientGroup, string[]> = {
  appointment_confirm: ['919880544866', '916364833988'],
  estimation_alert: ['919844171700', '916364833989', '918904943659', '917760158457', '918147818482'],
  mhc_checkin: ['919620306613', '916364833988', '919880544866'],
  radiology_queue: ['919620306613', '916364833988', '919880544866'],
  dashboard_screenshot: ['919496217976', '919341227264', '919995703633', '919880544866', '916364833988', '919342003000'],
  whatsapp_admin: ['919880544866', '916364833988'],
  today_consultation_admin: ['919880544866', '919341227264', '918904943673', '918951243004', '919633943037'],
  support_contact: ['919844005600'],
};

/**
 * Active recipient phone numbers for a group. DB rows win; falls back to the
 * hardcoded list if the group has no active rows. Never throws — on a DB error
 * it logs and returns the fallback so messaging is never blocked by this lookup.
 */
export const getRecipientPhones = async (group: RecipientGroup): Promise<string[]> => {
  try {
    const rows = await prisma.notificationRecipient.findMany({
      where: { groupKey: group, isActive: true },
      select: { phone: true },
    });
    const phones = rows.map((r) => r.phone.trim()).filter(Boolean);
    return phones.length > 0 ? phones : (FALLBACKS[group] ?? []);
  } catch (err) {
    console.error(`[notification-recipients] lookup failed for "${group}":`, err instanceof Error ? err.message : err);
    return FALLBACKS[group] ?? [];
  }
};

/** Single recipient (first active) for groups that expect one number. */
export const getRecipientPhone = async (group: RecipientGroup): Promise<string | null> => {
  const phones = await getRecipientPhones(group);
  return phones[0] ?? null;
};
