import { Request, Response } from 'express';
import DepartmentResolver from './department.resolver';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();


const departmentResolver = new DepartmentResolver();

// Function to create a department
export const createDepartment = async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      const department = await prisma.department.create({
        data: { name },
      });
      res.status(201).json(department);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
  };
  
  export const getDepartments = async (req: Request, res: Response) => {
    try {
      const departments = await prisma.department.findMany();
      res.json(departments);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
  };
