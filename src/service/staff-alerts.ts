import axios from 'axios';
import prisma from './prisma-client';
import { sendTemplate } from './gobuzz.service';
import { formatGoBuzzPhone } from './gobuzz-document';

// WhatsApp / SMS alerts to STAFF for quality escalations.
//
// Off unless switched on in the environment — both channels need a template
// approved outside this code first:
//   STAFF_ALERTS_WHATSAPP_ENABLED=true   + an approved WhatsApp template named
//       STAFF_ALERTS_WA_TEMPLATE (default 'quality_escalation_alert') with body
//       "Escalation level {{1}}: {{2}} {{3}} ({{4}}) is still open — {{5}}. Please review it in DocMinds."
//   STAFF_ALERTS_SMS_ENABLED=true        + a DLT template SMS_DLT_TE_ID_FOR_ESCALATION:
//       "DocMinds alert: {#var#} {#var#} escalated to level {#var#} and is still open. Please review in DocMinds. - Rashtrotthana Hospital"
//
// Messages carry only the case code, module, severity and unit — never a
// patient name or PRN. Every attempt is logged in StaffAlertLog, and a refId
// that was already sent on a channel is never resent.

const LANG = process.env.GOBUZZ_TEMPLATE_LANG || 'en_US';
const waEnabled = () => process.env.STAFF_ALERTS_WHATSAPP_ENABLED === 'true';
const smsEnabled = () => process.env.STAFF_ALERTS_SMS_ENABLED === 'true';
const WA_TEMPLATE = () => process.env.STAFF_ALERTS_WA_TEMPLATE || 'quality_escalation_alert';

export interface EscalationAlert {
  level: number;
  module: 'Incident' | 'Complaint';
  code: string;
  severity: string;
  unit: string | null;
  refId: string; // per case + level; the user id is appended per recipient
}

async function log(row: { userId: number; channel: string; phone: string; template: string; refId: string; status: string; error?: string }) {
  await prisma.staffAlertLog.create({ data: { ...row, refType: 'QualityEscalation', error: row.error ?? null } })
    .catch((e) => console.warn('[staff-alerts] log failed:', (e as Error).message));
}

async function alreadySent(channel: string, refId: string): Promise<boolean> {
  return (await prisma.staffAlertLog.count({ where: { channel, refId, status: 'sent' } })) > 0;
}

/** SMS through the DLT gateway (same transport as OTP SMS). Returns true when sent. */
async function sendDltSms(phone: string, message: string, templateId: string): Promise<void> {
  const apiUrl = process.env.SMS_API_URL;
  const sender = process.env.SMS_SENDER;
  const apiKey = process.env.SMS_API_KEY;
  const entityId = process.env.DLT_ENTITY_ID;
  if (!apiUrl || !sender || !apiKey || !entityId) throw new Error('SMS gateway env not configured');
  const url = `${apiUrl}/${sender}/${phone}/${encodeURIComponent(message)}/TXT?apikey=${apiKey}&dltentityid=${entityId}&dlttempid=${templateId}`;
  await axios.get(url, { timeout: 15000 });
}

/**
 * Sends the escalation alert to each user on the requested channels. Never
 * throws; returns how many messages went out per channel.
 */
export async function sendEscalationAlerts(
  userIds: number[], alert: EscalationAlert, channels: { whatsapp: boolean; sms: boolean },
): Promise<{ whatsapp: number; sms: number }> {
  const out = { whatsapp: 0, sms: 0 };
  const wantWa = channels.whatsapp && waEnabled();
  const smsTemplate = process.env.SMS_DLT_TE_ID_FOR_ESCALATION;
  const wantSms = channels.sms && smsEnabled() && !!smsTemplate;
  if ((!wantWa && !wantSms) || !userIds.length) return out;

  const users = await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, phoneNumber: true } });
  for (const u of users) {
    const refId = `${alert.refId}:${u.id}`;
    const raw = (u.phoneNumber ?? '').replace(/\D/g, '');
    if (raw.length < 10) {
      if (wantWa) await log({ userId: u.id, channel: 'whatsapp', phone: '', template: WA_TEMPLATE(), refId, status: 'skipped', error: 'no phone number on the staff record' });
      if (wantSms) await log({ userId: u.id, channel: 'sms', phone: '', template: smsTemplate as string, refId, status: 'skipped', error: 'no phone number on the staff record' });
      continue;
    }
    if (wantWa && !(await alreadySent('whatsapp', refId))) {
      const phone = formatGoBuzzPhone(raw);
      try {
        await sendTemplate(phone, WA_TEMPLATE(), LANG, [
          String(alert.level), alert.module, alert.code, alert.severity, alert.unit ?? 'no unit assigned',
        ]);
        await log({ userId: u.id, channel: 'whatsapp', phone, template: WA_TEMPLATE(), refId, status: 'sent' });
        out.whatsapp += 1;
      } catch (e) {
        await log({ userId: u.id, channel: 'whatsapp', phone, template: WA_TEMPLATE(), refId, status: 'failed', error: (e as Error).message });
      }
    }
    if (wantSms && !(await alreadySent('sms', refId))) {
      const phone = raw.slice(-10);
      // Must match the registered DLT template text exactly, variables filled in.
      const message = `DocMinds alert: ${alert.module} ${alert.code} escalated to level ${alert.level} and is still open. Please review in DocMinds. - Rashtrotthana Hospital`;
      try {
        await sendDltSms(phone, message, smsTemplate as string);
        await log({ userId: u.id, channel: 'sms', phone, template: smsTemplate as string, refId, status: 'sent' });
        out.sms += 1;
      } catch (e) {
        await log({ userId: u.id, channel: 'sms', phone, template: smsTemplate as string, refId, status: 'failed', error: (e as Error).message });
      }
    }
  }
  return out;
}
