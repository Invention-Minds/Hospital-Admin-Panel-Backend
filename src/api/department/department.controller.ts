import { Request, Response } from 'express';
import DepartmentResolver from './department.resolver';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();


const departmentResolver = new DepartmentResolver();

// Function to create a department
export const createDepartment = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const existing = await prisma.department.findFirst({ where: { name: name.trim() } });
    if (existing) {
      res.status(409).json({ error: 'Department already exists' });
      return;
    }
    const department = await prisma.department.create({
      data: { name: name.trim() },
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

// Update a department — name change. Used by the unified Masters admin page.
export const updateDepartment = async (req: Request, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'id must be a number' });
      return;
    }
    const { name } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const department = await prisma.department.update({
      where: { id },
      data: { name: name.trim() },
    });
    res.json(department);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};
