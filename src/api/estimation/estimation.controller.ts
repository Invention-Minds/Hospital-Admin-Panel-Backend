import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const createEstimation = async (req: Request, res: Response) => {
    try {
        const { doctorId, departmentId, estimation, estimationType } = req.body;
        const savedEstimation = await prisma.estimation.create({
            data: {
                doctorId,
                departmentId,
                estimation,
                estimationType
            },
        });
        res.status(201).json({
            message: 'Estimation saved successfully',
            estimation: savedEstimation,
        });
    }
    catch (error) {
        console.error('Error during create estimation:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
export const getEstimationsByDepartment = async (req: Request, res: Response) => {
    try {
        const { departmentId, estimationType } = req.params;

        // Fetch estimations for the given department ID
        const estimations = await prisma.estimation.findMany({
            where: {
                departmentId: Number(departmentId),
                estimationType: (estimationType)
            },
            select: {
                estimation: true,
            },
        });

        res.status(200).json(estimations.map((e) => e.estimation));
    } catch (error) {
        console.error('Error fetching estimations by department:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createEstimationDetails = async (req: Request, res: Response) => {
    try {
        const {
            prnNumber,
            patientName,
            phoneNumber,
            estimationName,
            preferredDate,
            doctorId,
            doctorName,
            status,
            estimationType,
            estimationId
        } = req.body;

        const estimationDetails = await prisma.estimationDetails.create({
            data: {
                estimationId: estimationId,
                patientUHID: prnNumber,
                patientName,
                patientPhoneNumber: phoneNumber,
                estimationName,
                estimationPreferredDate: preferredDate,
                consultantId: doctorId,
                consultantName: doctorName,
                statusOfEstimation: status,
                estimationType
            },
        });

        res.status(201).json({
            message: 'Estimation Details created successfully',
            estimationDetails,
        });
    } catch (error) {
        console.error('Error creating estimation details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getAllEstimationDetails = async (req: Request, res: Response) => {
    try {
      const estimationDetails = await prisma.estimationDetails.findMany();
  
      res.status(200).json(estimationDetails);
    } catch (error) {
      console.error('Error fetching estimation details:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  