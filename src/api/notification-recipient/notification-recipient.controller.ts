import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { FALLBACKS, getRecipientPhones, RecipientGroup } from '../../service/notification-recipients';

/**
 * CRUD for message recipient phone numbers (NotificationRecipient), grouped by
 * purpose (groupKey). Read routes are for any authenticated user (the frontend
 * fetches numbers to send to); write routes are admin-only.
 */

/** GET /api/notification-recipients?group=estimation_alert — list rows (all or one group). */
export const listRecipients = async (req: Request, res: Response): Promise<void> => {
  try {
    const group = req.query.group as string | undefined;
    const rows = await prisma.notificationRecipient.findMany({
      where: group ? { groupKey: group } : undefined,
      orderBy: [{ groupKey: 'asc' }, { createdAt: 'asc' }],
    });
    res.status(200).json({ count: rows.length, recipients: rows });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list recipients' });
  }
};

/** GET /api/notification-recipients/phones/:group — resolved active phones (DB or fallback). */
export const getPhones = async (req: Request, res: Response): Promise<void> => {
  try {
    const group = req.params.group as RecipientGroup;
    const phones = await getRecipientPhones(group);
    res.status(200).json({ group, phones });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to resolve phones' });
  }
};

/** GET /api/notification-recipients/groups — known group keys (for admin UIs). */
export const listGroups = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ groups: Object.keys(FALLBACKS) });
};

/** POST /api/notification-recipients — { groupKey, phone, label? }. */
export const createRecipient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupKey, phone, label } = req.body ?? {};
    if (!groupKey || !phone) {
      res.status(400).json({ error: 'groupKey and phone are required' });
      return;
    }
    const normalized = String(phone).replace(/[^0-9]/g, '');
    if (normalized.length < 10) {
      res.status(400).json({ error: 'phone must be at least 10 digits' });
      return;
    }
    const created = await prisma.notificationRecipient.create({
      data: { groupKey: String(groupKey), phone: normalized, label: label ?? null },
    });
    res.status(201).json(created);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ error: 'That phone already exists in this group' });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create recipient' });
  }
};

/** PATCH /api/notification-recipients/:id — { phone?, label?, isActive? }. */
export const updateRecipient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, label, isActive } = req.body ?? {};
    const data: Record<string, unknown> = {};
    if (phone !== undefined) {
      const normalized = String(phone).replace(/[^0-9]/g, '');
      if (normalized.length < 10) {
        res.status(400).json({ error: 'phone must be at least 10 digits' });
        return;
      }
      data.phone = normalized;
    }
    if (label !== undefined) data.label = label;
    if (isActive !== undefined) data.isActive = !!isActive;

    const updated = await prisma.notificationRecipient.update({
      where: { id: req.params.id },
      data,
    });
    res.status(200).json(updated);
  } catch (error: any) {
    if (error?.code === 'P2025') {
      res.status(404).json({ error: 'Recipient not found' });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update recipient' });
  }
};

/** DELETE /api/notification-recipients/:id */
export const deleteRecipient = async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.notificationRecipient.delete({ where: { id: req.params.id } });
    res.status(200).json({ message: 'Recipient deleted', id: req.params.id });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      res.status(404).json({ error: 'Recipient not found' });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete recipient' });
  }
};
