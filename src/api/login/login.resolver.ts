import { UserRole } from '@prisma/client';
import loginRepository from './login.repository';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Days a mobile refresh token stays valid (covers a multi-day on/off shift
// pattern). Override with MOBILE_REFRESH_EXPIRES_DAYS in the environment.
const MOBILE_REFRESH_EXPIRES_DAYS = Number(process.env.MOBILE_REFRESH_EXPIRES_DAYS) || 30;

/** Issues and persists an opaque mobile refresh token for a user. */
export const issueMobileRefreshToken = async (userId: number): Promise<string> => {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + MOBILE_REFRESH_EXPIRES_DAYS);
  await loginRepository.createMobileRefreshToken(userId, token, expiresAt);
  return token;
};

/** Returns the associated user if the refresh token is valid, else null. */
export const validateMobileRefreshToken = async (token: string) => {
  const record = await loginRepository.findValidMobileRefreshToken(token);
  return record?.user ?? null;
};

export const loginUser = async (password: string, employeeId: string) => {
  const user = await loginRepository.findUserByEmployeeId(employeeId)
  console.log("user", user);
  if (!user) return null;
  if (user.isActive === false) return { inactive: true } as any;
  if (bcrypt.compareSync(password, user.password)) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      isReceptionist: user.isReceptionist,
      employeeId: user.employeeId,
      subAdminType: user.subAdminType,
      adminType: user.adminType
    };
  }
  return null;
};
export const loginDoctor = async (password: string, userId: number) => {
  const user = await loginRepository.findUserById(userId)
  console.log("user", user);
  if (!user) return null;
  if (user.isActive === false) return { inactive: true } as any;
  if (bcrypt.compareSync(password, user.password)) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      isReceptionist: user.isReceptionist,
      employeeId: user.employeeId,
      subAdminType: user.subAdminType,
      adminType: user.adminType,
    };
  }
  return null;
};

export const createUser = async (username: string, password: string, role: UserRole, isReceptionist: boolean, employeeId: string, subAdminType: string, adminType:string, createdBy: string) => {
  const hashedPassword = bcrypt.hashSync(password, 10);
  return loginRepository.createUser(username, hashedPassword, role, isReceptionist, employeeId, subAdminType, adminType,createdBy);  // Pass role here
};
// export const createUser = async (username: string, password: string, role: UserRole, isReceptionist: boolean) => {
//   const hashedPassword = bcrypt.hashSync(password, 10);
//   return loginRepository.createUser(username, hashedPassword, role, isReceptionist);  // Pass role here
// };

export const resetPassword = async (employeeId: string, newPassword: string,updatedBy:string) => {
  const hashedPassword = bcrypt.hashSync(newPassword, 10);
  const user = await loginRepository.findUserByEmployeeId(employeeId);
  const userId = user!.id;
  return await loginRepository.updatePasswordByUserId(userId, hashedPassword,updatedBy);
};

export const changePassword = async (userId: number, oldPassword: string, newPassword: string, updatedBy:string) => {
  const user = await loginRepository.findUserById(userId);
  if (user && bcrypt.compareSync(oldPassword, user.password)) {
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    return loginRepository.updatePasswordByUserId(userId, hashedPassword, updatedBy);
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