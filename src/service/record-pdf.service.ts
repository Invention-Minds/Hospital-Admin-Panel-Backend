import fs from 'fs';
import path from 'path';
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

/** One field of a note template, as frozen in DoctorNote.templatedValues._schema. */
export type TemplateFieldDef = {
  key: string;
  label: string;
  type: string;
  group?: string;
  order?: number;
  rows?: string[];
  columns?: string[];
};

/** Same order as the web renderer (order ?? declaration index; a group sits where its first field is). */
function groupFields(fields: TemplateFieldDef[]): { group: string; fields: TemplateFieldDef[] }[] {
  const indexed = fields.map((f, idx) => ({ f, idx }));
  indexed.sort((a, b) => (a.f.order ?? a.idx) - (b.f.order ?? b.idx) || a.idx - b.idx);
  const m = new Map<string, TemplateFieldDef[]>();
  for (const { f } of indexed) m.set(f.group ?? '', [...(m.get(f.group ?? '') ?? []), f]);
  return [...m.entries()].map(([group, fs]) => ({ group, fields: fs }));
}

function formatValue(type: string, v: unknown): string {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (type === 'checkbox' || typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

function templateBlock(doc: PDFKit.PDFDocument, fields: TemplateFieldDef[], values: Record<string, unknown>): void {
  for (const { group, fields: fs } of groupFields(fields)) {
    if (group) {
      doc.moveDown(0.2);
      doc.fontSize(11).text(group);
      doc.moveDown(0.2);
    }
    for (const f of fs) {
      const raw = values[f.key];
      if (f.type === 'table') {
        const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown>>;
        const filled = (f.rows ?? []).some((r) => (f.columns ?? []).some((c) => data[r]?.[c] != null && data[r]?.[c] !== ''));
        if (!filled) continue;
        doc.fontSize(10).text(`${f.label}:`);
        for (const r of f.rows ?? []) {
          const cells = (f.columns ?? []).map((c) => `${c}: ${data[r]?.[c] == null || data[r]?.[c] === '' ? '—' : String(data[r][c])}`);
          doc.fontSize(10).text(`${r} — ${cells.join('   ')}`, { indent: 12 });
        }
        doc.moveDown(0.4);
      } else if (f.type === 'handwritten' && typeof raw === 'string' && raw.startsWith('data:image')) {
        doc.fontSize(10).text(`${f.label}:`);
        try {
          doc.image(Buffer.from(raw.split(',')[1] ?? '', 'base64'), { fit: [380, 200] });
        } catch {
          doc.text('(drawing could not be printed)', { indent: 12 });
        }
        doc.moveDown(0.4);
      } else {
        section(doc, f.label, formatValue(f.type, raw));
      }
    }
  }
}

// ── Consultation summary (patient-facing) ────────────────────────────────
// Same look as the estimation PDF: the current JMRH letterhead (logo header,
// address footer) as the page background, Poppins, hospital teal headings.

const ASSETS = (() => {
  // Deployed: dist/service → dist/assets (copy-assets). ts-node: src/service → <root>/assets.
  const candidates = [
    path.join(__dirname, '../assets'),
    path.join(__dirname, '../../assets'),
    path.join(process.cwd(), 'dist/assets'),
    path.join(process.cwd(), 'assets'),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, 'JMRH Letterhead.jpg'))) ?? candidates[0];
})();

const TEAL = '#0098A3';
const TEAL_SOFT = '#E6F5F6';
const INK = '#1C2B33';
const MUTED = '#5E6E76';
const RULE = '#CFE3E5';
/** Letterhead bands at A4 points: logo header ends ~86, address footer starts ~797. */
const PAGE_TOP = 100;
const PAGE_BOTTOM = 760;
const X0 = 40;
const X1 = 555;
const W = X1 - X0;

type Medicine = { name: string; frequency: string; duration: string; instructions?: string | null };

/**
 * The patient's consultation summary (sent on WhatsApp as the visit summary).
 * Prints whatever the visit has: standard sections or the template's answers,
 * systemic examination, vitals, investigations ordered and medicines
 * prescribed that day. Every extra is optional, so older callers still work.
 */
