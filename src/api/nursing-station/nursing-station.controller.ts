import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { isNurse } from '../_shared/nursing-roles';

/**
 * Phase NS-4 — Nursing Station admin.
 *
 * A NursingStation groups wards; nurses are mapped to stations; a nurse's
 * visible wards = union of wards across their stations (see resolveWardScope in
 * _shared/nursing-roles). These endpoints are owned by the Nursing
 * Superintendent (and super_admin) — write routes are gated with requireRole in
 * nursing-station.routes.ts.
 */

const STATION_TYPES = ['IPD', 'OPD'] as const;

interface StationBody {
  name?: string;
  code?: string;
  description?: string | null;
  type?: string;
  isActive?: boolean;
  wardIds?: string[];
}

// ─── List ────────────────────────────────────────────────────────────────

export const listStations = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeInactive = req.query.includeInactive === '1';
    const stations = await prisma.nursingStation.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: {
        wardLinks: {
          select: { ward: { select: { id: true, wardName: true, wardCode: true } } },
        },
        nurseLinks: {
          select: {
            user: { select: { id: true, username: true, fullName: true, employeeId: true } },
          },
        },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    // Flatten the join rows so the UI gets clean ward[] / nurse[] arrays.
    const data = stations.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      description: s.description,
      type: s.type,
      isActive: s.isActive,
      wards: s.wardLinks.map((l) => l.ward),
      nurses: s.nurseLinks.map((l) => l.user),
      wardCount: s.wardLinks.length,
      nurseCount: s.nurseLinks.length,
    }));
    res.status(200).json({ data });
  } catch (error) {
    console.error('[nursing-station] list failed:', error);
    res.status(500).json({ message: 'Failed to list nursing stations' });
  }
};

/**
 * GET /api/nursing-stations/mine — stations the logged-in nurse is assigned to.
 * Drives the "filter by my station/ward" dropdowns so a scoped nurse only sees
 * the stations + wards actually allotted to them.
 */
export const listMyStations = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (typeof userId !== 'number') {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    const stations = await prisma.nursingStation.findMany({
      where: { isActive: true, nurseLinks: { some: { userId } } },
      include: {
        wardLinks: {
          select: { ward: { select: { id: true, wardName: true, wardCode: true } } },
        },
      },
      orderBy: [{ name: 'asc' }],
    });
    const data = stations.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      description: s.description,
      type: s.type,
      isActive: s.isActive,
      wards: s.wardLinks.map((l) => l.ward),
      nurses: [],
    }));
    res.status(200).json({ data });
  } catch (error) {
    console.error('[nursing-station] listMine failed:', error);
    res.status(500).json({ message: 'Failed to list your nursing stations' });
  }
};

export const getStation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const s = await prisma.nursingStation.findUnique({
      where: { id },
      include: {
        wardLinks: {
          select: { ward: { select: { id: true, wardName: true, wardCode: true, department: true } } },
        },
        nurseLinks: {
          select: {
            user: { select: { id: true, username: true, fullName: true, employeeId: true, designation: true } },
          },
        },
      },
    });
    if (!s) {
      res.status(404).json({ message: 'Nursing station not found' });
      return;
    }
    res.status(200).json({
      data: {
        id: s.id,
        name: s.name,
        code: s.code,
        description: s.description,
        type: s.type,
        isActive: s.isActive,
        wards: s.wardLinks.map((l) => l.ward),
        nurses: s.nurseLinks.map((l) => l.user),
      },
    });
  } catch (error) {
    console.error('[nursing-station] get failed:', error);
    res.status(500).json({ message: 'Failed to load nursing station' });
  }
};

// ─── Create ──────────────────────────────────────────────────────────────

export const createStation = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as StationBody;
    if (!body.name?.trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }
    if (!body.code?.trim()) {
      res.status(400).json({ message: 'code is required' });
      return;
    }
    const code = body.code.trim().toUpperCase();
    const type = (body.type || 'IPD').toUpperCase();
    if (!STATION_TYPES.includes(type as (typeof STATION_TYPES)[number])) {
      res.status(400).json({ message: `type must be one of: ${STATION_TYPES.join(', ')}` });
      return;
    }
    const existing = await prisma.nursingStation.findUnique({ where: { code }, select: { id: true } });
    if (existing) {
      res.status(409).json({ message: 'A station with this code already exists' });
      return;
    }
    // OPD stations don't use wards; ignore any ward selection for them.
    const wardIds = type === 'OPD' ? [] : await validWardIds(body.wardIds);

    const station = await prisma.$transaction(async (tx) => {
      const created = await tx.nursingStation.create({
        data: {
          name: body.name!.trim(),
          code,
          description: body.description?.trim() || null,
          type,
          isActive: body.isActive ?? true,
          createdBy: req.user?.username ?? null,
        },
      });
      if (wardIds.length > 0) {
        await tx.nursingStationWard.createMany({
          data: wardIds.map((wardId) => ({ stationId: created.id, wardId })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    await auditLog(req, {
      module: 'nursing-station',
      action: 'CREATE',
      entityType: 'NursingStation',
      entityId: station.id,
      payload: { name: station.name, code: station.code, wardIds },
    });
    res.status(201).json({ data: station });
  } catch (error) {
    console.error('[nursing-station] create failed:', error);
    res.status(500).json({ message: 'Failed to create nursing station' });
  }
};

// ─── Update (name / description / isActive) ───────────────────────────────

export const updateStation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body as StationBody;
    const existing = await prisma.nursingStation.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      res.status(404).json({ message: 'Nursing station not found' });
      return;
    }
    let type: string | undefined;
    if (body.type !== undefined) {
      type = body.type.toUpperCase();
      if (!STATION_TYPES.includes(type as (typeof STATION_TYPES)[number])) {
        res.status(400).json({ message: `type must be one of: ${STATION_TYPES.join(', ')}` });
        return;
      }
    }
    const station = await prisma.nursingStation.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name?.trim() || undefined }),
        ...(body.description !== undefined && { description: body.description?.trim() || null }),
        ...(type !== undefined && { type }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        updatedBy: req.user?.username ?? null,
      },
    });
    // Switching a station to OPD clears its ward links (wards are N/A for OPD).
    if (type === 'OPD') {
      await prisma.nursingStationWard.deleteMany({ where: { stationId: id } });
    }
    await auditLog(req, {
      module: 'nursing-station',
      action: 'UPDATE',
      entityType: 'NursingStation',
      entityId: station.id,
      payload: { name: station.name, isActive: station.isActive },
    });
    res.status(200).json({ data: station });
  } catch (error) {
    console.error('[nursing-station] update failed:', error);
    res.status(500).json({ message: 'Failed to update nursing station' });
  }
};

