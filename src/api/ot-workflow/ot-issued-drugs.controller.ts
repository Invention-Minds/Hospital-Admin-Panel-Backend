import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Phase 9.5d — View Issued Drugs (read-only).
//
// Wraps the existing OtConsumableIssue ledger with a presentation-optimised
// payload — sorted issued-vs-returned net per item — for the View Issued
// Drugs screen the reference HMIS surfaces from its OT workbench sidebar.
// Distinct from the Drugs & Consumables editor (which mutates the ledger):
// this endpoint is pure read.

export const getIssuedDrugsForSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const scheduleId = req.params.scheduleId;
    if (!scheduleId) { res.status(400).json({ message: 'scheduleId is required' }); return; }

    const rows = await prisma.otConsumableIssue.findMany({
      where: { scheduleId },
      orderBy: { issuedAt: 'asc' },
      select: {
        id: true,
        itemName: true,
        quantity: true,
        uom: true,
        itemRemarks: true,
        pharmacyStore: true,
        prescribedBy: true,
        direction: true,
        issuedAt: true,
        setId: true,
      },
    });

    // Aggregate net = issued - returned per item.
    const netMap = new Map<string, { itemName: string; uom: string | null; issued: number; returned: number }>();
    for (const r of rows) {
      const key = `${r.itemName}::${r.uom ?? ''}`;
      const cur = netMap.get(key) ?? { itemName: r.itemName, uom: r.uom ?? null, issued: 0, returned: 0 };
      if (r.direction === 'returned') cur.returned += r.quantity;
      else cur.issued += r.quantity;
      netMap.set(key, cur);
    }
    const summary = Array.from(netMap.values())
      .map((v) => ({ ...v, net: v.issued - v.returned }))
      .sort((a, b) => b.net - a.net);

    res.status(200).json({
      data: { rows, summary },
      meta: {
        totalLines: rows.length,
        distinctItems: summary.length,
        totalIssuedUnits: summary.reduce((a, b) => a + b.issued, 0),
        totalReturnedUnits: summary.reduce((a, b) => a + b.returned, 0),
      },
    });
  } catch (error) {
    console.error('[ot-issued-drugs] get failed:', error);
    res.status(500).json({ message: 'Failed to load issued drugs' });
  }
};
