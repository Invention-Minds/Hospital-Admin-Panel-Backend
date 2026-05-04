import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { join } from 'path';
import prisma from '../../service/prisma-client';

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

      // Generate PDF content
      generatePDFContent(doc, data);

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
    .text('Jeevan Mala Rajendra Hospital (JMRH)')
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

  // Clinical Information
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
    generatePDFContent(doc, data);
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
