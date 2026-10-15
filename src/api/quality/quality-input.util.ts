import moment from 'moment-timezone';

// Shared input helpers for the Quality capture controllers.
//
// Date-only strings (YYYY-MM-DD) are interpreted as Asia/Kolkata calendar
// days — `new Date('YYYY-MM-DD')` would otherwise be UTC midnight (05:30 IST).
// Anything else (ISO with offset, datetime-local) goes through `new Date()`,
// which uses the server TZ (Asia/Kolkata) for offset-less timestamps.

export const HOSPITAL_TZ = 'Asia/Kolkata';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// IpdDischarge.dischargeType is free text; match every casing of a death.
export const EXPIRED_DISCHARGE_TYPES = ['expired', 'Expired', 'EXPIRED'];

export const INVALID = 'invalid' as const;
export type ParsedDate = Date | null | typeof INVALID;

/** null when absent/empty, 'invalid' when unparseable. Date-only → IST start (or end) of day. */
export function parseDateInput(raw: unknown, endOfDay = false): ParsedDate {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'string' && DATE_ONLY.test(raw.trim())) {
    const m = moment.tz(raw.trim(), 'YYYY-MM-DD', true, HOSPITAL_TZ);
    if (!m.isValid()) return INVALID;
    return (endOfDay ? m.endOf('day') : m.startOf('day')).toDate();
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') return INVALID;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? INVALID : d;
}

/** Build a Prisma {gte, lte} filter from from/to query params; `to` date-only is inclusive of that day. */
export function parseRangeQuery(from?: string, to?: string): Record<string, Date> | null | typeof INVALID {
  const f = parseDateInput(from);
  const t = parseDateInput(to, true);
  if (f === INVALID || t === INVALID) return INVALID;
  if (!f && !t) return null;
  const range: Record<string, Date> = {};
  if (f) range['gte'] = f;
  if (t) range['lte'] = t;
  return range;
}

export function prismaErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
}
