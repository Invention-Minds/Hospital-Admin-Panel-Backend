import {  $Enums } from '@prisma/client';
import loginRepository from './login.repository';
import bcrypt from 'bcrypt';

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const loginUser = async (username: string, password: string) => {
  const user = await loginRepository.findUserByUsername(username);
  if (user && bcrypt.compareSync(password, user.password)) {
    return {
      id: user.id,           // Include id in the returned user object
      username: user.username,
      role: user.role
    };
  }
  return null;
};

export const createUser = async (username: string, password: string, role: $Enums.UserRole) => {
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
export const deleteUserById = async (id: number): Promise<void> => {
  try {
    await prisma.user.delete({
      where: { id },  // Delete user by ID
    });
  } catch (error) {
    throw new Error('Failed to delete user');
  }
};