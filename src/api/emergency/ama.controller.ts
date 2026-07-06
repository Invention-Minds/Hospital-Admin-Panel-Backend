import type { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

// AMA (Against Medical Advice) — LAMA / DAMA records.
//
// Each is one row per Emergency (emergencyId @unique), hanging off
// /api/emergency/:id/lama and /api/emergency/:id/dama. Because emergencyId is
// unique we expose GET (fetch the row, may be null) and POST (upsert).
// Mirrors mlc.controller.ts.

const parseEmergencyId = (req: Request, res: Response): number | null => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'Invalid emergency id' });
    return null;
  }
  return id;
};

const toBool = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';

// ─── LAMA ─────────────────────────────────────────────────────────────────

export const getLama = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const row = await prisma.lamaRecord.findUnique({ where: { emergencyId } });
    res.status(200).json(row);
  } catch (error) {
    console.error('[lama] get failed:', error);
    res.status(500).json({ message: 'Failed to fetch LAMA record' });
  }
};

export const upsertLama = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const {
      lamaTime, doctorAdvice, riskExplained, patientSignature,
      witnessName, witnessSignature, reasonForLama,
    } = req.body;

    if (!doctorAdvice || !reasonForLama) {
      res.status(400).json({ message: 'doctorAdvice and reasonForLama are required' });
      return;
    }

    // Editable fields shared by create + update (emergencyId / createdBy excluded).
    const fields = {
      lamaTime: lamaTime ? new Date(lamaTime as string) : new Date(),
      doctorAdvice,
      riskExplained: toBool(riskExplained),
      patientSignature: patientSignature ?? null,
      witnessName: witnessName ?? null,
      witnessSignature: witnessSignature ?? null,
      reasonForLama,
    };

    const row = await prisma.lamaRecord.upsert({
      where: { emergencyId },
      create: {
        emergencyId,
        createdBy: req.user?.username ?? null,
        ...fields,
      },
      update: {
        ...fields,
      },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[lama] upsert failed:', error);
    res.status(500).json({ message: 'Failed to save LAMA record' });
  }
};

// ─── DAMA ─────────────────────────────────────────────────────────────────

export const getDama = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const row = await prisma.damaRecord.findUnique({ where: { emergencyId } });
    res.status(200).json(row);
  } catch (error) {
    console.error('[dama] get failed:', error);
    res.status(500).json({ message: 'Failed to fetch DAMA record' });
  }
};

export const upsertDama = async (req: Request, res: Response): Promise<void> => {
  const emergencyId = parseEmergencyId(req, res);
  if (emergencyId === null) return;
  try {
    const {
      dischargeTime, doctorRecommendation, patientDeclinesAdvice, patientSignature,
      witnessName, witnessSignature, followUpAdvice,
    } = req.body;

    if (!doctorRecommendation) {
      res.status(400).json({ message: 'doctorRecommendation is required' });
      return;
    }

    // Editable fields shared by create + update (emergencyId / createdBy excluded).
    const fields = {
      dischargeTime: dischargeTime ? new Date(dischargeTime as string) : new Date(),
      doctorRecommendation,
      patientDeclinesAdvice: toBool(patientDeclinesAdvice),
      patientSignature: patientSignature ?? null,
      witnessName: witnessName ?? null,
      witnessSignature: witnessSignature ?? null,
      followUpAdvice: followUpAdvice ?? null,
    };

    const row = await prisma.damaRecord.upsert({
      where: { emergencyId },
      create: {
        emergencyId,
        createdBy: req.user?.username ?? null,
        ...fields,
      },
      update: {
        ...fields,
      },
    });
    res.status(200).json(row);
  } catch (error) {
    console.error('[dama] upsert failed:', error);
    res.status(500).json({ message: 'Failed to save DAMA record' });
  }
};
