import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

/**
 * Get all wards with real-time bed census
 * Supports ?department=X filter
 */
export const getAllWards = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { department } = req.query;
    const where: any = {};
    if (department) where.department = department;

    const wards = await prisma.ipdWard.findMany({
      where,
      include: {
        beds: {
          select: {
            id: true,
            bedNumber: true,
            status: true,
            bedType: true,
          },
        },
      },
      orderBy: { wardName: 'asc' },
    });

    const wardsWithCensus = wards.map((ward) => {
      const occupiedBeds = ward.beds.filter((b) => b.status === 'occupied').length;
      const availableBeds = ward.beds.filter((b) => b.status === 'available').length;
      return {
        ...ward,
        occupiedBeds,
        availableBeds,
        censusPercentage: ward.totalBeds ? Math.round((occupiedBeds / ward.totalBeds) * 100) : 0,
      };
    });

    res.status(200).json({
      message: 'Wards retrieved with bed census',
      data: wardsWithCensus,
    });
  } catch (error) {
    console.error('Error fetching wards:', error);
    res.status(500).json({
      message: 'Error fetching wards',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get ward details with all beds
 */
export const getWardDetails = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { wardId } = req.params;

    const ward = await prisma.ipdWard.findUnique({
      where: { id: wardId },
      include: {
        beds: {
          include: {
            admissions: {
              where: { status: 'admitted' },
              select: {
                id: true,
                prn: true,
                admittingDoctor: true,
                admissionDate: true,
              },
            },
          },
          orderBy: { bedNumber: 'asc' },
        },
      },
    });

    if (!ward) {
      res.status(404).json({ message: 'Ward not found' });
      return;
    }

    const occupiedBeds = ward.beds.filter((b) => b.status === 'occupied').length;
    const availableBeds = ward.beds.filter((b) => b.status === 'available').length;

    res.status(200).json({
      message: 'Ward details retrieved',
      data: {
        ...ward,
        occupiedBeds,
        availableBeds,
        censusPercentage: ward.totalBeds ? Math.round((occupiedBeds / ward.totalBeds) * 100) : 0,
      },
    });
  } catch (error) {
    console.error('Error fetching ward details:', error);
    res.status(500).json({
      message: 'Error fetching ward details',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Create new ward
 */
export const createWard = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { wardName, wardCode, floor, department, totalBeds } = req.body;

    if (!wardName || !wardCode || !department || !totalBeds) {
      res.status(400).json({
        message: 'Missing required fields: wardName, wardCode, department, totalBeds',
      });
      return;
    }

    const existing = await prisma.ipdWard.findUnique({ where: { wardCode } });
    if (existing) {
      res.status(409).json({ message: 'Ward code already exists' });
      return;
    }

    const ward = await prisma.ipdWard.create({
      data: { wardName, wardCode, floor, department, totalBeds },
    });

    res.status(201).json({ message: 'Ward created successfully', data: ward });
  } catch (error) {
    console.error('Error creating ward:', error);
    res.status(500).json({
      message: 'Error creating ward',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Update ward
 */
export const updateWard = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { wardId } = req.params;
    const { wardName, floor, department, totalBeds, hmisWardId } = req.body;

    const updated = await prisma.ipdWard.update({
      where: { id: wardId },
      data: {
        ...(wardName !== undefined && { wardName }),
        ...(floor !== undefined && { floor }),
        ...(department !== undefined && { department }),
        ...(totalBeds !== undefined && { totalBeds }),
        ...(hmisWardId !== undefined && { hmisWardId }),
      },
    });

    res.status(200).json({ message: 'Ward updated successfully', data: updated });
  } catch (error) {
    console.error('Error updating ward:', error);
    res.status(500).json({
      message: 'Error updating ward',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get all beds (filtered by wardId, bedType, status)
 */
export const getAllBeds = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { wardId, bedType, status } = req.query;
    const where: any = {};
    if (wardId) where.wardId = wardId;
    if (bedType) where.bedType = bedType;
    if (status) where.status = status;

    const beds = await prisma.ipdBed.findMany({
      where,
      include: {
        ward: { select: { id: true, wardName: true, wardCode: true } },
        admissions: {
          where: { status: 'admitted' },
          select: { id: true, prn: true, admissionNo: true, admittingDoctor: true },
        },
      },
      orderBy: { bedNumber: 'asc' },
    });

    res.status(200).json({ message: 'Beds retrieved', data: beds });
  } catch (error) {
    console.error('Error fetching beds:', error);
    res.status(500).json({
      message: 'Error fetching beds',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get bed by ID
 */
export const getBedById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bedId } = req.params;

    const bed = await prisma.ipdBed.findUnique({
      where: { id: bedId },
      include: {
        ward: true,
        admissions: {
          where: { status: 'admitted' },
          take: 1,
        },
      },
    });

    if (!bed) {
      res.status(404).json({ message: 'Bed not found' });
      return;
    }

    res.status(200).json({ message: 'Bed retrieved', data: bed });
  } catch (error) {
    console.error('Error fetching bed:', error);
    res.status(500).json({
      message: 'Error fetching bed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get available beds by ward / bedType
 */
export const getAvailableBeds = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { wardId, bedType } = req.query;

    const where: any = { status: 'available' };
    if (wardId) where.wardId = wardId;
    if (bedType) where.bedType = bedType;

    const availableBeds = await prisma.ipdBed.findMany({
      where,
      include: { ward: true },
      orderBy: { bedNumber: 'asc' },
    });

    res.status(200).json({ message: 'Available beds retrieved', data: availableBeds });
  } catch (error) {
    console.error('Error fetching available beds:', error);
    res.status(500).json({
      message: 'Error fetching available beds',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Update bed status
 */
export const updateBedStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bedId } = req.params;
    const { status } = req.body;

    const validStatuses = ['available', 'occupied', 'maintenance', 'reserved'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ message: 'Invalid bed status' });
      return;
    }

    const bed = await prisma.ipdBed.update({
      where: { id: bedId },
      data: { status },
      include: { ward: true },
    });

    res.status(200).json({ message: 'Bed status updated successfully', data: bed });
  } catch (error) {
    console.error('Error updating bed status:', error);
    res.status(500).json({
      message: 'Error updating bed status',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Full bed update — used by the unified Masters admin page to rename a bed
// (bedNumber) or change its bedType. Status updates remain on /bed/:id/status
// so the active-admission lifecycle isn't disturbed by a cosmetic rename.
export const updateBed = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bedId } = req.params;
    const { bedNumber, bedType } = req.body;
    if (!bedNumber?.trim() || !bedType?.trim()) {
      res.status(400).json({ message: 'bedNumber and bedType are required' });
      return;
    }
    if (!['general', 'ICU', 'HDU', 'isolation'].includes(bedType)) {
      res.status(400).json({ message: 'bedType must be one of: general, ICU, HDU, isolation' });
      return;
    }
    const existing = await prisma.ipdBed.findUnique({ where: { id: bedId } });
    if (!existing) {
      res.status(404).json({ message: 'Bed not found' });
      return;
    }
    // Guard the unique (wardId, bedNumber) — re-numbering shouldn't collide.
    const clash = await prisma.ipdBed.findFirst({
      where: { wardId: existing.wardId, bedNumber: bedNumber.trim(), NOT: { id: bedId } },
    });
    if (clash) {
      res.status(409).json({ message: `Bed "${bedNumber}" already exists in this ward` });
      return;
    }
    const bed = await prisma.ipdBed.update({
      where: { id: bedId },
      data: { bedNumber: bedNumber.trim(), bedType },
      include: { ward: true },
    });
    res.status(200).json({ message: 'Bed updated', data: bed });
  } catch (error) {
    console.error('Error updating bed:', error);
    res.status(500).json({
      message: 'Error updating bed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Create beds for a ward
 * Accepts either { beds: [{bedNumber, bedType}, ...] } or { bedCount, bedTypes }
 */
export const createBedsForWard = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { wardId } = req.params;
    const { beds, bedCount, bedTypes } = req.body;

    const ward = await prisma.ipdWard.findUnique({ where: { id: wardId } });
    if (!ward) {
      res.status(404).json({ message: 'Ward not found' });
      return;
    }

    let bedsToCreate: Array<{ bedNumber: string; bedType: string }> = [];

    if (Array.isArray(beds) && beds.length > 0) {
      bedsToCreate = beds.map((b: any) => ({
        bedNumber: b.bedNumber,
        bedType: b.bedType || 'general',
      }));
    } else if (bedCount && Array.isArray(bedTypes)) {
      for (let i = 1; i <= bedCount; i++) {
        bedsToCreate.push({
          bedNumber: `${ward.wardCode}-${String(i).padStart(3, '0')}`,
          bedType: bedTypes[i - 1] || bedTypes[0] || 'general',
        });
      }
    } else {
      res.status(400).json({ message: 'Provide beds array or bedCount+bedTypes' });
      return;
    }

    const created = await prisma.ipdBed.createMany({
      data: bedsToCreate.map((b) => ({
        wardId,
        bedNumber: b.bedNumber,
        bedType: b.bedType,
        status: 'available',
      })),
    });

    res.status(201).json({
      message: `${created.count} beds created successfully`,
      data: { count: created.count },
    });
  } catch (error) {
    console.error('Error creating beds:', error);
    res.status(500).json({
      message: 'Error creating beds',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get real-time bed census (array of wards with bed breakdown)
 * Optional ?wardId=X for a specific ward
 */
export const getBedCensus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { wardId } = req.query;

    if (wardId) {
      const ward = await prisma.ipdWard.findUnique({
        where: { id: wardId as string },
        include: {
          beds: {
            include: {
              admissions: {
                where: { status: 'admitted' },
                select: { id: true, prn: true, admissionNo: true },
                take: 1,
              },
            },
          },
        },
      });

      if (!ward) {
        res.status(404).json({ message: 'Ward not found' });
        return;
      }

      const occupied = ward.beds.filter((b) => b.status === 'occupied').length;
      const available = ward.beds.filter((b) => b.status === 'available').length;

      res.status(200).json({
        message: 'Ward census retrieved',
        data: {
          wardId: ward.id,
          wardName: ward.wardName,
          totalBeds: ward.totalBeds,
          occupiedBeds: occupied,
          availableBeds: available,
          occupancyRate: ward.totalBeds ? Math.round((occupied / ward.totalBeds) * 100) : 0,
          beds: ward.beds,
        },
      });
      return;
    }

    const wards = await prisma.ipdWard.findMany({
      include: {
        beds: {
          include: {
            admissions: {
              where: { status: 'admitted' },
              select: { id: true, prn: true, admissionNo: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { wardName: 'asc' },
    });

    const census = wards.map((ward) => {
      const occupied = ward.beds.filter((b) => b.status === 'occupied').length;
      const available = ward.beds.filter((b) => b.status === 'available').length;
      return {
        wardId: ward.id,
        wardName: ward.wardName,
        totalBeds: ward.totalBeds,
        occupiedBeds: occupied,
        availableBeds: available,
        occupancyRate: ward.totalBeds ? Math.round((occupied / ward.totalBeds) * 100) : 0,
        beds: ward.beds,
      };
    });

    res.status(200).json({ message: 'Bed census retrieved', data: census });
  } catch (error) {
    console.error('Error fetching bed census:', error);
    res.status(500).json({
      message: 'Error fetching bed census',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get bed census report (flat summary report)
 * Optional ?fromDate&toDate for historical data — currently returns real-time
 */
export const getBedCensusReport = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const wards = await prisma.ipdWard.findMany({
      include: { beds: { select: { status: true, bedType: true } } },
    });

    const report = wards.map((ward) => {
      const occupied = ward.beds.filter((b) => b.status === 'occupied').length;
      const available = ward.beds.filter((b) => b.status === 'available').length;
      const maintenance = ward.beds.filter((b) => b.status === 'maintenance').length;
      const reserved = ward.beds.filter((b) => b.status === 'reserved').length;

      return {
        wardName: ward.wardName,
        wardCode: ward.wardCode,
        department: ward.department,
        totalBeds: ward.totalBeds,
        occupiedBeds: occupied,
        availableBeds: available,
        maintenanceBeds: maintenance,
        reservedBeds: reserved,
        occupancyRate: ward.totalBeds ? `${Math.round((occupied / ward.totalBeds) * 100)}%` : '0%',
      };
    });

    res.status(200).json({ message: 'Bed census report retrieved', data: report });
  } catch (error) {
    console.error('Error fetching bed census report:', error);
    res.status(500).json({
      message: 'Error fetching bed census report',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get occupancy trends over the last N days (default 30)
 * Uses IpdAdmission.admissionDate + IpdDischarge.dischargeDate
 */
export const getOccupancyTrends = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const days = parseInt((req.query.days as string) || '30');
    const totalBedsAgg = await prisma.ipdWard.aggregate({ _sum: { totalBeds: true } });
    const totalBeds = totalBedsAgg._sum.totalBeds || 0;

    const trends: Array<{ date: string; occupied: number; occupancyRate: number }> = [];
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      day.setHours(23, 59, 59, 999);

      const occupied = await prisma.ipdAdmission.count({
        where: {
          admissionDate: { lte: day },
          OR: [
            { status: 'admitted' },
            { discharge: { dischargeDate: { gt: day } } },
          ],
        },
      });

      trends.push({
        date: day.toISOString().split('T')[0],
        occupied,
        occupancyRate: totalBeds ? Math.round((occupied / totalBeds) * 100) : 0,
      });
    }

    res.status(200).json({ message: 'Occupancy trends retrieved', data: trends });
  } catch (error) {
    console.error('Error fetching occupancy trends:', error);
    res.status(500).json({
      message: 'Error fetching occupancy trends',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Reserve a bed
 */
export const reserveBed = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bedId } = req.params;
    const { reason } = req.body;

    const bed = await prisma.ipdBed.findUnique({ where: { id: bedId } });
    if (!bed) {
      res.status(404).json({ message: 'Bed not found' });
      return;
    }
    if (bed.status === 'occupied') {
      res.status(409).json({ message: 'Bed is currently occupied' });
      return;
    }

    const updated = await prisma.ipdBed.update({
      where: { id: bedId },
      data: { status: 'reserved' },
    });

    res.status(200).json({ message: 'Bed reserved', data: updated, reason });
  } catch (error) {
    console.error('Error reserving bed:', error);
    res.status(500).json({
      message: 'Error reserving bed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Cancel bed reservation
 */
export const cancelBedReservation = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bedId } = req.params;

    const bed = await prisma.ipdBed.findUnique({ where: { id: bedId } });
    if (!bed) {
      res.status(404).json({ message: 'Bed not found' });
      return;
    }
    if (bed.status !== 'reserved') {
      res.status(400).json({ message: 'Bed is not reserved' });
      return;
    }

    const updated = await prisma.ipdBed.update({
      where: { id: bedId },
      data: { status: 'available' },
    });

    res.status(200).json({ message: 'Bed reservation cancelled', data: updated });
  } catch (error) {
    console.error('Error cancelling reservation:', error);
    res.status(500).json({
      message: 'Error cancelling reservation',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Mark bed for maintenance
 */
export const markBedMaintenance = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bedId } = req.params;
    const { maintenanceNote } = req.body;

    const updated = await prisma.ipdBed.update({
      where: { id: bedId },
      data: { status: 'maintenance' },
    });

    res.status(200).json({
      message: 'Bed marked for maintenance',
      data: updated,
      maintenanceNote,
    });
  } catch (error) {
    console.error('Error marking bed maintenance:', error);
    res.status(500).json({
      message: 'Error marking bed maintenance',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Complete bed maintenance
 */
export const completeBedMaintenance = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { bedId } = req.params;

    const bed = await prisma.ipdBed.findUnique({ where: { id: bedId } });
    if (!bed) {
      res.status(404).json({ message: 'Bed not found' });
      return;
    }
    if (bed.status !== 'maintenance') {
      res.status(400).json({ message: 'Bed is not under maintenance' });
      return;
    }

    const updated = await prisma.ipdBed.update({
      where: { id: bedId },
      data: { status: 'available' },
    });

    res.status(200).json({ message: 'Maintenance completed', data: updated });
  } catch (error) {
    console.error('Error completing maintenance:', error);
    res.status(500).json({
      message: 'Error completing maintenance',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Ward statistics
 */
export const getWardStats = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const [totalWards, bedAgg, occupied, available, maintenance, reserved] = await Promise.all([
      prisma.ipdWard.count(),
      prisma.ipdWard.aggregate({ _sum: { totalBeds: true } }),
      prisma.ipdBed.count({ where: { status: 'occupied' } }),
      prisma.ipdBed.count({ where: { status: 'available' } }),
      prisma.ipdBed.count({ where: { status: 'maintenance' } }),
      prisma.ipdBed.count({ where: { status: 'reserved' } }),
    ]);

    const totalBeds = bedAgg._sum.totalBeds || 0;

    res.status(200).json({
      message: 'Ward statistics retrieved',
      data: {
        totalWards,
        totalBeds,
        occupiedBeds: occupied,
        availableBeds: available,
        maintenanceBeds: maintenance,
        reservedBeds: reserved,
        occupancyRate: totalBeds ? Math.round((occupied / totalBeds) * 100) : 0,
      },
    });
  } catch (error) {
    console.error('Error fetching ward stats:', error);
    res.status(500).json({
      message: 'Error fetching ward stats',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get bed census snapshot for a given date (Sprint 4a Phase 1e).
 * Reads historical per-ward rows from BedCensusSnapshot. Returns 404 if no
 * snapshot exists for the requested date (e.g. before this feature shipped,
 * or if the cron missed a day).
 */
export const getBedCensusSnapshot = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { date } = req.query;
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ message: 'Query param `date` required in YYYY-MM-DD format' });
      return;
    }

    // Reconstruct local-midnight Date the same way the generator stores it.
    const [y, m, d] = date.split('-').map((v) => parseInt(v, 10));
    const snapshotDate = new Date(y, m - 1, d, 0, 0, 0, 0);

    const rows = await prisma.bedCensusSnapshot.findMany({
      where: { snapshotDate },
      orderBy: { wardName: 'asc' },
    });

    if (rows.length === 0) {
      res.status(404).json({
        message: 'No bed-census snapshot found for the requested date',
        data: { date, rows: [] },
      });
      return;
    }

    // snapshotTime is identical across all rows in one run (per cron tick).
    const snapshotTime = rows[0].snapshotTime;

    const census = rows.map((r) => ({
      wardId: r.wardId,
      wardName: r.wardName,
      wardCode: r.wardCode,
      department: r.department,
      totalBeds: r.totalBeds,
      occupiedBeds: r.occupiedBeds,
      availableBeds: r.availableBeds,
      maintenanceBeds: r.maintenanceBeds,
      reservedBeds: r.reservedBeds,
      generalBeds: r.generalBeds,
      icuBeds: r.icuBeds,
      hduBeds: r.hduBeds,
      isolationBeds: r.isolationBeds,
      occupancyRate: r.totalBeds ? Math.round((r.occupiedBeds / r.totalBeds) * 100) : 0,
    }));

    res.status(200).json({
      message: 'Bed census snapshot retrieved',
      data: {
        date,
        snapshotTime,
        snapshotReason: rows[0].snapshotReason,
        wards: census,
      },
    });
  } catch (error) {
    console.error('Error fetching bed census snapshot:', error);
    res.status(500).json({
      message: 'Error fetching bed census snapshot',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Download bed census report as CSV
 */
export const downloadBedCensusReport = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const wards = await prisma.ipdWard.findMany({
      include: { beds: { select: { status: true, bedType: true } } },
    });

    const headers = ['Ward Name', 'Ward Code', 'Department', 'Total Beds', 'Occupied', 'Available', 'Maintenance', 'Reserved', 'Occupancy Rate'];
    const rows = wards.map((w) => {
      const occupied = w.beds.filter((b) => b.status === 'occupied').length;
      const available = w.beds.filter((b) => b.status === 'available').length;
      const maintenance = w.beds.filter((b) => b.status === 'maintenance').length;
      const reserved = w.beds.filter((b) => b.status === 'reserved').length;
      const rate = w.totalBeds ? `${Math.round((occupied / w.totalBeds) * 100)}%` : '0%';
      return [w.wardName, w.wardCode, w.department, w.totalBeds, occupied, available, maintenance, reserved, rate];
    });

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bed-census-report.csv"');
    res.status(200).send(csv);
  } catch (error) {
    console.error('Error downloading census report:', error);
    res.status(500).json({
      message: 'Error downloading census report',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
