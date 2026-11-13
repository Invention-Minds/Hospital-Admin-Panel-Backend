import axios from 'axios';
import prisma from './prisma-client';

// Push notifications to the DocMinds mobile app through Expo's push service.
//
// Lock-screen rule (DPDP Act, approved on mockup screen 02): the title and
// body never carry a patient's name, PRN or result. They only say that
// something needs attention; the details open inside the app after Face ID.
// `data.path` tells the app which screen to open.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo accepts up to 100 messages per request

export type PushKind = 'critical_result' | 'patient_query' | 'discharge_ready' | 'quality_digest';

/** The approved wording — generic on purpose. */
export const PUSH_COPY: Record<PushKind, { title: string; body: string }> = {
  critical_result: { title: 'Critical result', body: 'A critical lab value needs your review. Open DocMinds to view.' },
  patient_query: { title: 'Patient query', body: 'A patient has asked about their report.' },
  discharge_ready: { title: 'Discharge summary ready', body: 'A drafted discharge summary is waiting for your review.' },
  quality_digest: { title: 'Morning digest', body: 'Your quality summary for today is ready.' },
};

export const isPushEnabled = () => process.env.MOBILE_PUSH_ENABLED === 'true';

type ExpoTicket = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } };

/**
 * Send one alert to one user's active devices, at most once per eventKey.
 * Returns false when it was already sent (or the user has no device).
 */
export async function pushOnce(opts: { userId: number; kind: PushKind; entityId: string; path: string }): Promise<boolean> {
  const eventKey = `${opts.kind}:${opts.entityId}:${opts.userId}`.slice(0, 191);
  const devices = await prisma.mobilePushDevice.findMany({ where: { userId: opts.userId, disabledAt: null }, select: { id: true, token: true } });
  if (!devices.length) return false;

  // Claim the event first: the unique key makes a second send impossible.
  try {
    await prisma.mobilePushLog.create({ data: { eventKey, userId: opts.userId, kind: opts.kind, devices: devices.length } });
  } catch {
    return false; // already sent
  }

  const copy = PUSH_COPY[opts.kind];
  const messages = devices.map((d) => ({
    to: d.token,
    title: copy.title,
    body: copy.body,
    data: { path: opts.path, kind: opts.kind },
    sound: 'default',
    priority: 'high',
    channelId: 'alerts',
  }));

  const errors: string[] = [];
  for (let i = 0; i < messages.length; i += BATCH) {
    const chunk = messages.slice(i, i + BATCH);
    try {
      const r = await axios.post<{ data: ExpoTicket[] }>(EXPO_PUSH_URL, chunk, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        timeout: 15_000,
      });
      const tickets = r.data?.data ?? [];
      for (let j = 0; j < tickets.length; j++) {
        const t = tickets[j];
        if (t.status === 'error') {
          errors.push(t.details?.error ?? t.message ?? 'error');
          // The app was uninstalled or the token rotated — stop sending to it.
          if (t.details?.error === 'DeviceNotRegistered') {
            await prisma.mobilePushDevice.updateMany({ where: { token: chunk[j].to }, data: { disabledAt: new Date() } });
          }
        }
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (errors.length) {
    await prisma.mobilePushLog.update({ where: { eventKey }, data: { error: errors.join('; ').slice(0, 2000) } }).catch(() => undefined);
  }
  return true;
}
