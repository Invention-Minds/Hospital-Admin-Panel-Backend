import { PrismaClient, UserRole } from '@prisma/client';
const prisma = new PrismaClient();

class AppointmentRepository {
  async findUserByUsername(username: string) {
    return prisma.user.findUnique({
      where: { username },
    });
  }

  async findUserById(userId: number) {
    return prisma.user.findUnique({
      where: { id: userId },
    });
  }

  async createUser(username: string, password: string, role: UserRole) {
    return prisma.user.create({
      data: {
        username,
        password,
        role,
      },
    });
  }

  async updatePasswordByUsername(username: string, newPassword: string) {
    return prisma.user.update({
      where: { username },
      data: { password: newPassword },
    });
  }

  async updatePasswordByUserId(userId: number, newPassword: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { password: newPassword },
    });
  }
  async deleteUserByUsername (username: string){
    return prisma.user.delete({
        where: { username },
    });
};

}

export default new AppointmentRepository();

