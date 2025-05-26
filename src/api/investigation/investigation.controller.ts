import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

export const createInvestigationOrder = async (req: Request, res: Response) => {
  try {
    const { prn, doctorId, doctorName, remarks, labTests, radiologyTests, packages, date } = req.body;

    const newOrder = await prisma.investigationOrder.create({
      data: {
        prn,
        doctorId,
        doctorName,
        remarks,
        date,
        labTests: {
          connect: labTests.map((id: number) => ({ id }))
        },
        radiologyTests: {
          connect: radiologyTests.map((id: number) => ({ id }))
        },
        packages: {
          connect: packages.map((id: number) => ({ id }))
        }
      },
      include: {
        labTests: true,
        radiologyTests: true,
        packages: true
      }
    });

    res.status(201).json(newOrder);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create investigation order' });
  }
};
// Get all Lab tests
export const getLabTests = async (req: Request, res: Response) => {
    try {
      const labs = await prisma.lab.findMany({
        orderBy: { description: 'asc' } // optional: sorted alphabetically
      });
      res.status(200).json(labs);
    } catch (error) {
      console.error('Error fetching lab tests:', error);
      res.status(500).json({ error: 'Failed to fetch lab tests' });
    }
  };
  
  // Get all Radiology tests
  export const getRadiologyTests = async (req: Request, res: Response) => {
    try {
      const radiology = await prisma.radiology.findMany({
        orderBy: { description: 'asc' }
      });
      res.status(200).json(radiology);
    } catch (error) {
      console.error('Error fetching radiology tests:', error);
      res.status(500).json({ error: 'Failed to fetch radiology tests' });
    }
  };
  export const createLabTest = async (req: Request, res: Response) => {
    const { description, department } = req.body;
  
    if (!description) {
       res.status(400).json({ error: 'Description is required' });
       return
    }
  
    try {
      // Check if test already exists (optional)
      const existing = await prisma.lab.findFirst({
        where: { description: { equals: description } }
      });
      if (existing) { 
        res.status(200).json(existing);
        return
      }
  
      const newLab = await prisma.lab.create({
        data: {
          description,
          department
        }
      });
  
      res.status(201).json(newLab);
    } catch (error) {
      console.error('Error creating lab test:', error);
      res.status(500).json({ error: 'Failed to create lab test' });
    }
  };
  export const createRadiologyTest = async (req: Request, res: Response) => {
    const { description, department } = req.body;
  
    if (!description) {
       res.status(400).json({ error: 'Description is required' });
       return
    }
  
    try {
      const existing = await prisma.radiology.findFirst({
        where: { description: { equals: description } }
      });
      if (existing){
        res.status(200).json(existing);
        return;
      }
  
      const newRadiology = await prisma.radiology.create({
        data: {
          description,
          department
        }
      });
  
      res.status(201).json(newRadiology);
    } catch (error) {
      console.error('Error creating radiology test:', error);
      res.status(500).json({ error: 'Failed to create radiology test' });
    }
  };
    