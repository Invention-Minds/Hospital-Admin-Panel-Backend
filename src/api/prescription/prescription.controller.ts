
import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

const generatePrescriptionId = async (): Promise<string> => {
  const latest = await prisma.prescription.findFirst({
    orderBy: { id: 'desc' },
    select: { id: true },
  });

  const nextNumber = latest ? latest.id + 1 : 1;
  const formattedNumber = String(nextNumber).padStart(3, '0');
  return `JMRH-RX-${formattedNumber}`;
};

export const createPrescription = async (req: Request, res: Response) => {
  try {
    const { prescribedBy, prn, patientName, tablets, prescribedDate, prescribedById, prescribedByKMC } = req.body;

    const prescriptionId = await generatePrescriptionId();

    const newPrescription = await prisma.prescription.create({
      data: {
        prescriptionId,
        prescribedBy,
        prn,
        patientName,
        prescribedDate,
        prescribedById,
        prescribedByKMC,
        tablets: {
          create: tablets.map((tablet: any) => ({
            genericName: tablet.genericName,
            brandName: tablet.brandName,
            frequency: tablet.frequency,
            duration: tablet.duration,
            instructions: tablet.instructions,
            quantity: tablet.quantity,
          })),
        },
      },
      include: {
        tablets: true,
      },
    });

    res.status(201).json({ message: 'Prescription created', data: newPrescription });
  } catch (error) {
    console.error('Error creating prescription:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
export const getPrescriptionByPrn = async (req: Request, res: Response) => {
  try {
    const { prn } = req.params;

    if (!prn) {
       res.status(400).json({ message: 'PRN is required' });
       return
    }

    const prescriptions = await prisma.prescription.findMany({
      where: { prn },
      include: {
        tablets: true, // include the tablets if needed
      },
      orderBy: {
        prescribedDate: 'desc',
      },
    });

    if (!prescriptions.length) {
       res.status(404).json({ message: 'No prescriptions found for this PRN' });
       return
    }

    res.status(200).json(prescriptions);
  } catch (error) {
    console.error('Error fetching prescriptions by PRN:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const createTablet = async (req: Request, res: Response) => {
  try {
    const { genericName, brandName, type, description } = req.body;

    const newTablet = await prisma.tabletMaster.create({
      data: {
        genericName,
        brandName,
        type,
        description,
      },
    });

    res.status(201).json(newTablet);
  } catch (error) {
    console.error('Error creating tablet:', error);
    res.status(500).json({ message: 'Failed to create tablet' });
  }
};

// Get all tablets
export const getAllTablets = async (_req: Request, res: Response) => {
  try {
    const tablets = await prisma.tabletMaster.findMany();
    res.status(200).json(tablets);
  } catch (error) {
    console.error('Error fetching tablets:', error);
    res.status(500).json({ message: 'Failed to fetch tablets' });
  }
};

// Get by ID
export const getTabletById = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const tablet = await prisma.tabletMaster.findUnique({ where: { id } });

    if (!tablet) {
      res.status(404).json({ message: 'Tablet not found' });
      return
    }

    res.status(200).json(tablet);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching tablet' });
  }
};
// Save favorite tablet
export const saveFavoriteTablet = async (req: Request, res: Response) => {
  try {
    const {favorites} = req.body; // Expecting an array

    if (!Array.isArray(favorites) || favorites.length === 0) {
       res.status(400).json({ message: 'Invalid or empty favorites list' });
       return
    }

    console.log('Received favorites:', favorites);
    
    const created = await prisma.favoriteTablet.createMany({
      data: favorites.map(fav => ({
        userId: fav.userId,
        tabletId: fav.tabletId,
        frequency: fav.frequency,
        duration: fav.duration,
        instructions: fav.instructions,
      })),
      skipDuplicates: true,
    });
    

    res.status(200).json({ message: 'Favorites saved successfully' });

  } catch (error) {
    console.error('Error saving favorite:', error);
    res.status(500).json({ message: 'Failed to save favorite' });
  }
};

// Get all favorites for a user
export const getFavoritesByUser = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const favorites = await prisma.favoriteTablet.findMany({
      where: { userId },
      include: { tablet: true }
    });

    res.status(200).json(favorites);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch favorites' });
  }
};

// Remove favorite
export const removeFavoriteTablet = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await prisma.favoriteTablet.delete({ where: { id } });

    res.status(200).json({ message: 'Favorite removed' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting favorite' });
  }
};
// favorite.controller.ts
export const getAllFavorites = async (_req: Request, res: Response) => {
  try {
    const favorites = await prisma.favoriteTablet.findMany({
      include: {
        tablet: true // includes genericName, brandName, type
      }
    });

    res.status(200).json(favorites);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch favorites' });
  }
};

export const addAllergies = async (req: Request, res: Response) => {
  const allergies = req.body.allergies; // [{ prn, genericName }]
  if (!Array.isArray(allergies) || allergies.length === 0) {
     res.status(400).json({ message: 'Invalid or empty allergies' });
     return
  }

  try {
    const created = await prisma.allergy.createMany({
      data: allergies,
      skipDuplicates: true,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error saving allergies' });
  }
};

export const getAllergiesByPrn = async (req: Request, res: Response) => {
  const { prn } = req.params;
  try {
    const list = await prisma.allergy.findMany({ where: { prn } });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching allergies' });
  }
};

export const deleteAllergy = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  try {
    await prisma.allergy.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ message: 'Error deleting allergy' });
  }
};
