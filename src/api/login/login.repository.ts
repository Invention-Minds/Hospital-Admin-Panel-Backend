import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();

class AppointmentRepository {
  async findUserByUsername(username: string) {
    return prisma.user.findFirst({
      where: { username },
    });
  }

  async findUserById(userId: number) {
    return prisma.user.findUnique({
      where: { id: userId },
    });
  }

  async findUserByEmployeeId(employeeId: string){
    return prisma.user.findUnique({
      where: { employeeId: employeeId}
    })
  }

  async createUser(username: string, password: string, role: UserRole, isReceptionist: boolean, employeeId: string) {
    return prisma.user.create({
      data: {
        username,
        password,
        role,
        isReceptionist,
        employeeId
      },
    });
  }
  // async createUser(username: string, password: string, role: UserRole, isReceptionist: boolean) {
  //   return prisma.user.create({
  //     data: {
  //       username,
  //       password,
  //       role,
  //       isReceptionist
  //     },
  //   });
  // }
  async getAllUsers() {
    return prisma.user.findMany();
  }
  async findUserByNameAndPassword(name: string, password: string) {
    // Find all users with the given name prefix
    const users = await prisma.user.findMany({
      where: {
        username: {
          startsWith: name + '_', // Match usernames starting with the given name and followed by a role
        },
      },
    });
  
    // Loop through each user and verify the password
    for (const user of users) {
      if (bcrypt.compareSync(password, user.password)) {
        return user; // Return the user if the password matches
      }
    }
  
    // If no match is found, return null
    return null;
  }
  

  // async updatePasswordByUsername(username: string, newPassword: string) {
  //   try {
  //     return await prisma.user.update({
  //       where: { username },
  //       data: { password: newPassword },
  //     });
  //   } catch (error) {
  //     console.error('Error updating password for user:', username, error);
  //     throw new Error('Failed to update password');
  //   }
  // }

  async updatePasswordByUserId(userId: number, newPassword: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { password: newPassword },
    });
  }
  async deleteUserByUsername(userId: number) {
    return prisma.user.delete({
      where: { id: userId },
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

