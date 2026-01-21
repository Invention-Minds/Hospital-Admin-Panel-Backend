import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * CREATE CALLBACK REQUEST (Website)
 */
export const createCallbackRequest = async (req: Request, res: Response) => {
  try {
    const { name, mobile, address, pageName } = req.body;

    if (!name || !mobile) {
       res.status(400).json({ message: 'Name and mobile are required' });
       return;
    }

    const callback = await prisma.callbackRequest.create({
      data: {
        name,
        mobile,
        address,
        pageName,
        status: 'pending'
      }
    });

    res.status(201).json({
      message: 'Callback request created successfully',
      data: callback
    });
  } catch (error) {
    console.error('Create callback error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * GET ALL CALLBACK REQUESTS (Admin)
 */
export const getAllCallbackRequests = async (_req: Request, res: Response) => {
  try {
    const callbacks = await prisma.callbackRequest.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json(callbacks);
  } catch (error) {
    console.error('Fetch callbacks error:', error);
    res.status(500).json({ message: 'Failed to fetch callback requests' });
  }
};

/**
 * ADD FOLLOW-UP NOTE (Multiple times allowed)
 */
export const addCallbackNote = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { note, addedBy } = req.body;

    if (!note || !addedBy) {
       res.status(400).json({ message: 'note and addedBy are required' });
       return;
    }

    const callback = await prisma.callbackRequest.findUnique({
      where: { id: Number(id) }
    });

    if (!callback) {
       res.status(404).json({ message: 'Callback request not found' });
       return;
    }

    if (callback.status === 'cancelled') {
       res.status(400).json({ message: 'Cannot add note to cancelled request' });
       return;
    }

    const existingNotes = Array.isArray(callback.notes)
      ? callback.notes
      : [];

    const updatedNotes = [
      ...existingNotes,
      {
        note,
        addedBy,
        addedAt: new Date()
      }
    ];

    const updated = await prisma.callbackRequest.update({
      where: { id: Number(id) },
      data: {
        notes: updatedNotes
      }
    });

    res.json({
      message: 'Note added successfully',
      data: updated
    });
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({ message: 'Failed to add note' });
  }
};

/**
 * MARK CALLBACK AS HANDLED / CONTACTED
 */
export const markCallbackHandled = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { handledBy } = req.body;

    if (!handledBy) {
       res.status(400).json({ message: 'handledBy is required' });
       return;
    }

    const callback = await prisma.callbackRequest.findUnique({
      where: { id: Number(id) }
    });

    if (!callback) {
       res.status(404).json({ message: 'Callback request not found' });
       return;
    }

    if (callback.status === 'cancelled') {
       res.status(400).json({ message: 'Cancelled request cannot be handled' });
       return;
    }

    const updated = await prisma.callbackRequest.update({
      where: { id: Number(id) },
      data: {
        status: 'contacted',
        handledBy,
        handledAt: new Date()
      }
    });

    res.json({
      message: 'Callback marked as handled',
      data: updated
    });
  } catch (error) {
    console.error('Handle callback error:', error);
    res.status(500).json({ message: 'Failed to mark callback as handled' });
  }
};

/**
 * CANCEL CALLBACK REQUEST (ONLY ONCE)
 */
export const cancelCallbackRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { cancelledBy, cancelReason } = req.body;

    if (!cancelReason) {
       res.status(400).json({ message: 'cancelReason is required' });
       return;
    }

    const callback = await prisma.callbackRequest.findUnique({
      where: { id: Number(id) }
    });

    if (!callback) {
       res.status(404).json({ message: 'Callback request not found' });
       return;
    }

    if (callback.status === 'cancelled') {
       res.status(400).json({ message: 'Callback already cancelled' });
       return;
    }

    const updated = await prisma.callbackRequest.update({
      where: { id: Number(id) },
      data: {
        status: 'cancelled',
        cancelledBy,
        cancelReason,
        cancelledAt: new Date()
      }
    });

    res.json({
      message: 'Callback request cancelled successfully',
      data: updated
    });
  } catch (error) {
    console.error('Cancel callback error:', error);
    res.status(500).json({ message: 'Failed to cancel callback request' });
  }
};
