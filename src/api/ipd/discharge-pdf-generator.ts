import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { join } from 'path';
import prisma from '../../service/prisma-client';
import { applyJmrhLetterhead, drawJmrhFooter } from '../_shared/pdf-letterhead';

/**
 * Discharge PDF Generator Service
 * Generates professional discharge summary PDFs from discharge data
 * Includes: patient details, diagnosis, procedures, prescriptions, advice, follow-up
 */

export interface DischargePDFData {
  admission: any;
  discharge: any;
  patient: any;
  progressNotes: any[];
  prescriptions: any[];
  investigationResults: any[];
}

/**
 * Generate discharge PDF and save to file system
 * Returns file path for download/email
 */
export const generateDischargePDF = async (
  admissionId: string,
  outputDir: string = './uploads/discharge-pdfs'
): Promise<string> => {
  try {
    // Fetch all required data
    const data = await gatheredischargePDFData(admissionId);

    // Create PDF document
    const fileName = `discharge-${data.admission.admissionNo}-${Date.now()}.pdf`;
    const filePath = join(outputDir, fileName);

    // Ensure directory exists
    const fs = require('fs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create PDF with streams
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        bufferPages: true,
        margin: 50,
      });

      const stream = createWriteStream(filePath);

      doc.on('end', () => {
        resolve(filePath);
      });

      stream.on('error', reject);
      doc.on('error', reject);

      doc.pipe(stream);

      // Branded letterhead — content starts below the header band (y=120).
      applyJmrhLetterhead(doc);

      // Generate PDF content
      generatePDFContent(doc, data);

      // Per-page branded footer (page X of N + timestamp).
      drawJmrhFooter(doc, new Date());

      // Finalize PDF
      doc.end();
    });
  } catch (error) {
    console.error('Error generating discharge PDF:', error);
    throw error;
  }
};

/**
 * Gather all data needed for discharge PDF
 */
async function gatheredischargePDFData(admissionId: string): Promise<DischargePDFData> {
  const admission = await prisma.ipdAdmission.findUnique({
    where: { id: admissionId },
    include: {
      bed: {
        include: {
          ward: true,
        },
      },
    },
  });

  const discharge = await prisma.ipdDischarge.findUnique({
    where: { admissionId },
  });

  const patient = await prisma.patientDetails.findFirst({
    where: { prn: parseInt(admission!.prn) },
  });

  const progressNotes = await prisma.ipdProgressNote.findMany({
    where: { admissionId },
    orderBy: { date: 'desc' },
  });

  const prescriptions = await prisma.ipdPrescription.findMany({
    where: {
      admissionId,
    },
  });

  const investigationResults = await prisma.investigationResult.findMany({
    where: { prn: admission!.prn },
    orderBy: { reportedAt: 'desc' },
    take: 20, // Last 20 results
  });

  return {
    admission: admission!,
    discharge: discharge!,
    patient: patient!,
    progressNotes,
    prescriptions,
    investigationResults,
  };
}

/**
 * Generate PDF document content
 */
