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
  async getAllUsers() {
    return prisma.user.findMany();
  }

  async updatePasswordByUsername(username: string, newPassword: string) {
    try {
      return await prisma.user.update({
        where: { username },
        data: { password: newPassword },
      });
    } catch (error) {
      console.error('Error updating password for user:', username, error);
      throw new Error('Failed to update password');
    }
  }

  async updatePasswordByUserId(userId: number, newPassword: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { password: newPassword },
    });
  }
  async deleteUserByUsername(username: string) {
    return prisma.user.delete({
      where: { username },
    });
  };
// Store a new token for a user session
// async storeToken(data: any){
//   return prisma.activeToken.create({
//     data
//   });
// };
// async updateTokenStatus(token: string, data: any){
//   return prisma.activeToken.updateMany({
//     where: {
//       token: token,
//       isActive: true
//     },
//     data
//   });
// };
// async getActiveSessions(){
//   return prisma.activeToken.findMany({
//     where: { isActive: true },
//     include: { user: true }
//   });
// };
// async findActiveTokenByUserId(userId: number){
//   return prisma.activeToken.findFirst({
//     where: {
//       userId: userId,
//       isActive: true
//     }
//   });
// };

}

export default new AppointmentRepository();

