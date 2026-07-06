import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { auditLog } from '../../service/app-audit';

/**
 * NOTE TEMPLATES — department-scoped form layouts.
 *
 * One template defines the field set that renders on a specific
 * `(department, noteType)` form. Doctor picks at write time; the snapshot of
 * the field defs travels with the signed record so future edits to the live
 * template never mutate signed evidence.
 *
 * Endpoints (all behind authenticateToken; only super_admin can write):
 *   GET    /api/note-template                 — list (filterable)
 *   GET    /api/note-template/active           — for the doctor screen: returns
 *                                                 templates a doctor can pick
 *                                                 (filtered by department + noteType)
 *   GET    /api/note-template/:id             — full row with parsed fields
 *   POST   /api/note-template                 — create
 *   PUT    /api/note-template/:id             — replace (rename, edit fields, etc.)
 *   POST   /api/note-template/:id/set-default — exclusive default flag toggle
 *   POST   /api/note-template/:id/clone       — duplicate (with " (copy)" suffix)
 *   DELETE /api/note-template/:id             — soft-delete via isActive=false
 */

const VALID_NOTE_TYPES = ['discharge', 'opd-handwritten', 'opd-doctor', 'diet-plan'];
const VALID_FIELD_TYPES = [
  'text', 'textarea', 'number', 'date', 'datetime',
  'select', 'multiselect', 'checkbox', 'radio',
  'handwritten', // option C — canvas widget for OPD
];

interface FieldDef {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  helpText?: string;
  placeholder?: string;
  group?: string;
  order?: number;
}

interface CreateBody {
  name: string;
  noteType: string;
  department: string;
  fields: FieldDef[];
  isActive?: boolean;
  isDefault?: boolean;
  // Phase 9.21 — 'mine' makes a personal (doctor-scoped) template; 'department'
  // (or omitted) keeps the shared department-level behavior.
  scope?: 'mine' | 'department';
}

/** Resolve the current user → their Doctor.id (null if the user isn't a doctor). */
async function resolveDoctorId(req: Request): Promise<number | null> {
  const userId = typeof req.user?.id === 'number' ? req.user.id : null;
  if (userId == null) return null;
  const doc = await prisma.doctor.findFirst({ where: { userId }, select: { id: true } });
  return doc?.id ?? null;
}

/**
 * Phase 9.21 — ownership gate for write paths. A doctor (resolveDoctorId != null)
 * may only touch their OWN personal templates; super_admin/admin (no Doctor row)
 * keep full access to everything. Returns true if the write may proceed; on a
 * violation it sends the 403 and returns false (caller does `if (!ok) return;`).
 *
 * The JWT carries no role claim, so we infer "is a doctor" from the presence of
 * a Doctor row for this user — the same signal `scope: 'mine'` already uses.
 */
async function assertCanWrite(
  req: Request,
  res: Response,
  target: { doctorId: number | null },
): Promise<boolean> {
  const callerDoctorId = await resolveDoctorId(req);
  if (callerDoctorId == null) return true; // not a doctor → admin, full access
  if (target.doctorId !== callerDoctorId) {
    res.status(403).json({ error: 'You can only modify your own personal templates' });
    return false;
  }
  return true;
}

/** Validate a fields[] payload — returns null on success, error string on failure. */
function validateFields(fields: unknown): string | null {
  if (!Array.isArray(fields)) return 'fields must be an array';
  if (fields.length === 0) return 'fields cannot be empty — add at least one';
  if (fields.length > 200) return 'fields capped at 200 per template';
  const keys = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] as FieldDef;
    if (!f || typeof f !== 'object') return `fields[${i}] is not an object`;
    if (!f.key || typeof f.key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.key)) {
      return `fields[${i}].key must be a non-empty identifier (a-z, A-Z, 0-9, _)`;
    }
    if (keys.has(f.key)) return `fields[${i}].key="${f.key}" is duplicated`;
    keys.add(f.key);
    if (!f.label || typeof f.label !== 'string') return `fields[${i}].label is required`;
    if (!f.type || !VALID_FIELD_TYPES.includes(f.type)) {
      return `fields[${i}].type must be one of: ${VALID_FIELD_TYPES.join(', ')}`;
    }
    const needsOptions = ['select', 'multiselect', 'radio'].includes(f.type);
    if (needsOptions && (!Array.isArray(f.options) || f.options.length === 0)) {
      return `fields[${i}].options is required for type=${f.type}`;
    }
  }
  return null;
}