function generatePDFContent(doc: InstanceType<typeof PDFDocument>, data: DischargePDFData): void {
  // Header with hospital info
  doc
    .fontSize(16)
    .font('Helvetica-Bold')
    .text('DISCHARGE SUMMARY', { align: 'center' });

  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#999999')
    .text(
      'Confidential - For authorized hospital personnel only',
      { align: 'center' }
    )
    .fillColor('black');

  addHorizontalLine(doc, 30);

  // Hospital and Document Info
  doc.fontSize(10).font('Helvetica-Bold').text('Hospital Information:');
  doc
    .fontSize(9)
    .font('Helvetica')
    .text('Jayadev Memorial Rashtrotthana Hospital & Research Centre')
    .text(`Admission No: ${data.admission.admissionNo}`)
    .text(`PRN/UHID: ${data.admission.prn}`)
    .text(`Admission Date: ${formatDate(data.admission.admissionDate)}`)
    .text(`Discharge Date: ${formatDate(data.discharge.dischargeDate)}`);

  doc.moveDown(0.5);

  // Patient Demographics
  doc.fontSize(10).font('Helvetica-Bold').text('Patient Information:');
  doc
    .fontSize(9)
    .font('Helvetica')
    .text(`Name: ${data.patient.name}`)
    .text(`Age: ${calculateAge(data.patient.dob)} years`)
    .text(`Gender: ${data.patient.gender || 'Not specified'}`)
    .text(`Phone: ${data.patient.phoneNumber || 'Not available'}`)
    .text(`Blood Group: ${data.patient.bloodGroup || 'Not recorded'}`);

  doc.moveDown(0.5);
  addHorizontalLine(doc, 30);

  // Admission Details
  doc.fontSize(10).font('Helvetica-Bold').text('Admission Details:');
  doc
    .fontSize(9)
    .font('Helvetica')
    .text(`Ward: ${data.admission.bed.ward.wardName}`)
    .text(`Bed: ${data.admission.bed.bedNumber}`)
    .text(`Department: ${data.admission.department}`)
    .text(`Admitting Doctor: ${data.admission.admittingDoctor}`)
    .text(`Admission Type: ${data.admission.admissionType}`);

  if (data.admission.referringDoctor) {
    doc.text(`Referring Doctor: ${data.admission.referringDoctor}`);
  }

  doc.moveDown(0.5);
  addHorizontalLine(doc, 30);

  // Clinical Information — use the templated snapshot when one exists, otherwise
  // fall back to the legacy free-text columns. The snapshot shape is
  //   { _schema: FieldDef[], _values: { [key]: any } }
  // taken at sign-time so future template edits never affect this PDF.
  const snapshot = parseTemplateSnapshot(data.discharge.templatedValues);
  if (snapshot && snapshot.schema.length > 0) {
    renderTemplatedFields(doc, snapshot);
  } else {
    doc.fontSize(10).font('Helvetica-Bold').text('Clinical Summary:');
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`Diagnosis: ${data.discharge.finalDiagnosis}`)
      .text(`Condition at Discharge: ${data.discharge.conditionAtDischarge}`);

    if (data.discharge.proceduresDone) {
      doc.text(`Procedures Done: ${data.discharge.proceduresDone}`);
    }

    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Hospital Course:')
      .font('Helvetica')
      .text(data.discharge.dischargeSummary, { align: 'left' });
  }

  doc.moveDown(0.5);
  addHorizontalLine(doc, 30);

  // Investigation Results (last few)
  if (data.investigationResults.length > 0) {
    doc.fontSize(10).font('Helvetica-Bold').text('Recent Investigation Results:');
    doc.fontSize(9).font('Helvetica');

    for (const result of data.investigationResults.slice(0, 5)) {
      doc
        .text(`${result.testName}: ${result.result} ${result.unit || ''}`, {
          indent: 20,
        })
        .font('Helvetica-Bold');

      if (result.referenceRange) {
        doc
          .fontSize(8)
          .font('Helvetica')
          .text(`(Ref: ${result.referenceRange})`, { indent: 40 });
      }

      if (result.criticalFlag) {
        doc
          .fontSize(8)
          .font('Helvetica')
          .fillColor('red')
          .text('⚠️ CRITICAL', { indent: 40 });
        doc.fillColor('black');
      }

      doc.fontSize(9);
    }
  }

  doc.moveDown(0.5);
  addHorizontalLine(doc, 30);

  // Discharge Medications
  if (data.prescriptions.length > 0) {
    doc.fontSize(10).font('Helvetica-Bold').text('Discharge Medications:');
    doc.fontSize(9).font('Helvetica');

    for (const rx of data.prescriptions) {
      const medName = `${rx.brandName || rx.genericName} ${rx.dose}`;
      doc
        .text(`${medName}`, { indent: 20 })
        .font('Helvetica-Bold');

      doc
        .fontSize(8)
        .font('Helvetica')
        .text(
          `${rx.frequency} for ${rx.duration} | Route: ${rx.route} | Qty: ${rx.quantity}`,
          { indent: 40 }
        );

      if (rx.instructions) {
        doc.fontSize(8).text(`Instructions: ${rx.instructions}`, { indent: 40 });
      }

      doc.fontSize(9);
    }
  }

  doc.moveDown(0.5);
  addHorizontalLine(doc, 30);

  // Discharge Instructions
  doc.fontSize(10).font('Helvetica-Bold').text('Discharge Instructions:');
  doc
    .fontSize(9)
    .font('Helvetica')
    .text(data.discharge.advice || 'Rest, light diet, avoid heavy work. Take medications as prescribed.');

  doc.moveDown(0.3);

  // Follow-up
  doc.fontSize(10).font('Helvetica-Bold').text('Follow-up Plan:');
  doc.fontSize(9).font('Helvetica');

  if (data.discharge.followUpDate) {
    doc.text(`Follow-up Date: ${formatDate(data.discharge.followUpDate)}`);
  }

  if (data.discharge.followUpDoctor) {
    doc.text(`Follow-up Doctor: ${data.discharge.followUpDoctor}`);
  }

  doc.moveDown(0.5);
  addHorizontalLine(doc, 30);

  // Footer with signature lines
  doc.moveDown(1);
  doc.fontSize(9).font('Helvetica');

  // Left: Doctor signature
  doc.text('Discharging Doctor:', 50);
  doc.moveTo(50, doc.y + 40).lineTo(200, doc.y + 40).stroke();
  doc.fontSize(8).text('Signature & Stamp', 50, doc.y + 5);
  doc.fontSize(8).text(`Date: ${formatDate(new Date())}`, 50, doc.y + 15);

  // Right: Authorized Officer signature
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('Authorized Officer:', 320);
  doc.moveTo(320, doc.y - 45).lineTo(470, doc.y - 45).stroke();
  doc.fontSize(8).text('Signature & Stamp', 320, doc.y + 5);
  doc.fontSize(8).text(`Date: ${formatDate(new Date())}`, 320, doc.y + 15);

  doc.moveDown(2);

  // Disclaimer
  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#999999')
    .text(
      'This is a computer-generated document and is valid without a signature. ' +
        'This discharge summary is confidential and intended for authorized hospital personnel only.',
      {
        align: 'center',
        width: 500,
      }
    );

  doc
    .fontSize(7)
    .text(`Generated on: ${new Date().toISOString()}`, { align: 'center' });
}

