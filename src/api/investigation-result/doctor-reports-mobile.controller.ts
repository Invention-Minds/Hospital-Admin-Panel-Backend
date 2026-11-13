import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { admittedByDoctor } from '../../service/doctor-name-match';
import { auditLog } from '../../service/app-audit';

// Doctor mobile app — "my reports". Separate from the web result endpoints
// (unchanged). A result is the doctor's when they placed the order
// (InvestigationOrder.doctorId = Doctor.id) or the patient is currently admitted
// under them. Users without a Doctor row (admins) see every result.
// Critical acknowledgement writes the same columns as POST /:id/ack.

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_IPD = ['admitted', 'transferred'];

type Doctor = { id: number; name: string };

async function currentDoctor(req: Request): Promise<Doctor | null> {
  const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
  return userId ? prisma.doctor.findFirst({ where: { userId }, select: { id: true, name: true } }) : null;
}

/** PRNs of patients currently admitted under the doctor. */
async function admittedPrns(doctor: Doctor): Promise<string[]> {
  const rows = await prisma.ipdAdmission.findMany({
    where: { status: { in: ACTIVE_IPD }, ...admittedByDoctor(doctor) },
    select: { prn: true },
    take: 300,
  });
  return [...new Set(rows.map((r) => r.prn))];
}

async function scopeWhere(doctor: Doctor | null) {
  if (!doctor) return {};
  const prns = await admittedPrns(doctor);
  return { OR: [{ order: { doctorId: doctor.id } }, ...(prns.length ? [{ prn: { in: prns } }] : [])] };
}

async function patientNames(prns: string[]): Promise<Map<string, { name: string; age: string | null; gender: string | null }>> {
  const ints = [...new Set(prns)].map(Number).filter(Number.isFinite);
  if (!ints.length) return new Map();
  const rows = await prisma.patientDetails.findMany({ where: { prn: { in: ints } }, select: { prn: true, name: true, age: true, gender: true } });
  return new Map(rows.map((p) => [String(p.prn), { name: p.name, age: p.age, gender: p.gender }]));
}

/** H / L from a numeric result against "a-b", "a – b", "<b", ">a", "≤b", "≥a". Null when not comparable. */
export function rangeFlag(result: string | null | undefined, range: string | null | undefined): 'H' | 'L' | null {
  const raw = String(result ?? '').trim().replace(/,/g, '');
  const v = Number(raw);
  if (!range || raw === '' || !Number.isFinite(v)) return null;
  const r = range.replace(/,/g, '').trim();
  const between = r.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)/i);
  if (between) {
    const lo = Number(between[1]);
    const hi = Number(between[2]);
    if (v < lo) return 'L';
    if (v > hi) return 'H';
    return null;
  }
  const upper = r.match(/^(?:<|≤|<=|up to|upto)\s*(-?\d+(?:\.\d+)?)/i);
  if (upper) return v > Number(upper[1]) ? 'H' : null;
  const lower = r.match(/^(?:>|≥|>=)\s*(-?\d+(?:\.\d+)?)/);
  if (lower) return v < Number(lower[1]) ? 'L' : null;
  return null;
}

function flagOf(r: { criticalFlag: boolean; result: string | null; referenceRange: string | null }): 'C' | 'H' | 'L' | null {
  return r.criticalFlag ? 'C' : rangeFlag(r.result, r.referenceRange);
}

const RESULT_SELECT = {
  id: true,
  orderId: true,
  prn: true,
  testName: true,
  department: true,
  result: true,
  unit: true,
  referenceRange: true,
  criticalFlag: true,
  status: true,
  findings: true,
  impression: true,
  reportedAt: true,
  createdAt: true,
  acknowledgedAt: true,
  acknowledgedBy: true,
  order: { select: { id: true, doctorId: true, doctorName: true, date: true } },
} as const;

