/**
 * Generates two sample report PDFs for demo purposes — one lab, one
 * radiology — so the Lab/Radiology report module shows realistic content
 * before the third-party LIS/RIS feed is wired up.
 *
 * Run with:
 *   npx ts-node scripts/generate-demo-reports.ts
 *   # or:
 *   npm run gen:demo-reports
 *
 * Output goes into the frontend's public/ folder so Angular serves the
 * files at the app origin (no CORS, no extra static route):
 *   Frontend/Hospital-Admin-Panel/public/demo-reports/lab-cbc-sample.pdf
 *   Frontend/Hospital-Admin-Panel/public/demo-reports/radiology-cxr-sample.pdf
 *
 * The dashboard demo seed (prisma/seed-dashboard-demo.ts) points each
 * InvestigationResult.reportUrl at one of these files.
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const OUT_DIR = path.resolve(
  __dirname,
  '../../../Frontend/Hospital-Admin-Panel/public/demo-reports',
);

const NAVY = '#001345';
const INK = '#1f2937';
const MUTED = '#6b7280';
const RULE = '#d1d5db';

function header(doc: PDFKit.PDFDocument, deptLine: string, title: string): void {
  doc.fillColor(NAVY).fontSize(17).font('Helvetica-Bold')
    .text('RASHTROTTHANA HOSPITAL', { align: 'center' });
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
    .text('Rajarajeshwari Nagar, Bengaluru — 560098  ·  www.rashtrotthanahospital.com', { align: 'center' });
  doc.moveDown(0.3);
  doc.fillColor(INK).fontSize(10).font('Helvetica-Bold')
    .text(deptLine, { align: 'center' });
  doc.moveDown(0.5);
  const y = doc.y;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(RULE).stroke();
  doc.moveDown(0.6);
  doc.fillColor(NAVY).fontSize(13).font('Helvetica-Bold')
    .text(title, { align: 'center' });
  doc.moveDown(0.6);
}

function patientBlock(doc: PDFKit.PDFDocument, rows: Array<[string, string, string, string]>): void {
  doc.fontSize(9.5).font('Helvetica');
  for (const [l1, v1, l2, v2] of rows) {
    const y = doc.y;
    doc.fillColor(MUTED).text(l1, 50, y, { width: 90 });
    doc.fillColor(INK).font('Helvetica-Bold').text(v1, 140, y, { width: 170 });
    doc.font('Helvetica').fillColor(MUTED).text(l2, 320, y, { width: 95 });
    doc.fillColor(INK).font('Helvetica-Bold').text(v2, 415, y, { width: 130 });
    doc.font('Helvetica');
    doc.moveDown(0.4);
  }
  doc.moveDown(0.3);
  const y = doc.y;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(RULE).stroke();
  doc.moveDown(0.6);
}

function footer(doc: PDFKit.PDFDocument, signerLabel: string, signerName: string): void {
  doc.moveDown(2);
  const y = doc.y;
  doc.moveTo(360, y + 26).lineTo(540, y + 26).strokeColor(RULE).stroke();
  doc.fillColor(INK).fontSize(9.5).font('Helvetica-Bold')
    .text(signerName, 360, y + 30, { width: 180, align: 'center' });
  doc.fillColor(MUTED).fontSize(8).font('Helvetica')
    .text(signerLabel, 360, y + 43, { width: 180, align: 'center' });
  doc.fillColor(MUTED).fontSize(7.5).font('Helvetica-Oblique')
    .text(
      'Digitally generated demo report — DocMinds EMR. Not for clinical use.',
      50, y + 70, { width: 495, align: 'center' },
    );
}

// ─── Lab report ─────────────────────────────────────────────────────────
function buildLabReport(outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    stream.on('finish', () => resolve());
    stream.on('error', reject);

    header(doc, 'Department of Laboratory Medicine & Clinical Pathology', 'LABORATORY INVESTIGATION REPORT');
    patientBlock(doc, [
      ['Patient', 'Suresh Kumar', 'Report No.', 'LAB-2026-004821'],
      ['PRN', '900042', 'Sample Date', '16-May-2026  08:10'],
      ['Age / Sex', '54 Y / Male', 'Report Date', '16-May-2026  11:45'],
      ['Ref. Doctor', 'Dr. Sunita Kapoor', 'Specimen', 'Whole blood (EDTA)'],
    ]);

    doc.fillColor(NAVY).fontSize(10.5).font('Helvetica-Bold')
      .text('COMPLETE BLOOD COUNT (CBC)');
    doc.moveDown(0.4);

    // Table header
    const cols = [50, 230, 320, 400];
    const headerY = doc.y;
    doc.fontSize(8.5).fillColor(MUTED).font('Helvetica-Bold');
    doc.text('INVESTIGATION', cols[0], headerY);
    doc.text('RESULT', cols[1], headerY);
    doc.text('UNIT', cols[2], headerY);
    doc.text('REFERENCE RANGE', cols[3], headerY);
    doc.moveDown(0.3);
    let yy = doc.y;
    doc.moveTo(50, yy).lineTo(545, yy).strokeColor(RULE).stroke();
    doc.moveDown(0.4);

    const rows: Array<[string, string, string, string, '' | 'L' | 'H']> = [
      ['Haemoglobin', '9.1', 'g/dL', '13.0 – 17.0', 'L'],
      ['Total Leucocyte Count', '13,400', '/µL', '4,000 – 11,000', 'H'],
      ['Platelet Count', '1.42', 'lakh/µL', '1.5 – 4.1', 'L'],
      ['RBC Count', '4.21', 'million/µL', '4.5 – 5.5', 'L'],
      ['Haematocrit (PCV)', '34.0', '%', '40 – 50', 'L'],
      ['MCV', '80.8', 'fL', '83 – 101', 'L'],
      ['Neutrophils', '78', '%', '40 – 75', 'H'],
      ['Lymphocytes', '15', '%', '20 – 45', 'L'],
      ['ESR', '46', 'mm/hr', '0 – 15', 'H'],
    ];
    doc.fontSize(9).font('Helvetica');
    for (const [name, result, unit, range, flag] of rows) {
      const ry = doc.y;
      doc.fillColor(INK).font('Helvetica').text(name, cols[0], ry, { width: 175 });
      const flagged = flag === 'L' || flag === 'H';
      doc.fillColor(flagged ? '#b91c1c' : INK).font(flagged ? 'Helvetica-Bold' : 'Helvetica')
        .text(`${result}${flag ? `  (${flag})` : ''}`, cols[1], ry, { width: 85 });
      doc.fillColor(MUTED).font('Helvetica').text(unit, cols[2], ry, { width: 75 });
      doc.fillColor(MUTED).text(range, cols[3], ry, { width: 145 });
      doc.moveDown(0.45);
    }
    doc.moveDown(0.3);
    yy = doc.y;
    doc.moveTo(50, yy).lineTo(545, yy).strokeColor(RULE).stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor(MUTED).font('Helvetica-Oblique')
      .text('(L) below reference range   ·   (H) above reference range   ·   Critical values telephoned to the ward.');
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor(INK).font('Helvetica-Bold').text('Interpretation: ');
    doc.font('Helvetica').fillColor(INK)
      .text('Microcytic anaemia with neutrophilic leucocytosis and raised ESR — picture consistent with an acute bacterial infection on a background of iron-deficiency anaemia. Suggest correlation with CRP / cultures.', { width: 495 });

    footer(doc, 'Consultant Pathologist  ·  MD (Pathology)', 'Dr. Meena Krishnan');
    doc.end();
  });
}

// ─── Radiology report ───────────────────────────────────────────────────
function buildRadiologyReport(outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    stream.on('finish', () => resolve());
    stream.on('error', reject);

    header(doc, 'Department of Radiology & Imaging Sciences', 'RADIOLOGY REPORT');
    patientBlock(doc, [
      ['Patient', 'Asha Pillai', 'Report No.', 'RAD-2026-001934'],
      ['PRN', '900017', 'Study Date', '16-May-2026  09:25'],
      ['Age / Sex', '47 Y / Female', 'Report Date', '16-May-2026  10:40'],
      ['Ref. Doctor', 'Dr. Vikram Singh', 'Modality', 'Digital Radiography'],
    ]);

    doc.fillColor(NAVY).fontSize(10.5).font('Helvetica-Bold')
      .text('EXAMINATION:  X-RAY CHEST — PA VIEW');
    doc.moveDown(0.6);

    doc.fillColor(MUTED).fontSize(9).font('Helvetica-Bold').text('CLINICAL HISTORY');
    doc.fillColor(INK).font('Helvetica').fontSize(9.5)
      .text('Fever with productive cough and right-sided chest discomfort for 4 days.', { width: 495 });
    doc.moveDown(0.7);

    doc.fillColor(MUTED).fontSize(9).font('Helvetica-Bold').text('FINDINGS');
    doc.fillColor(INK).font('Helvetica').fontSize(9.5);
    const findings = [
      'Patchy heterogeneous air-space opacity is noted in the right lower zone with associated air bronchograms.',
      'The remainder of both lung fields are clear. No cavitation or mass lesion.',
      'Both hila are normal in size and density. Mediastinum is central.',
      'Cardiac silhouette is within normal limits (CT ratio < 0.5).',
      'Both costophrenic and cardiophrenic angles are clear — no pleural effusion or pneumothorax.',
      'Visualised bony thorax and soft tissues are unremarkable.',
    ];
    for (const f of findings) {
      doc.text(`•  ${f}`, { width: 495, indent: 0 });
      doc.moveDown(0.25);
    }
    doc.moveDown(0.5);

    doc.fillColor(MUTED).fontSize(9).font('Helvetica-Bold').text('IMPRESSION');
    doc.fillColor('#b45309').font('Helvetica-Bold').fontSize(10)
      .text('Right lower-zone consolidation — radiological picture consistent with pneumonia.', { width: 495 });
    doc.fillColor(INK).font('Helvetica').fontSize(9)
      .text('Clinical correlation and a follow-up radiograph after treatment are advised.', { width: 495 });

    footer(doc, 'Consultant Radiologist  ·  MD (Radiodiagnosis)', 'Dr. Arjun Nair');
    doc.end();
  });
}

async function main(): Promise<void> {
  console.log('\n📄 Generating demo report PDFs…\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const labPath = path.join(OUT_DIR, 'lab-cbc-sample.pdf');
  const radPath = path.join(OUT_DIR, 'radiology-cxr-sample.pdf');

  await buildLabReport(labPath);
  console.log(`  ✓ ${labPath}`);
  await buildRadiologyReport(radPath);
  console.log(`  ✓ ${radPath}`);

  console.log('\n✅ Done. Served by Angular at:');
  console.log('   /demo-reports/lab-cbc-sample.pdf');
  console.log('   /demo-reports/radiology-cxr-sample.pdf\n');
}

main().catch((e) => {
  console.error('Failed to generate demo reports:', e);
  process.exit(1);
});
