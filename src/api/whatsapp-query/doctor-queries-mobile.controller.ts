import type { NextFunction, Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { draftQueryReply } from '../../service/query-reply-ai';
import { rangeFlag } from '../investigation-result/doctor-reports-mobile.controller';

// Doctor mobile app — WhatsApp report-query inbox. The web endpoints stay as
// they are; these add a doctor-ownership check, waiting time, the patient's
// recent results, and an AI-drafted reply the doctor edits before sending.
// Reply/close reuse the web handlers (same delivery + 24h-window logic) behind
// requireOwnQuery. Users without a Doctor row (admins) may open any query.

const DAY_MS = 24 * 60 * 60 * 1000;

async function doctorForUser(req: Request) {
  const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
  return userId ? prisma.doctor.findFirst({ where: { userId }, select: { id: true, name: true } }) : null;
}

/** Minutes the patient has been waiting since their latest unanswered message; null when the doctor spoke last. */
export function waitingMinutes(messages: { direction: string; created_at: Date }[], now = Date.now()): number | null {
  const last = messages[messages.length - 1];
  if (!last || last.direction !== 'IN') return null;
  // Waiting started at the first patient message after the doctor's last reply.
  let i = messages.length - 1;
  while (i > 0 && messages[i - 1].direction === 'IN') i--;
  return Math.max(0, Math.round((now - messages[i].created_at.getTime()) / 60000));
}

/** GET /api/whatsapp-query/my-inbox?status=open|answered|closed|all */
export const getMyInbox = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctor = await doctorForUser(req);
    const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : undefined;
    const rows = await prisma.whatsappQuery.findMany({
      where: { ...(doctor ? { doctorId: doctor.id } : {}), ...(status ? { status } : {}) },
      orderBy: { lastPatientMsgAt: 'desc' },
      take: 200,
      include: { messages: { orderBy: { created_at: 'asc' }, select: { direction: true, body: true, mediaType: true, created_at: true } } },
    });
    const data = rows
      .map((q) => {
        const last = q.messages[q.messages.length - 1];
        return {
          id: q.id,
          refNo: q.refNo,
          prn: q.prn,
          patientName: q.patientName,
          status: q.status,
          doctorName: doctor ? undefined : q.doctorName,
          lastPatientMsgAt: q.lastPatientMsgAt,
          waitingMinutes: q.status === 'closed' ? null : waitingMinutes(q.messages),
          lastMessage: last ? { direction: last.direction, preview: (last.body || (last.mediaType ? `(${last.mediaType})` : '')).slice(0, 140), at: last.created_at } : null,
          messageCount: q.messages.length,
        };
      })
      // Longest-waiting first, then most recent.
      .sort((a, b) => (b.waitingMinutes ?? -1) - (a.waitingMinutes ?? -1) || +new Date(b.lastPatientMsgAt) - +new Date(a.lastPatientMsgAt));
    res.status(200).json({ data });
  } catch (error) {
    console.error('[whatsapp-query:my-inbox] failed:', error);
    res.status(500).json({ error: 'Failed to load your patient queries' });
  }
};

/** Middleware: 404 unknown query, 403 another doctor's query. */
export const requireOwnQuery = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid query id' });
      return;
    }
    const [doctor, q] = await Promise.all([doctorForUser(req), prisma.whatsappQuery.findUnique({ where: { id }, select: { doctorId: true } })]);
    if (!q) {
      res.status(404).json({ error: 'Query not found' });
      return;
    }
    if (doctor && q.doctorId !== doctor.id) {
      res.status(403).json({ error: 'This query was sent to another doctor' });
      return;
    }
    next();
  } catch (error) {
    console.error('[whatsapp-query:own] failed:', error);
    res.status(500).json({ error: 'Failed to load the query' });
  }
};

async function recentResults(prn: number) {
  const rows = await prisma.investigationResult.findMany({
    where: { prn: String(prn), isDeleted: false, createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) } },
    select: { id: true, orderId: true, testName: true, department: true, result: true, unit: true, referenceRange: true, criticalFlag: true, impression: true, reportedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });
  return rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    testName: r.testName,
    department: r.department,
    result: r.department === 'radiology' ? r.impression ?? r.result : r.result,
    unit: r.unit,
    referenceRange: r.referenceRange,
    flag: r.criticalFlag ? 'C' : rangeFlag(r.result, r.referenceRange),
    at: r.reportedAt ?? r.createdAt,
  }));
}

async function patientOf(prn: number) {
  return prisma.patientDetails.findFirst({ where: { prn }, select: { name: true, age: true, gender: true } });
}

/** GET /api/whatsapp-query/my/:id — conversation, waiting time, patient, recent results (behind requireOwnQuery). */
export const getMyQuery = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.whatsappQuery.findUnique({ where: { id }, include: { messages: { orderBy: { created_at: 'asc' } } } });
    if (!q) {
      res.status(404).json({ error: 'Query not found' });
      return;
    }
    const [patient, results] = await Promise.all([patientOf(q.prn), recentResults(q.prn)]);
    res.status(200).json({
      data: {
        id: q.id,
        refNo: q.refNo,
        prn: q.prn,
        patientName: q.patientName ?? patient?.name ?? null,
        patient,
        status: q.status,
        doctorName: q.doctorName,
        lastPatientMsgAt: q.lastPatientMsgAt,
        // Free text only inside WhatsApp's 24h window; outside it the reply goes as a template.
        withinWindow: Date.now() - q.lastPatientMsgAt.getTime() < DAY_MS,
        waitingMinutes: q.status === 'closed' ? null : waitingMinutes(q.messages),
        messages: q.messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          body: m.body,
          sender: m.sender,
          mediaUrl: m.mediaUrl,
          mediaType: m.mediaType,
          fileName: m.fileName,
          at: m.created_at,
        })),
        results,
      },
    });
  } catch (error) {
    console.error('[whatsapp-query:my:get] failed:', error);
    res.status(500).json({ error: 'Failed to load the query' });
  }
};

/** POST /api/whatsapp-query/my/:id/draft — AI-suggested reply + translations. Nothing is sent or stored. */
export const draftMyReply = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.whatsappQuery.findUnique({ where: { id }, include: { messages: { orderBy: { created_at: 'asc' } } } });
    if (!q) {
      res.status(404).json({ error: 'Query not found' });
      return;
    }
    if (!q.messages.some((m) => m.direction === 'IN' && m.body.trim())) {
      res.status(422).json({ error: 'The patient has not written anything to answer yet.' });
      return;
    }
    const doctor = await doctorForUser(req);
    const [patient, results] = await Promise.all([patientOf(q.prn), recentResults(q.prn)]);
    const draft = await draftQueryReply({
      doctorName: doctor?.name ?? q.doctorName,
      patient: { name: q.patientName ?? patient?.name ?? null, age: patient?.age ?? null, gender: patient?.gender ?? null },
      messages: q.messages.slice(-12).map((m) => ({ id: m.id, direction: m.direction, body: m.body, sender: m.sender, at: m.created_at })),
      results: results.slice(0, 20),
    });
    await auditLog(req, { module: 'whatsapp-query', action: 'AI_DRAFT', entityType: 'WhatsappQuery', entityId: String(id), payload: { model: draft.model, via: 'mobile' } });
    res.status(200).json({ data: draft });
  } catch (error) {
    console.error('[whatsapp-query:my:draft] failed:', error);
    res.status(502).json({ error: "Couldn't draft a reply right now. You can still write one yourself." });
  }
};