/** Common shape: parse `fields` LongText back into a typed array for clients. */
function withParsedFields<T extends { fields: string }>(row: T): Omit<T, 'fields'> & { fields: FieldDef[] } {
  let parsed: FieldDef[] = [];
  try { parsed = JSON.parse(row.fields); } catch { parsed = []; }
  return { ...row, fields: parsed };
}

// ─── List / filter ───────────────────────────────────────────────────

export const listTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const noteType = req.query.noteType as string | undefined;
    const department = req.query.department as string | undefined;
    const isActiveQ = req.query.isActive as string | undefined;

    const rows = await prisma.noteTemplate.findMany({
      where: {
        ...(noteType && { noteType }),
        ...(department && { department }),
        ...(isActiveQ === 'true' && { isActive: true }),
        ...(isActiveQ === 'false' && { isActive: false }),
      },
      orderBy: [{ department: 'asc' }, { noteType: 'asc' }, { name: 'asc' }],
      take: 500,
    });

    res.status(200).json(rows.map(withParsedFields));
  } catch (error) {
    console.error('[note-template] listTemplates failed:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
};

/**
 * GET /api/note-template/active?department=Cardiology&noteType=discharge
 * Used by doctor-facing forms — returns active templates only, with the
 * default first. Frontend pre-selects the default if the user hasn't picked.
 */
export const getActiveForDepartment = async (req: Request, res: Response): Promise<void> => {
  try {
    const department = req.query.department as string | undefined;
    const noteType = req.query.noteType as string | undefined;
    if (!department || !noteType) {
      res.status(400).json({ error: 'department and noteType are required' });
      return;
    }
    if (!VALID_NOTE_TYPES.includes(noteType)) {
      res.status(400).json({ error: `noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}` });
      return;
    }
    const rows = await prisma.noteTemplate.findMany({
      where: { department, noteType, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    res.status(200).json(rows.map(withParsedFields));
  } catch (error) {
    console.error('[note-template] getActiveForDepartment failed:', error);
    res.status(500).json({ error: 'Failed to load active templates' });
  }
};

/**
 * GET /api/note-template/for-doctor?department=Cardiology&noteType=opd-doctor
 * Phase 9.21 — doctor-facing OPD forms. Returns the logged-in doctor's own
 * templates first, then the department-level ones, default first within each.
 * Frontend pre-selects the first row → the doctor's own default if they have
 * one, else the department default.
 */
export const getForDoctor = async (req: Request, res: Response): Promise<void> => {
  try {
    const department = req.query.department as string | undefined;
    const noteType = req.query.noteType as string | undefined;
    if (!department || !noteType) {
      res.status(400).json({ error: 'department and noteType are required' });
      return;
    }
    if (!VALID_NOTE_TYPES.includes(noteType)) {
      res.status(400).json({ error: `noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}` });
      return;
    }
    const doctorId = await resolveDoctorId(req);
    const rows = await prisma.noteTemplate.findMany({
      where: {
        noteType,
        isActive: true,
        OR: [
          ...(doctorId != null ? [{ doctorId }] : []),
          { doctorId: null, department },
        ],
      },
      // own templates first (non-null doctorId), then default first, then name.
      orderBy: [{ doctorId: 'desc' }, { isDefault: 'desc' }, { name: 'asc' }],
    });
    res.status(200).json(rows.map(withParsedFields));
  } catch (error) {
    console.error('[note-template] getForDoctor failed:', error);
    res.status(500).json({ error: 'Failed to load templates' });
  }
};

/**
 * GET /api/note-template/mine?noteType=opd-doctor
 * Phase 9.21 — doctor self-service template manager. Returns ALL of the
 * logged-in doctor's own templates (active AND inactive, so they can re-enable
 * a deactivated one), optionally filtered by noteType. 403 if the user has no
 * doctor profile (the page is doctor-only).
 */
export const listMine = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctorId = await resolveDoctorId(req);
    if (doctorId == null) {
      res.status(403).json({ error: 'Only doctors can manage personal templates' });
      return;
    }
    const noteType = req.query.noteType as string | undefined;
    const rows = await prisma.noteTemplate.findMany({
      where: { doctorId, ...(noteType && { noteType }) },
      orderBy: [{ noteType: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
      take: 500,
    });
    res.status(200).json(rows.map(withParsedFields));
  } catch (error) {
    console.error('[note-template] listMine failed:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
};

export const getTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const row = await prisma.noteTemplate.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.status(200).json(withParsedFields(row));
  } catch (error) {
    console.error('[note-template] getTemplate failed:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
};

// ─── Create ──────────────────────────────────────────────────────────

export const createTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateBody;
    if (!body.name || body.name.trim().length < 3) {
      res.status(400).json({ error: 'name (min 3 chars) is required' });
      return;
    }
    if (!body.noteType || !VALID_NOTE_TYPES.includes(body.noteType)) {
      res.status(400).json({ error: `noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}` });
      return;
    }
    if (!body.department || body.department.trim().length === 0) {
      res.status(400).json({ error: 'department is required' });
      return;
    }
    const validationError = validateFields(body.fields);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    // Phase 9.21 — personal vs department scope. doctorId is resolved from the
    // authenticated user (never trusted from the client). Doctors may ONLY
    // create personal templates; super_admin/admin (no Doctor row) own the
    // shared department-level ones.
    const callerDoctorId = await resolveDoctorId(req);
    let doctorId: number | null = null;
    if (body.scope === 'mine') {
      doctorId = callerDoctorId;
      if (doctorId == null) {
        res.status(400).json({ error: 'No doctor profile for this user — cannot create a personal template' });
        return;
      }
    } else if (callerDoctorId != null) {
      res.status(403).json({ error: 'Doctors can only create personal templates (scope: "mine")' });
      return;
    }

    // Atomic: if isDefault, demote the previous default within the same scope
    // (per-doctor for personal templates, per-department for shared ones).
    const result = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.noteTemplate.updateMany({
          where: doctorId != null
            ? { doctorId, noteType: body.noteType, isDefault: true }
            : { doctorId: null, department: body.department, noteType: body.noteType, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.noteTemplate.create({
        data: {
          name: body.name.trim(),
          noteType: body.noteType,
          department: body.department.trim(),
          doctorId,
          fields: JSON.stringify(body.fields),
          isActive: body.isActive ?? true,
          isDefault: body.isDefault ?? false,
          createdBy: req.user?.username ?? null,
          createdById: typeof req.user?.id === 'number' ? req.user.id : null,
        },
      });
    });

    await auditLog(req, {
      module: 'note-template',
      action: 'CREATE',
      entityType: 'NoteTemplate',
      entityId: result.id,
      payload: { name: result.name, department: result.department, noteType: result.noteType },
    });

    res.status(201).json(withParsedFields(result));
  } catch (error) {
    console.error('[note-template] createTemplate failed:', error);
    res.status(500).json({
      error: 'Failed to create template',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

// ─── Update ──────────────────────────────────────────────────────────

export const updateTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const body = req.body as Partial<CreateBody>;

    const existing = await prisma.noteTemplate.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    if (!(await assertCanWrite(req, res, existing))) return;

    if (body.fields !== undefined) {
      const validationError = validateFields(body.fields);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }
    }
    if (body.noteType && !VALID_NOTE_TYPES.includes(body.noteType)) {
      res.status(400).json({ error: `noteType must be one of: ${VALID_NOTE_TYPES.join(', ')}` });
      return;
    }

    const newDept = body.department?.trim() ?? existing.department;
    const newType = body.noteType ?? existing.noteType;

    const result = await prisma.$transaction(async (tx) => {
      // Switching isDefault on demotes the other default within the same scope
      // (per-doctor for personal templates, per-department for shared ones).
      if (body.isDefault === true) {
        await tx.noteTemplate.updateMany({
          where: existing.doctorId != null
            ? { doctorId: existing.doctorId, noteType: newType, isDefault: true, NOT: { id } }
            : { doctorId: null, department: newDept, noteType: newType, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.noteTemplate.update({
        where: { id },
        data: {
          name: body.name?.trim() ?? undefined,
          noteType: body.noteType ?? undefined,
          department: body.department?.trim() ?? undefined,
          fields: body.fields !== undefined ? JSON.stringify(body.fields) : undefined,
          isActive: body.isActive ?? undefined,
          isDefault: body.isDefault ?? undefined,
          updatedBy: req.user?.username ?? null,
          updatedById: typeof req.user?.id === 'number' ? req.user.id : null,
        },
      });
    });

    await auditLog(req, {
      module: 'note-template',
      action: 'UPDATE',
      entityType: 'NoteTemplate',
      entityId: id,
      payload: { name: result.name, fieldsChanged: body.fields !== undefined },
    });

    res.status(200).json(withParsedFields(result));
  } catch (error) {
    console.error('[note-template] updateTemplate failed:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
};

// ─── Set default ─────────────────────────────────────────────────────

export const setDefault = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const row = await prisma.noteTemplate.findUnique({ where: { id } });
    if (!row) { res.status(404).json({ error: 'Template not found' }); return; }
    if (!(await assertCanWrite(req, res, row))) return;
    const result = await prisma.$transaction(async (tx) => {
      await tx.noteTemplate.updateMany({
        where: row.doctorId != null
          ? { doctorId: row.doctorId, noteType: row.noteType, isDefault: true, NOT: { id } }
          : { doctorId: null, department: row.department, noteType: row.noteType, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      return tx.noteTemplate.update({
        where: { id },
        data: {
          isDefault: true,
          updatedBy: req.user?.username ?? null,
          updatedById: typeof req.user?.id === 'number' ? req.user.id : null,
        },
      });
    });
    await auditLog(req, {
      module: 'note-template',
      action: 'STATUS_CHANGE',
      entityType: 'NoteTemplate',
      entityId: id,
      payload: { isDefault: true },
    });
    res.status(200).json(withParsedFields(result));
  } catch (error) {
    console.error('[note-template] setDefault failed:', error);
    res.status(500).json({ error: 'Failed to set default' });
  }
};

// ─── Clone ───────────────────────────────────────────────────────────

export const cloneTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const src = await prisma.noteTemplate.findUnique({ where: { id } });
    if (!src) { res.status(404).json({ error: 'Template not found' }); return; }
    if (!(await assertCanWrite(req, res, src))) return;
    const created = await prisma.noteTemplate.create({
      data: {
        name: `${src.name} (copy)`,
        noteType: src.noteType,
        department: src.department,
        doctorId: src.doctorId, // keep the copy in the same scope as its source
        fields: src.fields,
        isActive: false,    // clone starts inactive — admin enables after editing
        isDefault: false,   // never copies the default flag
        createdBy: req.user?.username ?? null,
        createdById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'note-template',
      action: 'CREATE',
      entityType: 'NoteTemplate',
      entityId: created.id,
      payload: { name: created.name, clonedFrom: id },
    });
    res.status(201).json(withParsedFields(created));
  } catch (error) {
    console.error('[note-template] cloneTemplate failed:', error);
    res.status(500).json({ error: 'Failed to clone template' });
  }
};

// ─── Soft-delete ─────────────────────────────────────────────────────

export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const existing = await prisma.noteTemplate.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Template not found' }); return; }
    if (!(await assertCanWrite(req, res, existing))) return;
    const result = await prisma.noteTemplate.update({
      where: { id },
      data: {
        isActive: false,
        isDefault: false,
        updatedBy: req.user?.username ?? null,
        updatedById: typeof req.user?.id === 'number' ? req.user.id : null,
      },
    });
    await auditLog(req, {
      module: 'note-template',
      action: 'DELETE',
      entityType: 'NoteTemplate',
      entityId: id,
      payload: { name: existing.name, soft: true },
    });
    res.status(200).json(withParsedFields(result));
  } catch (error) {
    console.error('[note-template] deleteTemplate failed:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
};

// ─── Helper used by other modules (e.g. discharge sign) ──────────────

/**
 * Snapshot a template's field definitions for embedding into a signed record's
 * `templatedValues._schema`. Returns null if the template doesn't exist.
 */
export async function snapshotTemplateFields(templateId: string): Promise<FieldDef[] | null> {
  const tpl = await prisma.noteTemplate.findUnique({
    where: { id: templateId },
    select: { fields: true },
  });
  if (!tpl) return null;
  try {
    return JSON.parse(tpl.fields) as FieldDef[];
  } catch {
    return [];
  }
}
