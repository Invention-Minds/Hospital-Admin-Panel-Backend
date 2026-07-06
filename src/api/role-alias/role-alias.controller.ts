import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';
import { invalidateRoleAliasCache } from '../../service/role-alias';

// Phase 6 / Batch A — CRUD for the notification target-role alias table.

interface UpsertBody {
  alias?: string;
  targetRole?: string;
  isActive?: boolean;
  notes?: string | null;
}

export const listAliases = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.roleAlias.findMany({ orderBy: { alias: 'asc' } });
    res.status(200).json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[role-alias] list failed:', error);
    res.status(500).json({ message: 'Failed to load aliases' });
  }
};

export const createAlias = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = (req.body ?? {}) as UpsertBody;
    if (!body.alias || !body.alias.trim()) { res.status(400).json({ message: "'alias' is required" }); return; }
    if (!body.targetRole || !body.targetRole.trim()) { res.status(400).json({ message: "'targetRole' is required" }); return; }
    const row = await prisma.roleAlias.create({
      data: {
        alias: body.alias.trim(),
        targetRole: body.targetRole.trim(),
        isActive: body.isActive !== false,
        notes: body.notes ?? null,
      },
    });
    invalidateRoleAliasCache();
    await auditLog(req, {
      module: 'role-alias', action: 'CREATE', entityType: 'RoleAlias',
      entityId: String(row.id),
      payload: { alias: row.alias, targetRole: row.targetRole },
    });
    res.status(201).json({ data: row });
  } catch (error) {
    console.error('[role-alias] create failed:', error);
    res.status(500).json({ message: 'Failed to create alias' });
  }
};

export const updateAlias = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.roleAlias.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Alias not found' }); return; }

    const body = (req.body ?? {}) as UpsertBody;
    const data: Record<string, unknown> = {};
    if (typeof body.targetRole === 'string') data['targetRole'] = body.targetRole.trim();
    if (typeof body.isActive === 'boolean') data['isActive'] = body.isActive;
    if (body.notes !== undefined) data['notes'] = body.notes;
    if (Object.keys(data).length === 0) { res.status(400).json({ message: 'No editable fields provided' }); return; }

    const row = await prisma.roleAlias.update({ where: { id }, data });
    invalidateRoleAliasCache();
    await auditLog(req, {
      module: 'role-alias', action: 'UPDATE', entityType: 'RoleAlias',
      entityId: String(id),
      payload: { alias: existing.alias, ...data },
    });
    res.status(200).json({ data: row });
  } catch (error) {
    console.error('[role-alias] update failed:', error);
    res.status(500).json({ message: 'Failed to update alias' });
  }
};

export const deleteAlias = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: 'Invalid id' }); return; }
    const existing = await prisma.roleAlias.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ message: 'Alias not found' }); return; }
    await prisma.roleAlias.delete({ where: { id } });
    invalidateRoleAliasCache();
    await auditLog(req, {
      module: 'role-alias', action: 'DELETE', entityType: 'RoleAlias',
      entityId: String(id),
      payload: { alias: existing.alias },
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[role-alias] delete failed:', error);
    res.status(500).json({ message: 'Failed to delete alias' });
  }
};
