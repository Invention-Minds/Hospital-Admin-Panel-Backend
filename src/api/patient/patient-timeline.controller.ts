import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.23 — Patient Timeline.
//
// One unified, time-sorted feed of every clinical/operational event for a
// single patient across modules (OPD, IPD, ER, OT, Lab, Pharmacy, notes,
// allergies, MLC, LAMA/DAMA, therapy). The frontend renders this as a vertical
// timeline with filter chips + deep-links to source screens.
//
// PRN type mismatch note: PatientDetails.prn is Int @unique while most clinical
// modules store prn as String. We coerce per query.

export interface TimelineEvent {
  ts: string;                       // ISO timestamp (descending sort key)
  type: string;                     // see TYPES below
  title: string;                    // 1-line label
  summary?: string;                 // 1-line detail
  source: { entity: string; id: string | number };
  severity?: 'info' | 'warn' | 'critical';
  meta?: Record<string, unknown>;
}

export const TIMELINE_TYPES = [
  'opd-visit', 'opd-assessment', 'ipd-admission', 'ipd-discharge', 'er-visit',
  'prescription', 'investigation-order', 'investigation-result',
  'doctor-note', 'history-note', 'allergy', 'ot-procedure',
  'therapy', 'progress-note', 'mlc', 'lama', 'dama', 'transfer',
] as const;

const safeISO = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
};

