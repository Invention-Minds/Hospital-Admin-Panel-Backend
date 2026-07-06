import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { sendText, sendTemplate } from '../../service/gobuzz.service';

// ─── Doctor-side WhatsApp query inbox (Hospital Admin Panel) ────────────────
//
// Patients raise queries via the WhatsApp bot (whatsapp-bot.controller.ts);
// doctors read and answer them here. Replies are pushed back to the patient on
// WhatsApp — plain text inside the 24h window, else an approved template.

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Resolve the Doctor row for the logged-in panel user (null = treat as admin).
async function doctorForUser(userId?: number) {
  if (!userId) return null;
  return prisma.doctor.findFirst({ where: { userId }, select: { id: true, name: true } });
}

// GET /api/whatsapp-query/inbox?status=open
export const getInbox = async (req: Request, res: Response): Promise<void> => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const doctor = await doctorForUser(req.user?.id);
  const queries = await prisma.whatsappQuery.findMany({
    where: {
      ...(doctor ? { doctorId: doctor.id } : {}), // admins see all
      ...(status ? { status } : {}),
    },
    orderBy: { lastPatientMsgAt: 'desc' },
    include: { messages: { orderBy: { created_at: 'asc' } } },
  });
  res.json({ data: queries });
};

// GET /api/whatsapp-query/:id
export const getQuery = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const query = await prisma.whatsappQuery.findUnique({
    where: { id },
    include: { messages: { orderBy: { created_at: 'asc' } } },
  });
  if (!query) {
    res.status(404).json({ message: 'Query not found' });
    return;
  }
  res.json({ data: query });
};

// POST /api/whatsapp-query/:id/reply   body: { message }
export const replyToQuery = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const message = (req.body?.message ?? '').toString().trim();
  if (!message) {
    res.status(400).json({ message: 'message is required' });
    return;
  }
  const query = await prisma.whatsappQuery.findUnique({ where: { id } });
  if (!query) {
    res.status(404).json({ message: 'Query not found' });
    return;
  }

  const doctor = await doctorForUser(req.user?.id);
  const senderName = doctor?.name ?? req.user?.username ?? query.doctorName;

  // Deliver to the patient: text inside the 24h window, template outside it.
  const withinWindow = Date.now() - new Date(query.lastPatientMsgAt).getTime() < WINDOW_MS;
  const templateName = process.env.GOBUZZ_REPLY_TEMPLATE_NAME;
  const templateLang = process.env.GOBUZZ_REPLY_TEMPLATE_LANG ?? 'en_US';
  try {
    if (withinWindow || !templateName) {
      await sendText(query.patientPhone, `${senderName} replied:\n${message}`);
    } else {
      await sendTemplate(query.patientPhone, templateName, templateLang, [senderName, message]);
    }
  } catch (e) {
    res.status(502).json({ message: 'Failed to deliver reply to patient', error: (e as Error).message });
    return;
  }

  await prisma.whatsappQueryMessage.create({
    data: { queryId: id, direction: 'OUT', body: message, sender: senderName },
  });
  const updated = await prisma.whatsappQuery.update({
    where: { id },
    data: { status: 'answered' },
    include: { messages: { orderBy: { created_at: 'asc' } } },
  });
  res.json({ data: updated, deliveredVia: withinWindow || !templateName ? 'text' : 'template' });
};

// POST /api/whatsapp-query/:id/close
export const closeQuery = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const exists = await prisma.whatsappQuery.findUnique({ where: { id } });
  if (!exists) {
    res.status(404).json({ message: 'Query not found' });
    return;
  }
  const updated = await prisma.whatsappQuery.update({ where: { id }, data: { status: 'closed' } });
  // Notify the patient (best-effort; only delivers inside the 24h window).
  const helpline = process.env.WHATSAPP_HELPLINE_NUMBER || '+91 80 0000 0000';
  sendText(
    exists.patientPhone,
    `Your query ${exists.refNo} with ${exists.doctorName} has been closed. Message us anytime to start a new one.\nHelpline: ${helpline}`,
  ).catch(() => {});
  res.json({ data: updated });
};
