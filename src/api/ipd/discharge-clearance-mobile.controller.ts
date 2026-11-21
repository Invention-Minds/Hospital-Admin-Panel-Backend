import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { ownDepartments } from '../../service/discharge-clearance-roles';
import { resolveWardScope } from '../_shared/nursing-roles';

/**
 * GET /api/ipd/my-clearances — the app's "Discharge clearances" work list.
 *
 * Only the departments the caller clears as their own job (nurses → NURSING,
 * dietitians / canteen → DIET, …). Nurses see their own wards only (same ward
 * scope as the nursing screens). Pending and not-cleared rows, oldest first,
 * with where the rest of the discharge stands.
 */
export const getMyClearances = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = typeof req.user?.id === 'number' ? req.user.id : undefined;
    const depts = await ownDepartments(userId);
    if (!depts.length) {
      res.status(200).json({ data: [], departments: [] });
      return;
    }
    const scope = depts.includes('NURSING') ? await resolveWardScope(userId) : null;
    const wardFilter = scope && !scope.unrestricted ? { wardId: { in: scope.wardIds } } : {};

    const rows = await prisma.dischargeClearance.findMany({
      where: {
        department: { in: depts },
        status: { in: ['pending', 'rejected'] },
        admission: {
          status: { notIn: ['discharged', 'LAMA', 'DAMA', 'expired'] },
          dischargeChainAbandoned: false,
          // Ward scope applies to the nursing rows only.
          ...(depts.length === 1 && depts[0] === 'NURSING' ? wardFilter : {}),
        },
      },
      include: {
        admission: {
          select: {
            id: true, admissionNo: true, prn: true, admittingDoctor: true, wardId: true,
            ward: { select: { wardName: true } }, bed: { select: { bedNumber: true } },
            dischargeReadyAt: true,
            discharge: { select: { summaryStatus: true, clinicianSignedAt: true } },
            dischargeClearances: { select: { department: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    // Mixed roles (rare): keep nursing rows inside the ward scope.
    const scoped = rows.filter((r) => r.department !== 'NURSING' || !scope || scope.unrestricted || (r.admission.wardId != null && scope.wardIds.includes(r.admission.wardId)));

    const prns = [...new Set(scoped.map((r) => Number(r.admission.prn)).filter(Number.isFinite))];
    const people = prns.length
      ? await prisma.patientDetails.findMany({ where: { prn: { in: prns } }, select: { prn: true, name: true, age: true, gender: true } })
      : [];
    const byPrn = new Map(people.map((p) => [String(p.prn), p]));

    res.status(200).json({
      departments: depts,
      data: scoped.map((r) => {
        const a = r.admission;
        const p = byPrn.get(String(a.prn));
        const all = a.dischargeClearances;
        return {
          id: r.id,
          admissionId: a.id,
          department: r.department,
          status: r.status,
          blockingReason: r.blockingReason,
          createdAt: r.createdAt,
          admissionNo: a.admissionNo,
          prn: a.prn,
          patientName: p?.name ?? null,
          ageSex: [p?.age, p?.gender].filter(Boolean).join(' ') || null,
          doctor: a.admittingDoctor,
          wardName: a.ward?.wardName ?? null,
          bedNumber: a.bed?.bedNumber ?? null,
          readyAt: a.dischargeReadyAt,
          summarySigned: !!a.discharge?.clinicianSignedAt,
          cleared: all.filter((c) => c.status === 'cleared').length,
          total: all.filter((c) => c.status !== 'cancelled').length,
        };
      }),
    });
  } catch (error) {
    console.error('[discharge-clearance] my-clearances failed:', error);
    res.status(500).json({ error: 'Failed to load your discharge clearances' });
  }
};