// Parse a time-of-day string ('HH:mm' / 'H:mm' 24h, or 'h:mm AM/PM' 12h) into
// { h, m } in 24h. Returns null if missing/unparseable.
const parseTimeOfDay = (timeStr: string | null | undefined): { h: number; m: number } | null => {
  if (!timeStr) return null;
  const s = String(timeStr).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const mer = m[3]?.toUpperCase();
  if (Number.isNaN(h) || Number.isNaN(min) || min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'PM' && h !== 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return { h, m: min };
};

// Fold a separate date + time-of-day into a single IST instant ISO string.
// When timeStr is present and parseable, anchor the parsed clock time to the
// date's calendar day at +05:30; otherwise fall back to date-only safeISO.
const safeISODateTime = (
  dateStr: Date | string | null | undefined,
  timeStr: string | null | undefined,
): string | null => {
  const tod = parseTimeOfDay(timeStr);
  if (!tod) return safeISO(dateStr);
  if (!dateStr) return null;
  const dt = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (Number.isNaN(dt.getTime())) return null;
  // Use the IST calendar day to avoid the date sliding when the source Date is
  // stored as a UTC midnight instant.
  const istDay = new Date(dt.getTime() + 5.5 * 60 * 60 * 1000);
  const y = istDay.getUTCFullYear();
  const mo = String(istDay.getUTCMonth() + 1).padStart(2, '0');
  const d = String(istDay.getUTCDate()).padStart(2, '0');
  const hh = String(tod.h).padStart(2, '0');
  const mm = String(tod.m).padStart(2, '0');
  const iso = new Date(`${y}-${mo}-${d}T${hh}:${mm}:00+05:30`);
  return Number.isNaN(iso.getTime()) ? safeISO(dateStr) : iso.toISOString();
};

export const getPatientTimeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const prnRaw = (req.params.prn ?? req.query.prn) as string | undefined;
    if (!prnRaw) { res.status(400).json({ message: 'prn is required' }); return; }
    const prnStr = String(prnRaw).trim();
    const prnInt = Number(prnStr);
    const prnIntValid = Number.isFinite(prnInt) && prnInt > 0;

    // Optional filters
    const typeFilter = ((req.query.types as string | undefined) || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const from = req.query.from ? new Date(req.query.from as string) : null;
    const to = req.query.to ? new Date(req.query.to as string) : null;

    // Patient header — PatientDetails uses Int.
    const patient = prnIntValid
      ? await prisma.patientDetails.findFirst({
          where: { prn: prnInt },
          select: { name: true, age: true, gender: true, bloodGroup: true, mobileNo: true, prn: true, knownAllergies: true },
        })
      : null;

    // Fan-out queries — keep each cheap and bounded.
    const [
      appointments, opdAssessments, ipdAdmissions, ipdProgressNotes,
      emergencies, prescriptions, investigationOrders, investigationResults,
      doctorNotes, historyNotes, allergies, therapyAppts, otSchedules,
    ] = await Promise.all([
      prnIntValid
        ? prisma.appointment.findMany({
            where: { prnNumber: prnInt },
            select: { id: true, date: true, time: true, doctorName: true, department: true, status: true },
            orderBy: { date: 'desc' }, take: 200,
          })
        : Promise.resolve([]),
      prnIntValid
        ? (async () => {
            // OPDAssessment links to Appointment by appointmentId; resolve ids first.
            const appts = await prisma.appointment.findMany({ where: { prnNumber: prnInt }, select: { id: true } });
            const apptIds = appts.map((a) => a.id);
            if (apptIds.length === 0) return [];
            return prisma.oPDAssessment.findMany({
              where: { appointmentId: { in: apptIds } },
              select: { id: true, date: true, assessmentTime: true, consultant: true, department: true, appointmentId: true },
              orderBy: { date: 'desc' }, take: 200,
            });
          })().catch(() => [])
        : Promise.resolve([]),
      prisma.ipdAdmission.findMany({
        where: { prn: prnStr },
        select: {
          id: true, admissionNo: true, admissionDate: true, admissionTime: true, admittingDoctor: true,
          department: true, status: true, ward: { select: { wardName: true } }, bed: { select: { bedNumber: true } },
          discharge: { select: { dischargeDate: true, dischargeType: true, conditionAtDischarge: true } },
        },
        orderBy: { admissionDate: 'desc' }, take: 100,
      }).catch(() => []),
      (async () => {
        const ads = await prisma.ipdAdmission.findMany({ where: { prn: prnStr }, select: { id: true } });
        const ids = ads.map((a) => a.id);
        if (ids.length === 0) return [];
        return prisma.ipdProgressNote.findMany({
          where: { admissionId: { in: ids } },
          select: { id: true, date: true, doctorName: true, subjective: true, assessment: true, plan: true, admissionId: true },
          orderBy: { date: 'desc' }, take: 100,
        });
      })().catch(() => []),
      prisma.emergency.findMany({
        where: { patientPrn: prnStr },
        select: { id: true, prn: true, triageCategory: true, presentingComplaint: true, status: true, disposition: true, createdAt: true },
        orderBy: { createdAt: 'desc' }, take: 100,
      }).catch(() => []),
      prisma.prescription.findMany({
        where: { prn: prnStr },
        include: { tablets: true },
        orderBy: { prescribedDate: 'desc' }, take: 100,
      }).catch(() => []),
      prisma.investigationOrder.findMany({
        where: { prn: prnStr },
        include: { labTests: true, radiologyTests: true },
        orderBy: { date: 'desc' }, take: 100,
      }).catch(() => []),
      prisma.investigationResult.findMany({
        where: { prn: prnStr, isDeleted: false },
        select: { id: true, testName: true, department: true, criticalFlag: true, reportedAt: true, result: true, impression: true, unit: true, referenceRange: true },
        orderBy: { reportedAt: 'desc' }, take: 100,
      }).catch(() => []),
      prnIntValid
        ? prisma.doctorNote.findMany({
            where: { prn: prnInt },
            select: { id: true, date: true, diagnosis: true, clinicalNotes: true, doctorId: true },
            orderBy: { date: 'desc' }, take: 100,
          }).catch(() => [])
        : Promise.resolve([]),
      prnIntValid
        ? prisma.historyNotes.findMany({
            where: { prn: prnInt },
            select: { id: true, date: true, updatedBy: true },
            orderBy: { date: 'desc' }, take: 50,
          }).catch(() => [])
        : Promise.resolve([]),
      prisma.allergy.findMany({
        where: { prn: prnStr },
        select: { id: true, genericName: true, createdAt: true },
        orderBy: { createdAt: 'desc' }, take: 200,
      }).catch(() => []),
      prnIntValid
        ? prisma.therapyAppointment.findMany({
            where: { prn: prnInt },
            select: { id: true, date: true, time: true, status: true, therapyId: true, doctorId: true },
            orderBy: { date: 'desc' }, take: 100,
          }).catch(() => [])
        : Promise.resolve([]),
      prisma.otSchedule.findMany({
        where: { prn: prnStr },
        select: { id: true, procedureName: true, surgeonName: true, plannedStart: true, actualStart: true, status: true },
        orderBy: { plannedStart: 'desc' }, take: 50,
      }).catch(() => []),
    ]);

    const events: TimelineEvent[] = [];

    // OPD visits
    for (const a of appointments) {
      const ts = safeISODateTime(a.date as unknown as Date, a.time) ?? new Date().toISOString();
      events.push({
        ts, type: 'opd-visit',
        title: `OPD visit — ${a.doctorName ?? 'Doctor'}`,
        summary: [a.department, a.time, a.status].filter(Boolean).join(' · '),
        source: { entity: 'Appointment', id: a.id },
      });
    }

    // OPD assessments
    for (const o of opdAssessments) {
      const ts = safeISODateTime(o.date as unknown as Date, o.assessmentTime);
      if (!ts) continue;
      events.push({
        ts, type: 'opd-assessment',
        title: 'OPD assessment recorded',
        summary: [o.consultant, o.department, o.assessmentTime].filter(Boolean).join(' · '),
        source: { entity: 'OPDAssessment', id: o.id },
        meta: { appointmentId: o.appointmentId },
      });
    }

    // IPD admissions (+ corresponding discharge as separate event)
    for (const ad of ipdAdmissions) {
      const ts = safeISO(ad.admissionDate as unknown as Date) ?? new Date().toISOString();
      events.push({
        ts, type: 'ipd-admission',
        title: `IPD admission — ${ad.admittingDoctor ?? 'Doctor'}`,
        summary: [ad.department, ad.ward?.wardName, ad.bed?.bedNumber ? `Bed ${ad.bed.bedNumber}` : null, ad.status].filter(Boolean).join(' · '),
        source: { entity: 'IpdAdmission', id: ad.id },
        meta: { admissionNo: ad.admissionNo },
      });
      if (ad.discharge?.dischargeDate) {
        const dts = safeISO(ad.discharge.dischargeDate as unknown as Date);
        if (dts) {
          events.push({
            ts: dts, type: 'ipd-discharge',
            title: `IPD discharge — ${ad.discharge.dischargeType ?? '—'}`,
            summary: ad.discharge.conditionAtDischarge ?? undefined,
            source: { entity: 'IpdAdmission', id: ad.id },
            meta: { admissionNo: ad.admissionNo },
          });
        }
      }
    }

    // IPD progress notes — SOAP. Title = doctor, summary = first slice of A+P.
    for (const n of ipdProgressNotes as Array<{ id: string; date: Date; doctorName: string; subjective: string; assessment: string; plan: string; admissionId: string }>) {
      const ts = safeISO(n.date);
      if (!ts) continue;
      const summary = [n.assessment, n.plan].filter(Boolean).join(' / ').slice(0, 140);
      events.push({
        ts, type: 'progress-note',
        title: `Progress note — ${n.doctorName ?? 'Doctor'}`,
        summary,
        source: { entity: 'IpdProgressNote', id: n.id },
        meta: { admissionId: n.admissionId },
      });
    }

    // ER visits
    for (const e of emergencies) {
      const ts = safeISO(e.createdAt as unknown as Date) ?? new Date().toISOString();
      const sev: TimelineEvent['severity'] = e.triageCategory === 'red' ? 'critical' : e.triageCategory === 'yellow' ? 'warn' : 'info';
      events.push({
        ts, type: 'er-visit',
        title: `ER — ${e.prn ?? ''} (${e.triageCategory})`,
        summary: [e.presentingComplaint, e.status, e.disposition].filter(Boolean).join(' · '),
        source: { entity: 'Emergency', id: e.id },
        severity: sev,
      });
    }

    // Prescriptions
    for (const p of prescriptions as Array<{ prescriptionId: string; prescribedDate: string; prescribedBy: string; tablets?: Array<{ genericName?: string; brandName?: string }> }>) {
      const ts = safeISO(p.prescribedDate);
      if (!ts) continue;
      const tabs = p.tablets ?? [];
      const meds = tabs.map((t) => t.brandName || t.genericName).filter(Boolean).slice(0, 5).join(', ');
      events.push({
        ts, type: 'prescription',
        title: `Prescription — ${p.prescribedBy ?? 'Doctor'}`,
        summary: meds || '—',
        source: { entity: 'Prescription', id: p.prescriptionId },
        meta: { tabletCount: tabs.length },
      });
    }

    // Investigation orders — labTests / radiologyTests are typed loosely here,
    // so use a permissive shape and pick whichever name-ish field exists.
    for (const o of investigationOrders as Array<{ id: number; date: string; doctorName: string; labTests?: Array<Record<string, unknown>>; radiologyTests?: Array<Record<string, unknown>> }>) {
      const ts = safeISO(o.date);
      if (!ts) continue;
      const nameOf = (t: Record<string, unknown>): string => String(t['name'] ?? t['testName'] ?? t['title'] ?? '');
      const labs = (o.labTests ?? []).map(nameOf).filter(Boolean);
      const rads = (o.radiologyTests ?? []).map(nameOf).filter(Boolean);
      const tests = [...labs, ...rads].slice(0, 6).join(', ');
      events.push({
        ts, type: 'investigation-order',
        title: `Investigations ordered — ${o.doctorName ?? 'Doctor'}`,
        summary: tests || '—',
        source: { entity: 'InvestigationOrder', id: o.id },
      });
    }

    // Investigation results
    for (const r of investigationResults) {
      const ts = safeISO(r.reportedAt as unknown as Date);
      if (!ts) continue;
      events.push({
        ts, type: 'investigation-result',
        title: `Result — ${r.testName}`,
        summary: [r.result, r.unit, r.referenceRange ? `(ref ${r.referenceRange})` : null, r.impression].filter(Boolean).join(' '),
        source: { entity: 'InvestigationResult', id: r.id },
        severity: r.criticalFlag ? 'critical' : 'info',
      });
    }

    // Doctor / history notes
    for (const dn of doctorNotes as Array<{ id: number; date: string; diagnosis: string | null; clinicalNotes: string | null }>) {
      const ts = safeISO(dn.date);
      if (!ts) continue;
      const summary = [dn.diagnosis, dn.clinicalNotes].filter(Boolean).join(' · ').slice(0, 140);
      events.push({
        ts, type: 'doctor-note',
        title: 'Doctor note',
        summary,
        source: { entity: 'DoctorNote', id: dn.id },
      });
    }
    for (const hn of historyNotes) {
      const ts = safeISO(hn.date as unknown as Date);
      if (!ts) continue;
      events.push({
        ts, type: 'history-note',
        title: 'History note updated',
        summary: hn.updatedBy ? `by ${hn.updatedBy}` : undefined,
        source: { entity: 'HistoryNotes', id: hn.id },
      });
    }

    // Allergies
    for (const a of allergies) {
      const ts = safeISO(a.createdAt as unknown as Date) ?? new Date().toISOString();
      events.push({
        ts, type: 'allergy',
        title: `Allergy recorded — ${a.genericName}`,
        source: { entity: 'Allergy', id: a.id },
        severity: 'warn',
      });
    }

    // Therapy
    for (const t of therapyAppts as Array<{ id: number; date: string; time: string; status: string | null }>) {
      const ts = safeISODateTime(t.date, t.time);
      if (!ts) continue;
      events.push({
        ts, type: 'therapy',
        title: 'Therapy session',
        summary: [t.time, t.status].filter(Boolean).join(' · '),
        source: { entity: 'TherapyAppointment', id: t.id },
      });
    }

    // OT procedures
    for (const s of otSchedules) {
      const ts = safeISO(s.actualStart ?? s.plannedStart) ?? new Date().toISOString();
      events.push({
        ts, type: 'ot-procedure',
        title: `OT — ${s.procedureName}`,
        summary: [s.surgeonName, s.status].filter(Boolean).join(' · '),
        source: { entity: 'OtSchedule', id: s.id },
      });
    }

    // Filter + sort + clamp.
    const fromMs = from && !Number.isNaN(from.getTime()) ? from.getTime() : null;
    const toMs = to && !Number.isNaN(to.getTime()) ? to.getTime() : null;
    const filtered = events
      .filter((e) => (typeFilter.length ? typeFilter.includes(e.type) : true))
      .filter((e) => {
        const ms = new Date(e.ts).getTime();
        if (fromMs != null && ms < fromMs) return false;
        if (toMs != null && ms > toMs) return false;
        return true;
      })
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 1000);

    // Counts by type for the filter chips.
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

    res.status(200).json({
      data: filtered,
      counts,
      patient: patient
        ? { prn: patient.prn, name: patient.name, age: patient.age, gender: patient.gender, bloodGroup: patient.bloodGroup, mobileNo: patient.mobileNo, knownAllergies: patient.knownAllergies }
        : null,
    });
  } catch (error) {
    console.error('[patient-timeline] failed:', error);
    res.status(500).json({ message: 'Failed to build patient timeline' });
  }
};