/**
 * Helper functions
 */
function formatDate(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function calculateAge(dob: Date | string | null | undefined): number {
  if (!dob) return 0;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function addHorizontalLine(doc: InstanceType<typeof PDFDocument>, margin: number): void {
  doc.moveTo(margin, doc.y).lineTo(550 - margin, doc.y).stroke();
  doc.moveDown(0.3);
}

/**
 * Generate discharge PDF and immediately return as download
 * For API endpoint to stream PDF to client
 */
export const generateAndStreamDischargePDF = async (
  admissionId: string,
  res: any
): Promise<void> => {
  try {
    // Fetch data
    const data = await gatheredischargePDFData(admissionId);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="discharge-${data.admission.admissionNo}.pdf"`
    );

    // Create PDF and pipe to response
    const doc = new PDFDocument({
      bufferPages: true,
      margin: 50,
    });

    doc.pipe(res);
    applyJmrhLetterhead(doc);
    generatePDFContent(doc, data);
    drawJmrhFooter(doc, new Date());
    doc.end();

    console.log(`✅ Discharge PDF generated for admission ${admissionId}`);
  } catch (error) {
    console.error('Error generating discharge PDF:', error);
    res.status(500).json({
      message: 'Error generating discharge PDF',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// ============================================================================
// Templated rendering — walks the snapshot stored in IpdDischarge.templatedValues
// (`{ _schema: [...field defs], _values: {key:val} }`). Groups by `group` if
// present, otherwise renders all fields in declared order.
// ============================================================================

interface TemplateFieldDef {
  key: string;
  label: string;
  type: string;
  options?: string[];
  group?: string;
  order?: number;
}

interface TemplateSnapshot {
  schema: TemplateFieldDef[];
  values: Record<string, unknown>;
}

function parseTemplateSnapshot(raw: unknown): TemplateSnapshot | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const schemaRaw = (parsed as { _schema?: unknown })._schema;
    const valuesRaw = (parsed as { _values?: unknown })._values;
    if (!Array.isArray(schemaRaw)) return null;
    return {
      schema: schemaRaw as TemplateFieldDef[],
      values: (valuesRaw && typeof valuesRaw === 'object'
        ? (valuesRaw as Record<string, unknown>)
        : {}),
    };
  } catch {
    return null;
  }
}

function formatFieldValue(field: TemplateFieldDef, raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  switch (field.type) {
    case 'multiselect':
      return Array.isArray(raw) ? (raw as string[]).join(', ') : String(raw);
    case 'checkbox':
      return raw ? 'Yes' : 'No';
    case 'date':
      try { return new Date(String(raw)).toLocaleDateString(); }
      catch { return String(raw); }
    case 'datetime':
      try { return new Date(String(raw)).toLocaleString(); }
      catch { return String(raw); }
    case 'handwritten':
      // raw is expected to be a base64 data URL of the canvas. PDF rendering
      // of inline images is intentionally deferred — print the placeholder
      // for now so layout stays predictable. (Embed via doc.image in a later
      // patch once we standardise the data-URL format.)
      return typeof raw === 'string' && raw.startsWith('data:image')
        ? '[Hand-written note attached]'
        : String(raw);
    default:
      return String(raw);
  }
}

function renderTemplatedFields(
  doc: InstanceType<typeof PDFDocument>,
  snap: TemplateSnapshot,
): void {
  // Sort by (group ?? '') then `order ?? 0` then declaration order.
  const indexed = snap.schema.map((f, idx) => ({ ...f, _idx: idx }));
  indexed.sort((a, b) => {
    const ga = a.group ?? '';
    const gb = b.group ?? '';
    if (ga !== gb) return ga.localeCompare(gb);
    const oa = a.order ?? 0;
    const ob = b.order ?? 0;
    if (oa !== ob) return oa - ob;
    return a._idx - b._idx;
  });

  // Bucket by group while preserving sorted order.
  const byGroup = new Map<string, TemplateFieldDef[]>();
  for (const f of indexed) {
    const g = f.group ?? '';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(f);
  }

  for (const [group, fields] of byGroup) {
    if (group) {
      doc.fontSize(10).font('Helvetica-Bold').text(group);
      doc.moveDown(0.2);
    }
    for (const f of fields) {
      const value = formatFieldValue(f, snap.values[f.key]);
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .text(`${f.label}: `, { continued: true })
        .font('Helvetica')
        .text(value);
    }
    doc.moveDown(0.4);
  }
}
