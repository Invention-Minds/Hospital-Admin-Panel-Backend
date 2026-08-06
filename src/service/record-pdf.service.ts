import PDFDocument from 'pdfkit';
import { applyJmrhLetterhead, drawJmrhFooter, CONTENT_TOP } from '../api/_shared/pdf-letterhead';

// Renders patient-facing record PDFs (report / OPD note / prescription) on the
// hospital letterhead. Discharge summaries use the existing
// api/ipd/discharge-pdf-generator instead.

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function header(doc: PDFKit.PDFDocument, title: string, lines: string[]): void {
  applyJmrhLetterhead(doc);
  doc.y = CONTENT_TOP;
  doc.fontSize(14).text(title, { align: 'center' });
  doc.moveDown(0.8);
  doc.fontSize(10);
  for (const l of lines) doc.text(l);
  doc.moveDown(0.6);
  doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.6);
}

function section(doc: PDFKit.PDFDocument, label: string, value?: string | null): void {
  if (!value || !String(value).trim()) return;
  doc.fontSize(10).text(`${label}:`, { continued: false });
  doc.fontSize(10).text(String(value).trim(), { indent: 12 });
  doc.moveDown(0.4);
}

export async function renderReportPdf(input: {
  patientName: string;
  prn: number;
  testName: string;
  department: string;
  reportedAt?: Date | null;
  result?: string | null;
  unit?: string | null;
  referenceRange?: string | null;
  findings?: string | null;
  impression?: string | null;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 60, left: 45, right: 45 } });
  header(doc, 'INVESTIGATION REPORT', [
    `Patient: ${input.patientName}    PRN: ${input.prn}`,
    `Test: ${input.testName}    Department: ${input.department}`,
    `Reported: ${input.reportedAt ? new Date(input.reportedAt).toLocaleString('en-GB') : '-'}`,
  ]);
  section(doc, 'Result', input.result);
  if (input.unit) section(doc, 'Unit', input.unit);
  if (input.referenceRange) section(doc, 'Reference range', input.referenceRange);
  section(doc, 'Findings', input.findings);
  section(doc, 'Impression', input.impression);
  drawJmrhFooter(doc, new Date());
  return toBuffer(doc);
}

export async function renderOpdNotePdf(input: {
  patientName: string;
  prn: number;
  doctorName: string;
  date: string;
  chiefComplaints?: string | null;
  diagnosis?: string | null;
  generalExamination?: string | null;
  clinicalNotes?: string | null;
  advice?: string | null;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 60, left: 45, right: 45 } });
  header(doc, 'CONSULTATION NOTES', [
    `Patient: ${input.patientName}    PRN: ${input.prn}`,
    `Doctor: ${input.doctorName}    Date: ${input.date}`,
  ]);
  section(doc, 'Chief complaints', input.chiefComplaints);
  section(doc, 'General examination', input.generalExamination);
  section(doc, 'Clinical notes', input.clinicalNotes);
  section(doc, 'Diagnosis', input.diagnosis);
  section(doc, 'Advice', input.advice);
  drawJmrhFooter(doc, new Date());
  return toBuffer(doc);
}

export async function renderPrescriptionPdf(input: {
  patientName: string;
  prn: number;
  prescribedBy: string;
  prescribedDate: string;
  prescriptionId: string;
  tablets: {
    genericName: string;
    brandName: string;
    frequency: string;
    duration: string;
    instructions: string;
    quantity: number;
    route?: string | null;
  }[];
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 60, left: 45, right: 45 } });
  header(doc, 'PRESCRIPTION', [
    `Patient: ${input.patientName}    PRN: ${input.prn}`,
    `Prescribed by: ${input.prescribedBy}    Date: ${input.prescribedDate}`,
    `Prescription ID: ${input.prescriptionId}`,
  ]);
  if (!input.tablets.length) {
    doc.fontSize(10).text('No medicines recorded.');
  } else {
    doc.fontSize(10);
    input.tablets.forEach((t, i) => {
      const meta = [t.frequency, t.duration, t.route ? `route: ${t.route}` : null, `qty: ${t.quantity}`]
        .filter(Boolean)
        .join(' · ');
      doc.text(`${i + 1}. ${t.brandName} (${t.genericName}) — ${meta}`);
      if (t.instructions) doc.text(`   ${t.instructions}`, { indent: 8 });
      doc.moveDown(0.2);
    });
  }
  doc.moveDown(1);
  doc.fontSize(9).text('Please take medicines exactly as advised. Contact the hospital if you notice any adverse reaction.');
  drawJmrhFooter(doc, new Date());
  return toBuffer(doc);
}
