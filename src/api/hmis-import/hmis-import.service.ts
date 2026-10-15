import type { Request } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { raiseDietAlert, closeDietOnDischarge, onAdmissionTransferred } from '../dietetics/diet-lifecycle';
import { parseHmisExport, parseHmisDate, HmisExportError, type ParsedExport } from './hmis-export-parser';
import { matchWard, wardCodeFor, type WardLike } from './ward-matcher';

/**
 * HMIS export import — keeps IPD admissions current until the live HMIS
 * integration exists. Staff upload the HMIS grid exports (Current Occupancy,
 * Admissions, Discharge Summary) about once an hour.
 *
 * Preview and apply run the same plan: `apply:false` only reports what would
 * change. HMIS is the source of truth for who is admitted where; nothing here
 * pushes back to HMIS (that would loop the data).
 *
 * Rules:
 *   • Admission matched on the HMIS admission number (admissionNo / hmisAdmissionId).
 *   • Patient matched on PRN (PRNs come from HMIS); a PRN that belongs to a
 *     differently named patient in DocMinds goes to review, never merged.
 *   • Ward matched with ward-matcher (no near-duplicates); missing wards and
 *     beds are created. Occupancy gives the current bed → a different bed is a transfer.
 *   • A row in the discharge export discharges the admission and frees the bed.
 *   • A patient missing from occupancy is only flagged, never auto-discharged.
 */

export type ImportAction = 'ADMIT' | 'TRANSFER' | 'DISCHARGE' | 'UNCHANGED' | 'REVIEW' | 'SKIP';

export interface ImportItem {
  action: ImportAction;
  hmisAdmissionNo: string;
  prn: string;
  patientName: string;
  ward: string;
  bed: string;
  fromBed?: string;
  note?: string;
  error?: string;
}

export interface ImportResult {
  applied: boolean;
  files: Array<{ name: string; kind: string; rows: number }>;
  summary: Record<ImportAction, number> & { newWards: number; newBeds: number; newPatients: number; failed: number };
  wards: Array<{ hmisName: string; matchedTo: string | null; how: string }>;
  items: ImportItem[];
}

interface CurrentRow {
  no: string; prn: string; name: string; age: string; sex: string; contact: string;
  doctor: string; dept: string; ward: string; bed: string; bedCategory: string;
  admitAt: Date | null; type: string; diagnosis: string;
}

interface DischargeRow { no: string; prn: string; name: string; ward: string; bed: string; dischargeAt: Date | null }

const LIVE = ['admitted', 'BED_ACCEPTED'];
const CLOSED = ['discharged', 'LAMA', 'DAMA', 'expired'];
const SOURCE = 'hmis';

let running = false;

// ── helpers ────────────────────────────────────────────────────────────

const TITLES = /\b(mr|mrs|ms|miss|dr|master|mstr|baby|bo|b o|smt|sri|shri|kum|kumari|baby of)\b/g;

/** Letters only, titles removed — "Mr. RAMESH K S" ≈ "Ramesh K.S." */
function personKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(TITLES, ' ').replace(/\s+/g, ' ').trim();
}

function samePerson(a: string, b: string): boolean {
  const x = personKey(a), y = personKey(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/ /g, '') === y.replace(/ /g, '')) return true;
  // Same first name and the rest overlaps (initials vs full surname).
  const [fx] = x.split(' '), [fy] = y.split(' ');
  return fx === fy && (x.includes(y) || y.includes(x));
}

const bedKey = (ward: string, bed: string) => `${ward.trim().toLowerCase()}|${bed.trim().toLowerCase()}`;

