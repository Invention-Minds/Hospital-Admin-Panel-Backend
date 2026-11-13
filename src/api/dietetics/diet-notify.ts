import prisma from '../../service/prisma-client';
import { readSettings } from './masters.controller';

/**
 * In-app bell notifications for the dietary workflow.
 *
 * Types start with `diet_` and target a role the bell understands:
 *   'Dietician' → Dietician / Diet sub-admins
 *   'doctor'    → every doctor (night cover, when the dietitian is off duty)
 *
 * Never throws — a notification must not block a clinical action.
 */

export type DietNotifyType = 'diet_new_admission' | 'diet_census' | 'diet_change' | 'diet_night_ack';

const minutesOf = (hhmm: unknown): number | null => {
  const m = String(hhmm ?? '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** True while the dietitian is off duty (night window from settings, default 19:00–07:00). */
export async function isDietNight(at: Date = new Date()): Promise<boolean> {
  const s = await readSettings();
  const from = minutesOf(s.nightFrom) ?? 19 * 60;
  const until = minutesOf(s.nightUntil) ?? 7 * 60;
  const m = at.getHours() * 60 + at.getMinutes();
  return from <= until ? m >= from && m < until : m >= from || m < until;
}

/**
 * Notify the dietitian; during the night window doctors are told as well
 * (any doctor may acknowledge a new admission / diet change at night).
 */
export async function notifyDiet(type: DietNotifyType, title: string, message: string): Promise<void> {
  try {
    const night = await isDietNight();
    const targets = night ? ['Dietician', 'doctor'] : ['Dietician'];
    await prisma.notification.createMany({
      data: targets.map((targetRole) => ({
        type,
        title,
        message: night && targetRole === 'doctor' ? `${message} — please acknowledge (Night diet acknowledgement).` : message,
        targetRole,
        entityType: 'Dietetics',
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      })),
    });
  } catch (err) {
    console.error(`[dietetics] notifyDiet(${type}) failed:`, err);
  }
}
