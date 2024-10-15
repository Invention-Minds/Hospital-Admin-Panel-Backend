import { UserRole } from '@prisma/client';
import loginRepository from './login.repository';
import bcrypt from 'bcrypt';

export const loginUser = async (username: string, password: string) => {
    const user = await loginRepository.findUserByUsername(username);
    if (user && bcrypt.compareSync(password, user.password)) {
      return user;
    }
    return null;
  };

  export const createUser = async (username: string, password: string, role: UserRole) => {
    const hashedPassword = bcrypt.hashSync(password, 10);
    return loginRepository.createUser(username, hashedPassword, role);  // Pass role here
  };

  export const resetPassword = async (username: string, newPassword: string) => {
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    return loginRepository.updatePasswordByUsername(username, hashedPassword);
  };

  export const changePassword = async (userId: number, oldPassword: string, newPassword: string) => {
    const user = await loginRepository.findUserById(userId);
    if (user && bcrypt.compareSync(oldPassword, user.password)) {
      const hashedPassword = bcrypt.hashSync(newPassword, 10);
      return loginRepository.updatePasswordByUserId(userId, hashedPassword);
    }
    return null;
  };