import { PrismaClient } from '@prisma/client';

class DepartmentRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
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