export async function renderOpdNotePdf(input: {
  patientName: string;
  prn: number;
  doctorName: string;
  date: string;
  age?: string | null;
  gender?: string | null;
  department?: string | null;
  chiefComplaints?: string | null;
  diagnosis?: string | null;
  generalExamination?: string | null;
  clinicalNotes?: string | null;
  advice?: string | null;
  cvs?: string | null;
  rs?: string | null;
  cns?: string | null;
  pa?: string | null;
  vitals?: string | null;
  template?: { fields: TemplateFieldDef[]; values: Record<string, unknown> } | null;
  investigations?: string[];
  medicines?: Medicine[];
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: PAGE_TOP, bottom: 842 - PAGE_BOTTOM, left: X0, right: 595 - X1 } });
  const letterhead = path.join(ASSETS, 'JMRH Letterhead.jpg');
  const hasLetterhead = fs.existsSync(letterhead);
  const font = (f: string) => path.join(ASSETS, f);
  const hasPoppins = fs.existsSync(font('Poppins-Regular.ttf'));
  if (hasPoppins) {
    doc.registerFont('R', font('Poppins-Regular.ttf'));
    doc.registerFont('M', font('Poppins-Medium.ttf'));
    doc.registerFont('B', font('Poppins-SemiBold.ttf'));
  } else {
    doc.registerFont('R', 'Helvetica');
    doc.registerFont('M', 'Helvetica');
    doc.registerFont('B', 'Helvetica-Bold');
  }
  const visitDate = fmtVisitDate(input.date);
  let page = 1;
  const paint = () => {
    if (hasLetterhead) doc.image(letterhead, 0, 0, { width: 595, height: 842 });
    else doc.font('B').fontSize(14).fillColor(TEAL).text(HOSPITAL_NAME_TEXT, X0, 40, { width: W, align: 'center' });
    doc.y = PAGE_TOP;
  };
  doc.on('pageAdded', () => {
    page += 1;
    paint();
    // Slim running header so a loose page 2 is still identifiable.
    doc.font('M').fontSize(8.5).fillColor(MUTED)
      .text(`Consultation summary · ${input.patientName} · PRN ${input.prn} · ${visitDate} · page ${page}`, X0, PAGE_TOP - 6, { width: W, lineBreak: false });
    doc.y = PAGE_TOP + 14;
  });
  paint();
  const room = (h: number) => {
    if (doc.y + h > PAGE_BOTTOM) doc.addPage();
  };

  // Title row
  doc.font('B').fontSize(17).fillColor(TEAL).text('CONSULTATION SUMMARY', X0, PAGE_TOP, { lineBreak: false });
  doc.font('R').fontSize(9.5).fillColor(MUTED).text(`Visit date: ${visitDate}`, X0, PAGE_TOP + 6, { width: W, align: 'right' });
  doc.y = PAGE_TOP + 30;

  // Patient / doctor card
  const cardY = doc.y;
  const cells: [string, string][] = [
    ['Patient', input.patientName],
    ['PRN', String(input.prn)],
    ['Age / Sex', [input.age, input.gender].filter((v) => v && String(v).trim()).join(' / ') || '—'],
    ['Consultant', input.doctorName],
    ['Department', input.department?.trim() || '—'],
    ['Visit', 'Out-patient (OPD)'],
  ];
  const colW = W / 3;
  const cardH = 72;
  doc.roundedRect(X0, cardY, W, cardH, 8).fill(TEAL_SOFT);
  cells.forEach(([k, v], i) => {
    const cx = X0 + 14 + (i % 3) * colW;
    const cy = cardY + 11 + Math.floor(i / 3) * 31;
    doc.font('R').fontSize(7.5).fillColor(MUTED).text(k.toUpperCase(), cx, cy, { width: colW - 20, lineBreak: false, characterSpacing: 0.4 });
    doc.font('B').fontSize(10.5).fillColor(INK).text(v, cx, cy + 10, { width: colW - 20, height: 15, ellipsis: true, lineBreak: false });
  });
  doc.y = cardY + cardH + 14;

  // Vitals as chips
  if (input.vitals?.trim()) {
    heading('Vitals');
    const chips = input.vitals.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    let x = X0;
    let y = doc.y;
    doc.font('M').fontSize(9.5);
    for (const c of chips) {
      const w = doc.widthOfString(c) + 20;
      if (x + w > X1) { x = X0; y += 24; }
      doc.roundedRect(x, y, w, 19, 9.5).lineWidth(0.8).strokeColor(RULE).fillAndStroke('#FFFFFF', RULE);
      doc.fillColor(INK).text(c, x + 10, y + 4.5, { lineBreak: false });
      x += w + 6;
    }
    doc.y = y + 30;
  }

  // Clinical notes
  if (input.template && input.template.fields.length) {
    for (const { group, fields } of groupFields(input.template.fields)) {
      const filled = fields.filter((f) => hasValue(f, input.template!.values[f.key]));
      if (!filled.length) continue;
      if (group) heading(group);
      for (const f of filled) templateField(f, input.template.values[f.key]);
    }
  } else {
    if (input.diagnosis?.trim()) diagnosisBox(input.diagnosis);
    block('Chief complaints', input.chiefComplaints);
    block('General examination', input.generalExamination);
    const sys = ([['CVS', input.cvs], ['RS', input.rs], ['CNS', input.cns], ['P/A', input.pa]] as const).filter(([, v]) => v && v.trim());
    if (sys.length) {
      heading('Systemic examination');
      for (const [k, v] of sys) labelled(k, v!);
      doc.moveDown(0.3);
    }
    block('Clinical notes', input.clinicalNotes);
  }

  // Investigations (two columns)
  const tests = [...new Set((input.investigations ?? []).map((t) => t.trim()).filter(Boolean))];
  if (tests.length) {
    heading('Investigations advised');
    const half = Math.ceil(tests.length / 2);
    const startY = doc.y;
    doc.font('R').fontSize(10).fillColor(INK);
    let maxY = startY;
    [tests.slice(0, half), tests.slice(half)].forEach((col, ci) => {
      doc.y = startY;
      for (const t of col) {
        room(16);
        const y = doc.y;
        doc.circle(X0 + ci * (W / 2) + 4, y + 6.5, 2).fill(TEAL);
        doc.fillColor(INK).text(t, X0 + ci * (W / 2) + 12, y, { width: W / 2 - 20 });
        maxY = Math.max(maxY, doc.y);
      }
    });
    doc.x = X0;
    doc.y = maxY + 8;
  }

  // Medicines table
  const meds = dedupeMeds(input.medicines ?? []);
  if (meds.length) {
    heading('Medicines prescribed');
    const cols = [
      { t: '#', w: 22 },
      { t: 'Medicine', w: 178 },
      { t: 'Dose (M-A-N)', w: 85 },
      { t: 'Duration', w: 75 },
      { t: 'Instructions', w: W - 22 - 178 - 85 - 75 },
    ];
    const headRow = () => {
      room(22);
      const y = doc.y;
      doc.rect(X0, y, W, 20).fill(TEAL);
      let x = X0;
      for (const c of cols) {
        doc.font('B').fontSize(8.5).fillColor('#FFFFFF').text(c.t, x + 6, y + 6, { width: c.w - 10, lineBreak: false });
        x += c.w;
      }
      doc.y = y + 20;
    };
    headRow();
    meds.forEach((m, i) => {
      const vals = [String(i + 1), m.name, m.frequency, m.duration, m.instructions?.trim() || '—'];
      doc.font('R').fontSize(9.5);
      const h = Math.max(22, ...vals.map((v, k) => doc.heightOfString(v, { width: cols[k].w - 12 }) + 12));
      if (doc.y + h > PAGE_BOTTOM) { doc.addPage(); headRow(); }
      const y = doc.y;
      if (i % 2 === 1) doc.rect(X0, y, W, h).fill('#F6FAFA');
      let x = X0;
      vals.forEach((v, k) => {
        doc.font(k === 1 ? 'M' : 'R').fontSize(9.5).fillColor(INK).text(v, x + 6, y + 6, { width: cols[k].w - 12 });
        x += cols[k].w;
      });
      doc.moveTo(X0, y + h).lineTo(X1, y + h).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.y = y + h;
    });
    doc.x = X0;
    doc.y += 6;
    doc.font('R').fontSize(8).fillColor(MUTED).text('Dose: Morning – Afternoon – Night (e.g. 1-0-1 = one in the morning and one at night).', X0, doc.y, { width: W });
    doc.moveDown(0.8);
  }

  if (!input.template) block('Advice', input.advice);

  // Closing note + signature line
  room(70);
  doc.moveDown(0.6);
  const sy = doc.y;
  doc.font('R').fontSize(8.5).fillColor(MUTED)
    .text('This is a summary of your out-patient consultation for your reference. Take medicines only as prescribed. In an emergency, come to the hospital or call the number below.', X0, sy, { width: W * 0.58 });
  doc.font('B').fontSize(10).fillColor(INK).text(input.doctorName, X0 + W * 0.64, sy + 4, { width: W * 0.36, align: 'right' });
  doc.font('R').fontSize(8.5).fillColor(MUTED).text(`Consultant${input.department ? ` · ${input.department}` : ''}`, X0 + W * 0.64, doc.y, { width: W * 0.36, align: 'right' });

  return toBuffer(doc);

  // ── helpers (hoisted) ──
  function heading(t: string) {
    room(40);
    doc.moveDown(0.2);
    const y = doc.y;
    doc.rect(X0, y + 1, 3, 12).fill(TEAL);
    doc.font('B').fontSize(10.5).fillColor(TEAL).text(t.toUpperCase(), X0 + 10, y, { characterSpacing: 0.5, width: W - 10 });
    doc.moveTo(X0, doc.y + 2).lineTo(X1, doc.y + 2).lineWidth(0.6).strokeColor(RULE).stroke();
    doc.x = X0;
    doc.y += 8;
  }
  function body(v: string) {
    doc.font('R').fontSize(10).fillColor(INK);
    room(Math.min(doc.heightOfString(v, { width: W }), 60) + 4);
    doc.text(v, X0, doc.y, { width: W, lineGap: 1.5 });
    doc.moveDown(0.6);
  }
  function block(label: string, v?: string | null) {
    if (!v || !v.trim()) return;
    heading(label);
    body(v.trim());
  }
  function labelled(k: string, v: string) {
    doc.font('R').fontSize(10);
    room(Math.min(doc.heightOfString(v, { width: W - 60 }), 50) + 4);
    const y = doc.y;
    doc.font('B').fontSize(9.5).fillColor(MUTED).text(k, X0, y, { width: 50 });
    doc.font('R').fontSize(10).fillColor(INK).text(v.trim(), X0 + 56, y, { width: W - 56 });
    doc.x = X0;
    doc.moveDown(0.25);
  }
  function diagnosisBox(v: string) {
    doc.font('M').fontSize(11);
    const h = doc.heightOfString(v.trim(), { width: W - 28 }) + 30;
    room(h + 8);
    const y = doc.y;
    doc.roundedRect(X0, y, W, h, 6).lineWidth(1).fillAndStroke('#FFFFFF', TEAL);
    doc.font('B').fontSize(7.5).fillColor(TEAL).text('DIAGNOSIS', X0 + 14, y + 8, { characterSpacing: 0.5 });
    doc.font('M').fontSize(11).fillColor(INK).text(v.trim(), X0 + 14, y + 19, { width: W - 28 });
    doc.x = X0;
    doc.y = y + h + 12;
  }
  function templateField(f: TemplateFieldDef, raw: unknown) {
    if (f.type === 'table') {
      const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown>>;
      labelledTitle(f.label);
      for (const r of f.rows ?? []) {
        const cells = (f.columns ?? []).map((c) => `${c}: ${data[r]?.[c] == null || data[r]?.[c] === '' ? '—' : String(data[r][c])}`);
        labelled(r, cells.join('    '));
      }
      doc.moveDown(0.3);
    } else if (f.type === 'handwritten' && typeof raw === 'string' && raw.startsWith('data:image')) {
      labelledTitle(f.label);
      room(170);
      try {
        doc.image(Buffer.from(raw.split(',')[1] ?? '', 'base64'), X0, doc.y, { fit: [320, 160] });
        doc.y += 166;
      } catch {
        body('(drawing could not be printed)');
      }
    } else {
      const v = formatValue(f.type, raw);
      if (/diagnos/i.test(f.label) && v) return diagnosisBox(v);
      labelledTitle(f.label);
      body(v);
    }
  }
  function labelledTitle(t: string) {
    room(36);
    doc.font('B').fontSize(9.5).fillColor(INK).text(t, X0, doc.y, { width: W });
    doc.moveDown(0.15);
  }
}

const HOSPITAL_NAME_TEXT = 'Jayadev Memorial Rashtrotthana Hospital & Research Centre';

function hasValue(f: TemplateFieldDef, v: unknown): boolean {
  if (f.type === 'table') {
    const data = (v && typeof v === 'object' ? v : {}) as Record<string, Record<string, unknown>>;
    return (f.rows ?? []).some((r) => (f.columns ?? []).some((c) => data[r]?.[c] != null && data[r]?.[c] !== ''));
  }
  if (Array.isArray(v)) return v.length > 0;
  return v != null && v !== '' && v !== false;
}

/** The same medicine signed twice in one day prints once. */
function dedupeMeds(ms: Medicine[]): Medicine[] {
  const seen = new Set<string>();
  return ms.filter((m) => {
    const k = [m.name, m.frequency, m.duration, m.instructions ?? ''].map((x) => String(x).trim().toLowerCase()).join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fmtVisitDate(d: string): string {
  const t = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
