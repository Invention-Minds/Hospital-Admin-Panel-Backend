import prisma from './prisma-client';
import { createSecureLink } from './record-access.service';
import { buildRecordFile } from './record-builder.service';
import {
  notifyReportReady,
  notifyOpdNotesReady,
  notifyPrescriptionReady,
  notifyDischargeSummaryReady,
} from './whatsapp-notify.service';

// "Your document is ready" pushes. Each: build the PDF → store privately →
// mint an expiring link → send the approved template with the link token.
//
// All are fire-and-forget from the clinical flow: they never throw, so a
// WhatsApp problem can never fail a clinical save.

const fmtDate = (d: Date | string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

export async function pushReportReady(resultId: number): Promise<void> {
  try {
    const r = await prisma.investigationResult.findUnique({ where: { id: resultId } });
    if (!r || r.isDeleted || r.status !== 'final') return;
    const prn = Number(r.prn);
    if (!prn || Number.isNaN(prn)) return;
    const pd = await prisma.patientDetails.findUnique({ where: { prn }, select: { name: true } });
    if (!pd) return;

    const built = await buildRecordFile('REC_REPORTS', String(resultId), prn, pd.name);
    if (!built) return;
    const { token } = await createSecureLink({
      prn, kind: 'REC_REPORTS', refId: String(resultId), filePath: built.filePath, fileName: built.fileName,
    });
    await notifyReportReady(prn, pd.name, r.testName, token, String(resultId));
  } catch (e) {
    console.warn('[record-push] report failed:', (e as Error).message);
  }
}

export async function pushOpdNotesReady(noteId: number): Promise<void> {
  try {
    const n = await prisma.doctorNote.findUnique({ where: { id: noteId } });
    if (!n) return;
    const pd = await prisma.patientDetails.findUnique({ where: { prn: n.prn }, select: { name: true } });
    if (!pd) return;
    const doc = n.doctorId ? await prisma.doctor.findUnique({ where: { id: n.doctorId }, select: { name: true } }) : null;

    const built = await buildRecordFile('REC_OPD', String(noteId), n.prn, pd.name);
    if (!built) return;
    const { token } = await createSecureLink({
      prn: n.prn, kind: 'REC_OPD', refId: String(noteId), filePath: built.filePath, fileName: built.fileName,
    });
    await notifyOpdNotesReady(n.prn, pd.name, doc?.name ?? 'your doctor', n.date || fmtDate(n.createdAt), token, String(noteId));
  } catch (e) {
    console.warn('[record-push] opd notes failed:', (e as Error).message);
  }
}

export async function pushPrescriptionReady(prescriptionId: string): Promise<void> {
  try {
    const p = await prisma.prescription.findUnique({ where: { prescriptionId } });
    if (!p) return;
    const prn = Number(p.prn);
    if (!prn || Number.isNaN(prn)) return;
    const pd = await prisma.patientDetails.findUnique({ where: { prn }, select: { name: true } });
    if (!pd) return;

    const built = await buildRecordFile('REC_RX', prescriptionId, prn, pd.name);
    if (!built) return;
    const { token } = await createSecureLink({
      prn, kind: 'REC_RX', refId: prescriptionId, filePath: built.filePath, fileName: built.fileName,
    });
    await notifyPrescriptionReady(prn, pd.name, p.prescribedBy, token, prescriptionId);
  } catch (e) {
    console.warn('[record-push] prescription failed:', (e as Error).message);
  }
}

export async function pushDischargeSummaryReady(admissionId: string, doctorName?: string): Promise<void> {
  try {
    const adm = await prisma.ipdAdmission.findUnique({ where: { id: admissionId }, select: { prn: true } });
    if (!adm) return;
    const prn = Number(adm.prn);
    if (!prn || Number.isNaN(prn)) return;
    const pd = await prisma.patientDetails.findUnique({ where: { prn }, select: { name: true } });
    if (!pd) return;

    const built = await buildRecordFile('REC_DISCHARGE', admissionId, prn, pd.name);
    if (!built) return;
    const { token } = await createSecureLink({
      prn, kind: 'REC_DISCHARGE', refId: admissionId, filePath: built.filePath, fileName: built.fileName,
    });
    await notifyDischargeSummaryReady(prn, pd.name, doctorName ?? 'your doctor', token, admissionId);
  } catch (e) {
    console.warn('[record-push] discharge summary failed:', (e as Error).message);
  }
}
