import path from 'path';
import prisma from './prisma-client';
import { PRIVATE_DIR, savePrivateFile } from './record-access.service';
import { renderReportPdf, renderOpdNotePdf, renderPrescriptionPdf } from './record-pdf.service';
import { generateDischargePDF } from '../api/ipd/discharge-pdf-generator';

// Single place that turns a record reference into a PDF on PRIVATE storage.
// Used by both the WhatsApp bot ("My Records") and the push/journey engine, so
// the two can never drift apart.

export type RecordKind = 'REC_REPORTS' | 'REC_OPD' | 'REC_RX' | 'REC_DISCHARGE';

export interface BuiltRecord {
  filePath: string;
  fileName: string;
}

export async function buildRecordFile(
  kind: string,
  ref: string,
  prn: number,
  patientName: string,
): Promise<BuiltRecord | null> {
  if (kind === 'REC_REPORTS') {
    const r = await prisma.investigationResult.findUnique({ where: { id: Number(ref) } });
    if (!r) return null;
    const buf = await renderReportPdf({
      patientName, prn, testName: r.testName, department: r.department,
      reportedAt: r.reportedAt, result: r.result, unit: r.unit, referenceRange: r.referenceRange,
      findings: r.findings, impression: r.impression,
    });
    const fileName = `Report-${r.testName}.pdf`.replace(/\s+/g, '-');
    return { filePath: savePrivateFile(buf, fileName).filePath, fileName };
  }

  if (kind === 'REC_OPD') {
    const n = await prisma.doctorNote.findUnique({ where: { id: Number(ref) } });
    if (!n) return null;
    const doc = n.doctorId ? await prisma.doctor.findUnique({ where: { id: n.doctorId }, select: { name: true } }) : null;
    const buf = await renderOpdNotePdf({
      patientName, prn, doctorName: doc?.name ?? '-', date: n.date,
      chiefComplaints: n.chiefComplaints, diagnosis: n.diagnosis,
      generalExamination: n.generalExamination, clinicalNotes: n.clinicalNotes, advice: n.advice,
    });
    const fileName = `Consultation-${n.date || n.id}.pdf`.replace(/\s+/g, '-');
    return { filePath: savePrivateFile(buf, fileName).filePath, fileName };
  }

  if (kind === 'REC_RX') {
    const p = await prisma.prescription.findUnique({ where: { prescriptionId: ref }, include: { tablets: true } });
    if (!p) return null;
    const buf = await renderPrescriptionPdf({
      patientName, prn, prescribedBy: p.prescribedBy, prescribedDate: p.prescribedDate,
      prescriptionId: p.prescriptionId, tablets: p.tablets,
    });
    const fileName = `Prescription-${p.prescriptionId}.pdf`;
    return { filePath: savePrivateFile(buf, fileName).filePath, fileName };
  }

  if (kind === 'REC_DISCHARGE') {
    const filePath = await generateDischargePDF(ref, PRIVATE_DIR); // ref = admissionId
    return { filePath, fileName: path.basename(filePath) };
  }

  return null;
}