function bedTypeFor(category: string, ward: string): string {
  const s = `${category} ${ward}`.toLowerCase();
  if (/hdu/.test(s)) return 'HDU';
  if (/icu|critical/.test(s)) return 'ICU';
  if (/isolation/.test(s)) return 'isolation';
  return 'general';
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function collect(parsed: ParsedExport[]): { current: Map<string, CurrentRow>; discharges: Map<string, DischargeRow>; hasOccupancy: boolean } {
  const current = new Map<string, CurrentRow>();
  const merge = (r: CurrentRow, preferPlace: boolean) => {
    if (!r.no) return;
    const prev = current.get(r.no);
    if (!prev) { current.set(r.no, r); return; }
    const pick = (a: string, b: string) => a || b;
    current.set(r.no, {
      ...prev,
      prn: pick(prev.prn, r.prn), name: pick(prev.name, r.name), age: pick(prev.age, r.age), sex: pick(prev.sex, r.sex),
      contact: pick(prev.contact, r.contact), doctor: pick(prev.doctor, r.doctor), dept: pick(prev.dept, r.dept),
      type: pick(prev.type, r.type), diagnosis: pick(prev.diagnosis, r.diagnosis),
      bedCategory: pick(prev.bedCategory, r.bedCategory), admitAt: prev.admitAt ?? r.admitAt,
      // Occupancy is "now"; it wins for the bed.
      ward: preferPlace && r.ward ? r.ward : prev.ward || r.ward,
      bed: preferPlace && r.bed ? r.bed : prev.bed || r.bed,
    });
  };

  for (const p of parsed.filter((x) => x.kind === 'ADMISSIONS')) {
    for (const r of p.rows) {
      merge({
        no: r['Admission No'], prn: r['PRN'], name: r['Patient Name'], age: r['Age'], sex: r['Sex'], contact: r['Contact'],
        doctor: r['Incharge Doctor'], dept: r['Incare Dept'], ward: r['Admit in Ward'], bed: r['Bed No'], bedCategory: '',
        admitAt: parseHmisDate(r['Admit Date']), type: r['Admission Type'], diagnosis: '',
      }, false);
    }
  }
  const occupancy = parsed.filter((x) => x.kind === 'OCCUPANCY');
  for (const p of occupancy) {
    for (const r of p.rows) {
      merge({
        no: r['Admission No.'], prn: r['PRN'], name: r['Patient Name'], age: '', sex: '', contact: '',
        doctor: r['Consulting Doctor'], dept: r['Incare Dept'], ward: r['Ward'], bed: r['Bed No'], bedCategory: r['Bed Category'],
        admitAt: parseHmisDate(r['Admit Date']), type: '', diagnosis: r['Provisional Diagnosis'],
      }, true);
    }
  }

  const discharges = new Map<string, DischargeRow>();
  for (const p of parsed.filter((x) => x.kind === 'DISCHARGES')) {
    for (const r of p.rows) {
      const no = r['Admission No'];
      if (!no) continue;
      discharges.set(no, {
        no, prn: r['PRN'], name: r['Patient Name'], ward: r['WARD'], bed: r['BED'],
        dischargeAt: parseHmisDate(r['Discharge Date']),
      });
      current.delete(no); // discharged wins over an older occupancy/admission row
    }
  }
  return { current, discharges, hasOccupancy: occupancy.length > 0 };
}

// ── main ───────────────────────────────────────────────────────────────

export async function runHmisImport(
  files: Array<{ name: string; buffer: Buffer }>,
  opts: { apply: boolean; req: Request },
): Promise<ImportResult> {
  if (opts.apply && running) throw new HmisExportError('Another import is being applied — try again in a minute.');
  const parsed = files.map((f) => ({ name: f.name, ...parseHmisExport(f.buffer, f.name) }));
  if (!parsed.some((p) => p.kind !== 'MOVEMENT')) {
    throw new HmisExportError('Upload Current Occupancy, Admissions or Discharge Summary — Patient Movement alone has no bed numbers.');
  }

  const { current, discharges, hasOccupancy } = collect(parsed);
  const nos = [...current.keys(), ...discharges.keys()];

  const [wardRows, admissions, liveRows] = await Promise.all([
    prisma.ipdWard.findMany({ select: { id: true, wardName: true, wardCode: true, hmisWardId: true, beds: { select: { id: true, bedNumber: true, status: true } } } }),
    nos.length
      ? prisma.ipdAdmission.findMany({
          where: { OR: [{ admissionNo: { in: nos } }, { hmisAdmissionId: { in: nos } }] },
          select: { id: true, admissionNo: true, hmisAdmissionId: true, prn: true, status: true, bedId: true, wardId: true, sourceModule: true },
        })
      : Promise.resolve([]),
    prisma.ipdAdmission.findMany({
      where: { status: { in: LIVE } },
      select: { id: true, admissionNo: true, hmisAdmissionId: true, bedId: true, sourceModule: true, prn: true },
    }),
  ]);

  const admByNo = new Map<string, (typeof admissions)[number]>();
  for (const a of admissions) {
    if (a.hmisAdmissionId) admByNo.set(a.hmisAdmissionId, a);
    if (!admByNo.has(a.admissionNo)) admByNo.set(a.admissionNo, a);
  }
  const liveByBed = new Map(liveRows.filter((a) => a.bedId).map((a) => [a.bedId as string, a]));

  const prnInts = Array.from(new Set(
    [...current.values()].map((c) => Number.parseInt(c.prn, 10)).filter((n) => !Number.isNaN(n)),
  ));
  const patients = prnInts.length
    ? await prisma.patientDetails.findMany({ where: { prn: { in: prnInts } }, select: { prn: true, name: true } })
    : [];
  const patientByPrn = new Map(patients.map((p) => [String(p.prn), p]));

  // ── wards & beds ─────────────────────────────────────────────────────
  const wards: WardLike[] = wardRows.map((w) => ({ id: w.id, wardName: w.wardName, wardCode: w.wardCode, hmisWardId: w.hmisWardId }));
  const wardFor = new Map<string, { ward: WardLike | null; how: string }>();
  const hmisWardNames = new Set<string>();
  for (const c of current.values()) if (c.ward) hmisWardNames.add(c.ward);
  for (const name of hmisWardNames) {
    const m = matchWard(name, wards);
    wardFor.set(name.toLowerCase(), m ? { ward: m.ward, how: m.how } : { ward: null, how: 'new' });
  }
  const bedsByWard = new Map(wardRows.map((w) => [w.id, w.beds]));
  const findBed = (wardId: string | undefined, bedNo: string) =>
    wardId ? (bedsByWard.get(wardId) ?? []).find((b) => b.bedNumber.trim().toLowerCase() === bedNo.trim().toLowerCase()) : undefined;

  // ── plan ─────────────────────────────────────────────────────────────
  const items: ImportItem[] = [];
  const freedBedIds = new Set<string>();
  type Pending = { item: ImportItem; row?: CurrentRow; adm?: (typeof admissions)[number]; dis?: DischargeRow; newPatient?: boolean };
  const plan: Pending[] = [];

  for (const d of discharges.values()) {
    const adm = admByNo.get(d.no);
    const base = { hmisAdmissionNo: d.no, prn: d.prn, patientName: d.name, ward: d.ward, bed: d.bed };
    if (!adm) { items.push({ ...base, action: 'SKIP', note: 'Discharged in HMIS; never admitted in DocMinds' }); continue; }
    if (CLOSED.includes(adm.status)) { items.push({ ...base, action: 'UNCHANGED', note: 'Already discharged' }); continue; }
    if (adm.bedId) freedBedIds.add(adm.bedId);
    const item: ImportItem = { ...base, action: 'DISCHARGE', note: d.dischargeAt ? `Discharged ${d.dischargeAt.toLocaleString('en-IN')}` : undefined };
    items.push(item);
    plan.push({ item, adm, dis: d });
  }

  // Beds currently held by admissions that move or leave in this batch.
  const leaving = new Set<string>();
  for (const a of liveRows) {
    const no = a.hmisAdmissionId ?? a.admissionNo;
    const c = current.get(no);
    if (discharges.has(no)) { if (a.bedId) leaving.add(a.bedId); continue; }
    if (c && a.bedId) {
      const target = findBed(wardFor.get(c.ward.toLowerCase())?.ward?.id, c.bed);
      if (!target || target.id !== a.bedId) leaving.add(a.bedId);
    }
  }

  const claimed = new Set<string>();
  for (const c of current.values()) {
    const base = { hmisAdmissionNo: c.no, prn: c.prn, patientName: c.name, ward: c.ward, bed: c.bed };
    const review = (note: string) => items.push({ ...base, action: 'REVIEW', note });

    const prnInt = Number.parseInt(c.prn, 10);
    if (Number.isNaN(prnInt)) { review('No PRN in the HMIS row'); continue; }
    if (!c.ward || !c.bed) { review('No ward or bed in the HMIS row'); continue; }
    const patient = patientByPrn.get(String(prnInt));
    if (patient && !samePerson(patient.name, c.name)) {
      review(`PRN ${prnInt} belongs to "${patient.name}" in DocMinds — check the PRN before importing`);
      continue;
    }
    const key = bedKey(c.ward, c.bed);
    if (claimed.has(key)) { review('Two HMIS rows in the same bed'); continue; }
    claimed.add(key);

    const ward = wardFor.get(c.ward.toLowerCase())?.ward ?? null;
    const bed = findBed(ward?.id, c.bed);
    const occupant = bed ? liveByBed.get(bed.id) : undefined;
    const adm = admByNo.get(c.no);
    const takenByOther = !!(occupant && occupant.id !== adm?.id && !leaving.has(bed!.id) && !freedBedIds.has(bed!.id));

    if (adm && CLOSED.includes(adm.status)) { review(`Discharged in DocMinds (${adm.status}) but still in HMIS`); continue; }
    if (adm && !LIVE.includes(adm.status)) { review(`Pending admission in DocMinds (${adm.status}) — finish or cancel it there`); continue; }
    if (takenByOther) { review(`Bed is held by ${occupant!.admissionNo} in DocMinds`); continue; }

    if (adm) {
      if (bed && adm.bedId === bed.id) { items.push({ ...base, action: 'UNCHANGED' }); continue; }
      const fromBed = liveRows.find((l) => l.id === adm.id)?.bedId;
      const fromLabel = fromBed ? wardRows.flatMap((w) => w.beds).find((b) => b.id === fromBed)?.bedNumber : undefined;
      const item: ImportItem = { ...base, action: 'TRANSFER', fromBed: fromLabel ?? '—' };
      items.push(item);
      plan.push({ item, row: c, adm });
    } else {
      const item: ImportItem = { ...base, action: 'ADMIT', note: patient ? undefined : 'New patient' };
      items.push(item);
      plan.push({ item, row: c, newPatient: !patient });
    }
  }

  if (hasOccupancy) {
    for (const a of liveRows) {
      const no = a.hmisAdmissionId ?? a.admissionNo;
      if (a.sourceModule !== SOURCE || current.has(no) || discharges.has(no)) continue;
      items.push({
        action: 'REVIEW', hmisAdmissionNo: no, prn: a.prn, patientName: '', ward: '', bed: '',
        note: 'Not in HMIS occupancy any more — discharge it in DocMinds if the patient has left',
      });
    }
  }

  const newWardNames = [...wardFor.entries()].filter(([, v]) => !v.ward).map(([k]) => [...hmisWardNames].find((n) => n.toLowerCase() === k)!);
  const plannedBeds = plan.filter((p) => p.row && !findBed(wardFor.get(p.row.ward.toLowerCase())?.ward?.id, p.row.bed));

  const count = (a: ImportAction) => items.filter((i) => i.action === a).length;
  const result: ImportResult = {
    applied: false,
    files: parsed.map((p) => ({ name: p.name, kind: p.kind, rows: p.rows.length })),
    summary: {
      ADMIT: count('ADMIT'), TRANSFER: count('TRANSFER'), DISCHARGE: count('DISCHARGE'),
      UNCHANGED: count('UNCHANGED'), REVIEW: count('REVIEW'), SKIP: count('SKIP'),
      newWards: newWardNames.length, newBeds: plannedBeds.length, newPatients: plan.filter((p) => p.newPatient).length, failed: 0,
    },
    wards: [...hmisWardNames].map((n) => {
      const m = wardFor.get(n.toLowerCase())!;
      return { hmisName: n, matchedTo: m.ward?.wardName ?? null, how: m.how };
    }),
    items: items.sort((a, b) => ORDER.indexOf(a.action) - ORDER.indexOf(b.action)),
  };
  if (!opts.apply) return result;

  // ── apply ────────────────────────────────────────────────────────────
  running = true;
  const actor = opts.req.user?.username ?? 'hmis-import';
  try {
    // 1. Wards that don't exist yet (one per HMIS name), remembering the HMIS name.
    const takenCodes = new Set(wardRows.map((w) => w.wardCode));
    for (const name of newWardNames) {
      const dept = [...current.values()].find((c) => c.ward === name)?.dept || 'General';
      const created = await prisma.ipdWard.create({
        data: { wardName: name, wardCode: wardCodeFor(name, takenCodes), department: dept, totalBeds: 0, hmisWardId: name },
      });
      const w: WardLike = { id: created.id, wardName: created.wardName, wardCode: created.wardCode, hmisWardId: name };
      wardFor.set(name.toLowerCase(), { ward: w, how: 'new' });
      bedsByWard.set(created.id, []);
    }
    // Remember matches so the next import maps the same HMIS name straight away.
    for (const [lower, m] of wardFor) {
      if (m.ward && !m.ward.hmisWardId) {
        const name = [...hmisWardNames].find((n) => n.toLowerCase() === lower)!;
        await prisma.ipdWard.update({ where: { id: m.ward.id }, data: { hmisWardId: name } });
        m.ward.hmisWardId = name;
      }
    }

    const ensureBed = async (row: CurrentRow) => {
      const ward = wardFor.get(row.ward.toLowerCase())!.ward!;
      const existing = findBed(ward.id, row.bed);
      if (existing) return { wardId: ward.id, bedId: existing.id };
      const bed = await prisma.ipdBed.create({
        data: { wardId: ward.id, bedNumber: row.bed.trim(), bedType: bedTypeFor(row.bedCategory, row.ward), status: 'available' },
      });
      await prisma.ipdWard.update({ where: { id: ward.id }, data: { totalBeds: { increment: 1 } } });
      bedsByWard.get(ward.id)!.push({ id: bed.id, bedNumber: bed.bedNumber, status: bed.status });
      return { wardId: ward.id, bedId: bed.id };
    };

    const fail = (p: Pending, e: unknown) => {
      p.item.error = e instanceof Error ? e.message : String(e);
      result.summary.failed++;
    };

    // 2. Discharges free their beds first.
    for (const p of plan.filter((x) => x.item.action === 'DISCHARGE')) {
      try {
        await prisma.ipdAdmission.update({ where: { id: p.adm!.id }, data: { status: 'discharged', updatedBy: actor } });
        if (p.adm!.bedId) await prisma.ipdBed.update({ where: { id: p.adm!.bedId }, data: { status: 'available' } });
        await closeDietOnDischarge(p.adm!.id);
      } catch (e) { fail(p, e); }
    }

    // 3. Transfers: release every old bed, then take the new ones (handles swaps).
    const transfers = plan.filter((x) => x.item.action === 'TRANSFER');
    for (const p of transfers) {
      if (p.adm!.bedId) await prisma.ipdBed.update({ where: { id: p.adm!.bedId }, data: { status: 'available' } }).catch(() => undefined);
    }
    for (const p of transfers) {
      try {
        const { wardId, bedId } = await ensureBed(p.row!);
        await prisma.$transaction([
          prisma.ipdAdmission.update({ where: { id: p.adm!.id }, data: { wardId, bedId, updatedBy: actor } }),
          prisma.ipdBed.update({ where: { id: bedId }, data: { status: 'occupied' } }),
        ]);
        await onAdmissionTransferred(p.adm!.id, p.adm!.bedId);
      } catch (e) { fail(p, e); }
    }

    // 4. New admissions (and their patients).
    for (const p of plan.filter((x) => x.item.action === 'ADMIT')) {
      const r = p.row!;
      try {
        const prnInt = Number.parseInt(r.prn, 10);
        if (p.newPatient) {
          await prisma.patientDetails.upsert({
            where: { prn: prnInt },
            update: {},
            create: {
              prn: prnInt, name: r.name, age: r.age || null, gender: r.sex || null,
              contactNo: r.contact || null, mobileNo: r.contact || null, source: 'hmis-import', createdBy: actor,
            },
          });
        }
        const { wardId, bedId } = await ensureBed(r);
        const admitAt = r.admitAt ?? new Date();
        const data = {
          prn: String(prnInt),
          admissionDate: admitAt,
          admissionTime: hhmm(admitAt),
          admissionType: (r.type || 'routine').toLowerCase(),
          sourceModule: SOURCE,
          admittingDoctor: r.doctor || 'Not recorded in HMIS',
          department: r.dept || 'General',
          wardId,
          bedId,
          roomType: r.bedCategory || r.ward,
          diagnosis: r.diagnosis || '',
          status: 'admitted',
          hmisAdmissionId: r.no,
          createdBy: actor,
        };
        let created;
        try {
          created = await prisma.ipdAdmission.create({ data: { ...data, admissionNo: r.no } });
        } catch (e) {
          // Number already used by a DocMinds-made admission → keep it distinct.
          if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') {
            created = await prisma.ipdAdmission.create({ data: { ...data, admissionNo: `HMIS-${r.no}` } });
          } else throw e;
        }
        await prisma.ipdBed.update({ where: { id: bedId }, data: { status: 'occupied' } });
        await raiseDietAlert('ADMISSION', created.id);
      } catch (e) { fail(p, e); }
    }

    result.applied = true;
    await auditLog(opts.req, {
      module: 'hmis-import',
      action: 'IMPORT',
      entityType: 'IpdAdmission',
      payload: { files: result.files, summary: result.summary },
      notes: `HMIS export import: ${result.summary.ADMIT} admitted, ${result.summary.TRANSFER} transferred, ${result.summary.DISCHARGE} discharged, ${result.summary.REVIEW} to review`,
    });
    return result;
  } finally {
    running = false;
  }
}

const ORDER: ImportAction[] = ['REVIEW', 'ADMIT', 'TRANSFER', 'DISCHARGE', 'SKIP', 'UNCHANGED'];

/** Last applied import, for the "Last import: 42 min ago" banner. */
export async function lastHmisImport(): Promise<{ at: Date; by: string | null; summary: unknown } | null> {
  const row = await prisma.appAuditLog.findFirst({
    where: { module: 'hmis-import', action: 'IMPORT' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, actorName: true, payload: true },
  });
  if (!row) return null;
  let summary: unknown = null;
  try { summary = row.payload ? (JSON.parse(row.payload) as { summary?: unknown }).summary ?? null : null; } catch { summary = null; }
  return { at: row.createdAt, by: row.actorName, summary };
}
