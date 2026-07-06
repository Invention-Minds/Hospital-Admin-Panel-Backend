import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

// Phase 9.26 / Phase 5g — Pharmacy critical drug master + stock event log.
// Backs OPS-003 (stock-out rate) and OPS-004 (expired drug rate).

const EVENT_TYPES = ['stock_out', 'expired'] as const;

const username = (req: Request): string | null => req.user?.username ?? null;
const userId = (req: Request): number | null => (typeof req.user?.id === 'number' ? req.user.id : null);

// ─── Critical drug master ──────────────────────────────────────────────

interface DrugBody {
  code?: string;
  name?: string;
  category?: string | null;
  isCritical?: boolean;
}

export const createDrug = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as DrugBody;
    if (!body.code || !body.code.trim()) { res.status(400).json({ message: "'code' is required" }); return; }
    if (!body.name || !body.name.trim()) { res.status(400).json({ message: "'name' is required" }); return; }
    const row = await prisma.pharmacyCriticalDrug.create({
      data: {
        code: body.code.trim(), name: body.name.trim(),
        category: body.category ?? null,
        isCritical: body.isCritical !== false,
      },
    });
    await auditLog(req, {
      module: 'pharmacy-critical-drug', action: 'CREATE', entityType: 'PharmacyCriticalDrug',
      entityId: row.id, payload: { code: row.code, isCritical: row.isCritical },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[pharmacy-drug] create failed:', error);
    res.status(500).json({ message: 'Failed to add drug' });
  }
};

export const listDrugs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { isCritical, search } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (isCritical === 'true') where['isCritical'] = true;
    if (isCritical === 'false') where['isCritical'] = false;
    if (search) where['OR'] = [{ code: { contains: search } }, { name: { contains: search } }];
    const rows = await prisma.pharmacyCriticalDrug.findMany({ where, orderBy: { code: 'asc' }, take: 1000 });
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[pharmacy-drug] list failed:', error);
    res.status(500).json({ message: 'Failed to load drugs' });
  }
};

export const updateDrug = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const ex = await prisma.pharmacyCriticalDrug.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Drug not found' }); return; }
    const body = (req.body ?? {}) as DrugBody;
    const data: Record<string, unknown> = {};
    if (typeof body.name === 'string') data['name'] = body.name.trim();
    if (body.category !== undefined) data['category'] = body.category;
    if (typeof body.isCritical === 'boolean') data['isCritical'] = body.isCritical;
    const row = await prisma.pharmacyCriticalDrug.update({ where: { id }, data });
    await auditLog(req, {
      module: 'pharmacy-critical-drug', action: 'UPDATE', entityType: 'PharmacyCriticalDrug',
      entityId: id, payload: data,
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[pharmacy-drug] update failed:', error);
    res.status(500).json({ message: 'Failed to update drug' });
  }
};

export const deleteDrug = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const ex = await prisma.pharmacyCriticalDrug.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Drug not found' }); return; }
    await prisma.pharmacyCriticalDrug.delete({ where: { id } });
    await auditLog(req, {
      module: 'pharmacy-critical-drug', action: 'DELETE', entityType: 'PharmacyCriticalDrug',
      entityId: id, payload: { code: ex.code },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[pharmacy-drug] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete drug' });
  }
};

// ─── Stock events (stock-out + expired) ────────────────────────────────

interface StockEventBody {
  drugId?: string | null;
  eventType?: string;
  occurredAt?: string;
  batchCode?: string | null;
  expiryDate?: string | null;
  quantity?: number | null;
  notes?: string | null;
}

export const createStockEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as StockEventBody;
    if (!body.eventType || !EVENT_TYPES.includes(body.eventType as typeof EVENT_TYPES[number])) {
      res.status(400).json({ message: `'eventType' must be one of: ${EVENT_TYPES.join(', ')}` });
      return;
    }
    let drugCodeSnap: string | null = null;
    let drugNameSnap: string | null = null;
    if (body.drugId) {
      const drug = await prisma.pharmacyCriticalDrug.findUnique({
        where: { id: body.drugId }, select: { code: true, name: true },
      });
      if (!drug) { res.status(404).json({ message: 'Drug not found' }); return; }
      drugCodeSnap = drug.code;
      drugNameSnap = drug.name;
    }

    const row = await prisma.pharmacyStockEvent.create({
      data: {
        drugId: body.drugId ?? null,
        drugCodeSnapshot: drugCodeSnap,
        drugNameSnapshot: drugNameSnap,
        eventType: body.eventType,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        batchCode: body.batchCode ?? null,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        quantity: typeof body.quantity === 'number' ? body.quantity : null,
        notes: body.notes ?? null,
        reporter: username(req), reporterId: userId(req),
      },
    });
    await auditLog(req, {
      module: 'pharmacy-stock', action: 'CREATE', entityType: 'PharmacyStockEvent',
      entityId: String(row.id),
      payload: { eventType: row.eventType, drugId: row.drugId },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[pharmacy-stock] create failed:', error);
    res.status(500).json({ message: 'Failed to record event' });
  }
};

export const listStockEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventType, from, to, drugId } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (eventType) where['eventType'] = eventType;
    if (drugId) where['drugId'] = drugId;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range['gte'] = new Date(from);
      if (to) range['lte'] = new Date(to);
      where['occurredAt'] = range;
    }
    const rows = await prisma.pharmacyStockEvent.findMany({
      where, orderBy: { occurredAt: 'desc' }, take: 500,
    });
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[pharmacy-stock] list failed:', error);
    res.status(500).json({ message: 'Failed to load events' });
  }
};

export const deleteStockEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const ex = await prisma.pharmacyStockEvent.findUnique({ where: { id } });
    if (!ex) { res.status(404).json({ message: 'Event not found' }); return; }
    await prisma.pharmacyStockEvent.delete({ where: { id } });
    await auditLog(req, {
      module: 'pharmacy-stock', action: 'DELETE', entityType: 'PharmacyStockEvent',
      entityId: String(id), payload: { eventType: ex.eventType },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[pharmacy-stock] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete event' });
  }
};
