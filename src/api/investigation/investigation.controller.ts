import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';
import { syncInvestigationOrderToHmis } from './investigation-sync';
import { checkPaymentGate } from '../../service/payment-gate';
import { auditLog } from '../../service/app-audit';

export const createInvestigationOrder = async (req: Request, res: Response) => {
  try {
    const { prn, doctorId, doctorName, remarks, labTests, radiologyTests, packages, date, appointmentId, radiology } = req.body;

    // Radiology safety-screening block — present only when a radiology study is
    // ordered. comorbidities arrives as a string[] and is stored comma-joined.
    const rad = radiology ?? {};
    const radComorbidities = Array.isArray(rad.comorbidities) && rad.comorbidities.length
      ? rad.comorbidities.join(',')
      : null;

    // Phase 2.5 / WF-1 — block investigation order until OPD fee is paid.
    const gate = await checkPaymentGate(req, { appointmentId, action: 'investigation' });
    if (!gate.ok) {
      res.status(402).json({ error: gate.reason, paymentStatus: gate.paymentStatus });
      return;
    }

    const newOrder = await prisma.investigationOrder.create({
      data: {
        prn,
        doctorId,
        doctorName,
        remarks,
        date,
        radPriority: rad.priority ?? null,
        radClinicalDetails: rad.clinicalDetails ?? null,
        radSerumCreatinine: rad.serumCreatinine ?? null,
        radCreatinineDoneOn: rad.creatinineDoneOn ?? null,
        radWeightKg: rad.weightKg ?? null,
        radPregnancy: typeof rad.pregnancy === 'boolean' ? rad.pregnancy : null,
        radLmp: rad.lmp ?? null,
        radAllergyHistory: rad.allergyHistory ?? null,
        radComorbidities,
        radConsentGiven: typeof rad.consentGiven === 'boolean' ? rad.consentGiven : null,
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

    await auditLog(req, {
      module: 'investigation',
      action: 'CREATE',
      entityType: 'InvestigationOrder',
      entityId: newOrder.id,
      payload: {
        prn,
        appointmentId,
        labTestCount: labTests?.length ?? 0,
        radiologyTestCount: radiologyTests?.length ?? 0,
        packageCount: packages?.length ?? 0,
      },
    });

    res.status(201).json(newOrder);

    // Async HMIS sync (fire-and-forget, doesn't block response)
    syncInvestigationOrderToHmis(newOrder).catch((err) =>
      console.error('HMIS investigation order sync failed:', err)
    );
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create investigation order' });
  }
};

// Get a patient's investigation orders (most recent first) with their linked
// lab/radiology tests — used by the OPD form's read-only "Previously ordered"
// list when reopening an assessment.
export const getInvestigationOrdersByPrn = async (req: Request, res: Response) => {
  try {
    const prn = String(req.query.prn ?? '').trim();
    if (!prn) {
      res.status(400).json({ error: 'prn query parameter is required' });
      return;
    }
    const orders = await prisma.investigationOrder.findMany({
      where: { prn },
      orderBy: { createdAt: 'desc' },
      include: { labTests: true, radiologyTests: true, packages: true },
    });
    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching investigation orders:', error);
    res.status(500).json({ error: 'Failed to fetch investigation orders' });
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
  // Update a lab test — used by the unified Masters admin page. Re-checks
  // description uniqueness against OTHER rows so a rename doesn't collide.
  export const updateLabTest = async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'id must be a number' });
        return;
      }
      const { description, department } = req.body;
      if (!description?.trim() || !department?.trim()) {
        res.status(400).json({ error: 'description and department are required' });
        return;
      }
      const clash = await prisma.lab.findFirst({
        where: { description: { equals: description.trim() }, NOT: { id } },
      });
      if (clash) {
        res.status(409).json({ error: `Another lab test already has description "${description}"` });
        return;
      }
      const updated = await prisma.lab.update({
        where: { id },
        data: { description: description.trim(), department: department.trim() },
      });
      res.status(200).json(updated);
    } catch (error) {
      console.error('Error updating lab test:', error);
      res.status(500).json({ error: 'Failed to update lab test' });
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

  // Update a radiology test — used by the unified Masters admin page.
  export const updateRadiologyTest = async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'id must be a number' });
        return;
      }
      const { description, department } = req.body;
      if (!description?.trim() || !department?.trim()) {
        res.status(400).json({ error: 'description and department are required' });
        return;
      }
      const clash = await prisma.radiology.findFirst({
        where: { description: { equals: description.trim() }, NOT: { id } },
      });
      if (clash) {
        res.status(409).json({ error: `Another radiology test already has description "${description}"` });
        return;
      }
      const updated = await prisma.radiology.update({
        where: { id },
        data: { description: description.trim(), department: department.trim() },
      });
      res.status(200).json(updated);
    } catch (error) {
      console.error('Error updating radiology test:', error);
      res.status(500).json({ error: 'Failed to update radiology test' });
    }
  };
