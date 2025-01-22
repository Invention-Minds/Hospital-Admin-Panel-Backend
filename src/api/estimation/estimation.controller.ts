import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const createEstimation = async (req: Request, res: Response) => {
    try {
        const { doctorId, departmentId, estimation } = req.body;
        const savedEstimation = await prisma.estimation.create({
            data: {
              doctorId,
              departmentId,
              estimation,
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