export const deleteStation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.nursingStation.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      res.status(404).json({ message: 'Nursing station not found' });
      return;
    }
    // Hard delete — the ward/nurse join rows cascade (onDelete: Cascade).
    await prisma.nursingStation.delete({ where: { id } });
    await auditLog(req, {
      module: 'nursing-station',
      action: 'DELETE',
      entityType: 'NursingStation',
      entityId: id,
      payload: null,
    });
    res.status(204).send();
  } catch (error) {
    console.error('[nursing-station] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete nursing station' });
  }
};

// ─── Set the station's wards (replace the whole set) ───────────────────────

export const setStationWards = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body as { wardIds?: string[] };
    const existing = await prisma.nursingStation.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      res.status(404).json({ message: 'Nursing station not found' });
      return;
    }
    const wardIds = await validWardIds(body.wardIds);

    await prisma.$transaction(async (tx) => {
      await tx.nursingStationWard.deleteMany({ where: { stationId: id } });
      if (wardIds.length > 0) {
        await tx.nursingStationWard.createMany({
          data: wardIds.map((wardId) => ({ stationId: id, wardId })),
          skipDuplicates: true,
        });
      }
    });
    await auditLog(req, {
      module: 'nursing-station',
      action: 'SET_WARDS',
      entityType: 'NursingStation',
      entityId: id,
      payload: { wardIds },
    });
    res.status(200).json({ data: { id, wardIds } });
  } catch (error) {
    console.error('[nursing-station] set wards failed:', error);
    res.status(500).json({ message: 'Failed to set station wards' });
  }
};

// ─── Nurse ↔ station assignment ────────────────────────────────────────────

export const assignNurses = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body as { userIds?: number[]; userId?: number };
    const station = await prisma.nursingStation.findUnique({ where: { id }, select: { id: true } });
    if (!station) {
      res.status(404).json({ message: 'Nursing station not found' });
      return;
    }
    const requested = body.userIds ?? (body.userId !== undefined ? [body.userId] : []);
    const ids = Array.from(new Set(requested.filter((n) => Number.isInteger(n))));
    if (ids.length === 0) {
      res.status(400).json({ message: 'userIds (array) or userId is required' });
      return;
    }
    // Only nurse-type users can be mapped to a station.
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, subAdminType: true },
    });
    const nurseIds = users.filter((u) => isNurse(u.subAdminType)).map((u) => u.id);
    const rejected = ids.filter((i) => !nurseIds.includes(i));
    if (nurseIds.length > 0) {
      await prisma.nurseStationAssignment.createMany({
        data: nurseIds.map((userId) => ({ userId, stationId: id, createdBy: req.user?.username ?? null })),
        skipDuplicates: true,
      });
    }
    await auditLog(req, {
      module: 'nursing-station',
      action: 'ASSIGN_NURSES',
      entityType: 'NursingStation',
      entityId: id,
      payload: { assigned: nurseIds, rejected },
    });
    res.status(200).json({ data: { stationId: id, assigned: nurseIds, rejectedNonNurse: rejected } });
  } catch (error) {
    console.error('[nursing-station] assign nurses failed:', error);
    res.status(500).json({ message: 'Failed to assign nurses' });
  }
};

export const unassignNurse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, userId } = req.params;
    const uid = Number(userId);
    if (Number.isNaN(uid)) {
      res.status(400).json({ message: 'Invalid userId' });
      return;
    }
    await prisma.nurseStationAssignment.deleteMany({ where: { stationId: id, userId: uid } });
    await auditLog(req, {
      module: 'nursing-station',
      action: 'UNASSIGN_NURSE',
      entityType: 'NursingStation',
      entityId: id,
      payload: { userId: uid },
    });
    res.status(204).send();
  } catch (error) {
    console.error('[nursing-station] unassign nurse failed:', error);
    res.status(500).json({ message: 'Failed to unassign nurse' });
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Keep only ward ids that actually exist; silently drop unknown ids. */
async function validWardIds(input: string[] | undefined): Promise<string[]> {
  const ids = Array.from(new Set((input ?? []).filter((s) => typeof s === 'string' && s.length > 0)));
  if (ids.length === 0) return [];
  const wards = await prisma.ipdWard.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return wards.map((w) => w.id);
}
