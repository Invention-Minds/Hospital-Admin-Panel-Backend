import path from 'path';
import prisma from './prisma-client';
import { PRIVATE_DIR, savePrivateFile } from './record-access.service';
import { renderReportPdf, renderOpdNotePdf, renderPrescriptionPdf, type TemplateFieldDef } from './record-pdf.service';
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
    const doc = n.doctorId ? await prisma.doctor.findUnique({ where: { id: n.doctorId }, select: { name: true, departmentName: true } }) : null;
    // The rest of the visit (same PRN, same date): vitals, tests ordered, medicines.
    const [appt, orders, rx] = await Promise.all([
      prisma.appointment.findFirst({
        where: { prnNumber: n.prn, date: n.date },
        orderBy: { id: 'desc' },
        select: { BPs: true, BPd: true, pulse: true, spo2: true, temp: true, weight: true, RR: true, age: true, gender: true, department: true },
      }),
      prisma.investigationOrder.findMany({
        where: { prn: String(n.prn), date: n.date },
        select: { labTests: { select: { description: true } }, radiologyTests: { select: { description: true } } },
      }),
      prisma.prescription.findMany({
        where: { prn: String(n.prn), prescribedDate: n.date },
        select: { tablets: { select: { brandName: true, genericName: true, frequency: true, duration: true, instructions: true } } },
      }),
    ]);
    const vitals = appt
      ? [
          appt.BPs && appt.BPd ? `BP ${appt.BPs}/${appt.BPd}` : null,
          appt.pulse ? `Pulse ${appt.pulse}` : null,
          appt.spo2 ? `SpO2 ${appt.spo2}%` : null,
          appt.temp ? `Temp ${appt.temp}` : null,
          appt.RR ? `RR ${appt.RR}` : null,
          appt.weight ? `Weight ${appt.weight} kg` : null,
        ].filter(Boolean).join('   ')
      : '';
    let template: { fields: TemplateFieldDef[]; values: Record<string, unknown> } | null = null;
    if (n.noteTemplateId && n.templatedValues) {
      try {
        const t = JSON.parse(n.templatedValues) as { _schema?: TemplateFieldDef[]; _values?: Record<string, unknown> };
        if (Array.isArray(t._schema) && t._schema.length) template = { fields: t._schema, values: t._values ?? {} };
      } catch {
        template = null;
      }
    }
    const buf = await renderOpdNotePdf({
      patientName, prn, doctorName: doc?.name ?? '-', date: n.date,
      age: appt?.age ?? null, gender: appt?.gender ?? null, department: doc?.departmentName ?? appt?.department ?? null,
      chiefComplaints: n.chiefComplaints, diagnosis: n.diagnosis,
      generalExamination: n.generalExamination, clinicalNotes: n.clinicalNotes, advice: n.advice,
      cvs: n.cvs, rs: n.rs, cns: n.cns, pa: n.pa,
      vitals: vitals || null,
      template,
      investigations: orders.flatMap((o) => [...o.labTests, ...o.radiologyTests].map((t) => t.description)),
      medicines: rx.flatMap((p) => p.tablets).map((t) => ({ name: t.brandName || t.genericName, frequency: t.frequency, duration: t.duration, instructions: t.instructions })),
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
