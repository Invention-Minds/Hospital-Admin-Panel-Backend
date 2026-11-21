import { PrismaClient } from '@prisma/client';
import prisma from '../../service/prisma-client';

class DepartmentRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = prisma;
  }

  // Create a new department
  async createDepartment(name: string) {
    try {
      return await this.prisma.department.create({
        data: { name },
      });
    } catch (error) {
      throw new Error('Failed to create department');
    }
  }

  // Get all departments
  async getDepartments() {
    try {
      return await this.prisma.department.findMany({
        include: { doctors: true },
      });
    } catch (error) {
      throw new Error('Failed to get departments');
    }
  }

}


export default DepartmentRepository;