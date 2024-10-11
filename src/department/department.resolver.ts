import { PrismaClient } from '@prisma/client';

export default class DepartmentResolver {
  private prisma = new PrismaClient();

  async createDepartment(name: string) {
    return await this.prisma.department.create({ data: { name } });
  }

  async getDepartments() {
    return await this.prisma.department.findMany({ include: { doctors: true } });
  }
}
