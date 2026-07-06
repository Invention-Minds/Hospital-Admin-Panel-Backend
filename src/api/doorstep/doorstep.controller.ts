import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// Doorstep service requests (lab pickup / pharmacy delivery) raised via the
// WhatsApp bot. Ops team lists and progresses them from the panel.

const VALID_STATUS = ['pending', 'scheduled', 'completed', 'cancelled'];

// GET /api/doorstep/inbox?status=pending
export const getDoorstepRequests = async (req: Request, res: Response): Promise<void> => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await prisma.doorstepRequest.findMany({
    where: status ? { status } : {},
    orderBy: { created_at: 'desc' },
  });
  res.json({ data: rows });
};

// POST /api/doorstep/:id/status   body: { status }
export const updateDoorstepStatus = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const status = (req.body?.status ?? '').toString();
  if (!VALID_STATUS.includes(status)) {
    res.status(400).json({ message: `status must be one of ${VALID_STATUS.join(', ')}` });
    return;
  }
  const exists = await prisma.doorstepRequest.findUnique({ where: { id } });
  if (!exists) {
    res.status(404).json({ message: 'Request not found' });
    return;
  }
  const updated = await prisma.doorstepRequest.update({ where: { id }, data: { status } });
  res.json({ data: updated });
};