/** GET /api/investigation-results/my-reports?days=7 */
export const getMyReports = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctor = await currentDoctor(req);
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const since = new Date(Date.now() - days * DAY_MS);
    const scope = await scopeWhere(doctor);

    const [recent, unackedCritical] = await Promise.all([
      prisma.investigationResult.findMany({
        where: { isDeleted: false, createdAt: { gte: since }, ...scope },
        select: RESULT_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      // Unacknowledged criticals stay pinned however old they are.
      prisma.investigationResult.findMany({
        where: { isDeleted: false, criticalFlag: true, acknowledgedAt: null, ...scope },
        select: RESULT_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const names = await patientNames([...recent, ...unackedCritical].map((r) => r.prn));
    const patient = (prn: string) => names.get(prn) ?? null;

    // One report = one order; its tests are listed together.
    const byOrder = new Map<number, typeof recent>();
    for (const r of recent) byOrder.set(r.orderId, [...(byOrder.get(r.orderId) ?? []), r]);
    const reports = [...byOrder.values()].map((rows) => {
      const latest = rows.reduce((a, b) => ((a.reportedAt ?? a.createdAt) > (b.reportedAt ?? b.createdAt) ? a : b));
      const flags = rows.map(flagOf);
      return {
        orderId: rows[0].orderId,
        prn: rows[0].prn,
        patient: patient(rows[0].prn),
        orderedBy: rows[0].order.doctorName,
        departments: [...new Set(rows.map((r) => r.department))],
        tests: rows.map((r) => r.testName),
        reportedAt: latest.reportedAt ?? latest.createdAt,
        status: rows.every((r) => r.status === 'final') ? 'final' : rows.some((r) => r.status === 'final' || r.status === 'partial') ? 'partial' : 'pending',
        critical: flags.filter((f) => f === 'C').length,
        abnormal: flags.filter((f) => f === 'H' || f === 'L').length,
        unackedCritical: rows.filter((r) => r.criticalFlag && !r.acknowledgedAt).length,
      };
    });

    res.status(200).json({
      days,
      critical: unackedCritical.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        prn: r.prn,
        patient: patient(r.prn),
        testName: r.testName,
        result: r.result,
        unit: r.unit,
        referenceRange: r.referenceRange,
        reportedAt: r.reportedAt ?? r.createdAt,
      })),
      reports,
      doctor,
    });
  } catch (error) {
    console.error('[results:my-reports] failed:', error);
    res.status(500).json({ error: 'Failed to load your reports' });
  }
};

/** Doctor may see this result/order? Admins (no Doctor row) always may. */
async function mayView(doctor: Doctor | null, prn: string, orderDoctorId: number): Promise<boolean> {
  if (!doctor) return true;
  if (orderDoctorId === doctor.id) return true;
  return (await admittedPrns(doctor)).includes(prn);
}

/** GET /api/investigation-results/my-reports/order/:orderId — the report with flags and per-test trend. */
export const getMyReportOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      res.status(400).json({ error: 'Invalid order id' });
      return;
    }
    const [doctor, order] = await Promise.all([
      currentDoctor(req),
      prisma.investigationOrder.findUnique({
        where: { id: orderId },
        select: {
          id: true, prn: true, date: true, doctorId: true, doctorName: true, remarks: true,
          results: { where: { isDeleted: false }, select: RESULT_SELECT, orderBy: { id: 'asc' } },
        },
      }),
    ]);
    if (!order) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    if (!(await mayView(doctor, order.prn, order.doctorId))) {
      res.status(403).json({ error: 'This report is not for your patient' });
      return;
    }

    // Trend: the same tests for this patient, last 6 readings each (oldest → newest).
    const names = [...new Set(order.results.map((r) => r.testName))];
    const history = names.length
      ? await prisma.investigationResult.findMany({
          where: { prn: order.prn, isDeleted: false, testName: { in: names } },
          select: { id: true, testName: true, result: true, createdAt: true, reportedAt: true, criticalFlag: true },
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
      : [];
    const trendFor = (testName: string) =>
      history
        .filter((h) => h.testName === testName && Number.isFinite(Number(String(h.result ?? '').replace(/,/g, ''))) && String(h.result ?? '').trim() !== '')
        .slice(0, 6)
        .reverse()
        .map((h) => ({ id: h.id, value: Number(String(h.result).replace(/,/g, '')), at: h.reportedAt ?? h.createdAt, critical: h.criticalFlag }));

    const pts = await patientNames([order.prn]);
    res.status(200).json({
      data: {
        orderId: order.id,
        prn: order.prn,
        patient: pts.get(order.prn) ?? null,
        orderedOn: order.date,
        orderedBy: order.doctorName,
        remarks: order.remarks,
        results: order.results.map((r) => ({
          id: r.id,
          testName: r.testName,
          department: r.department,
          result: r.result,
          unit: r.unit,
          referenceRange: r.referenceRange,
          flag: flagOf(r),
          status: r.status,
          findings: r.findings,
          impression: r.impression,
          reportedAt: r.reportedAt ?? r.createdAt,
          acknowledgedAt: r.acknowledgedAt,
          acknowledgedBy: r.acknowledgedBy,
          trend: trendFor(r.testName),
        })),
      },
    });
  } catch (error) {
    console.error('[results:my-reports:order] failed:', error);
    res.status(500).json({ error: 'Failed to load the report' });
  }
};

/** POST /api/investigation-results/my-reports/:id/ack — acknowledge a critical result (NABH: who saw it, when). */
export const ackMyResult = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid result id' });
      return;
    }
    const [doctor, existing] = await Promise.all([
      currentDoctor(req),
      prisma.investigationResult.findUnique({
        where: { id },
        select: { id: true, prn: true, isDeleted: true, acknowledgedAt: true, acknowledgedBy: true, order: { select: { doctorId: true } } },
      }),
    ]);
    if (!existing || existing.isDeleted) {
      res.status(404).json({ error: 'Result not found' });
      return;
    }
    if (!(await mayView(doctor, existing.prn, existing.order.doctorId))) {
      res.status(403).json({ error: 'This result is not for your patient' });
      return;
    }
    if (existing.acknowledgedAt) {
      res.status(200).json({ data: { id, acknowledgedAt: existing.acknowledgedAt, acknowledgedBy: existing.acknowledgedBy, alreadyAcked: true } });
      return;
    }
    const row = await prisma.investigationResult.update({
      where: { id },
      data: {
        acknowledgedBy: doctor?.name ?? req.user?.username ?? null,
        acknowledgedById: typeof req.user?.id === 'number' ? req.user.id : null,
        acknowledgedAt: new Date(),
      },
      select: { id: true, acknowledgedAt: true, acknowledgedBy: true },
    });
    await auditLog(req, { module: 'lab-radiology', action: 'ACK_RESULT', entityType: 'InvestigationResult', entityId: String(id), payload: { via: 'mobile' } });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[results:my-reports:ack] failed:', error);
    res.status(500).json({ error: 'Failed to acknowledge the result' });
  }
};
