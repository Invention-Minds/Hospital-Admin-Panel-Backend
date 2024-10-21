import { Request, Response } from 'express';
import { loginUser, createUser, resetPassword, changePassword } from './login.resolver';
// import { UserRole } from '@prisma/client';
import { $Enums } from '@prisma/client';
import jwt from 'jsonwebtoken';
import loginRepository from './login.repository';
import { deleteUserById } from './login.resolver';


const extractRoleFromUsername = (username: string):  $Enums.UserRole => {
  const parts = username.split('_');
  if (parts.length > 1) {
    const roleString = parts[1].split('@')[0];

    // Ensure the role is one of the valid enum values
    switch (roleString.toLowerCase()) {
      case 'admin':
        return $Enums.UserRole.admin;
      case 'subadmin':
        return $Enums.UserRole.sub_admin;
      case 'doctor':
        return $Enums.UserRole.doctor;
      case 'superadmin':
        return $Enums.UserRole.super_admin; // Added for completeness
      default:
        console.warn(`Unknown role: ${roleString}`); // Log unknown role
        return $Enums.UserRole.unknown; // Return 'unknown' if role is unrecognized
    }
  }
  return $Enums.UserRole.super_admin;  // Default to 'user' if no role is found
};
// Function to generate JWT token
const generateToken = (user: any) => {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET as string, {
    expiresIn: process.env.JWT_EXPIRES_IN, // Token expires in 1 hour
  });
};

export const userLogin = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const role = extractRoleFromUsername(username);  // Extract role
    const user = await loginUser(username, password);

    if (user) {
      const role = extractRoleFromUsername(user.username); // Extract role
      const token = generateToken(user); // Generate JWT token
      res.status(200).json({ token, user: { userId: user.id, username: user.username, role } }); // Send token and user data
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};


export const userRegister = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const role = extractRoleFromUsername(username);  // Extract role from username
    const newUser = await createUser(username, password, role);
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const userResetPassword = async (req: Request, res: Response) => {
  try {
    const { username, newPassword } = req.body;
    await resetPassword(username, newPassword);
    res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const userChangePassword = async (req: Request, res: Response) => {
  try {
    const { userId, oldPassword, newPassword } = req.body;
    await changePassword(userId, oldPassword, newPassword);
    res.status(200).json({ message: 'Password change successful' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
export const getUserDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;  // Assuming user ID is stored in the request after authentication

    if (typeof userId !== 'number') {
      res.status(401).json({ error: 'Unauthorized: User ID not found' });
      return; // Ensure to return after sending a response
    }

    const user = await loginRepository.findUserById(userId);
    console.log(user);

    if (user) {
      const role = extractRoleFromUsername(user.username); // Extract role from username if needed
      res.status(200).json({ userId: user.id, username: user.username, role }); // Include userId in the response
    }
    else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};
export const deleteUserByUsername = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.id;  // Assuming user ID is stored in the request after authentication

  if (typeof userId !== 'number') {
    res.status(401).json({ error: 'Unauthorized: User ID not found' });
    return; // Ensure to return after sending a response
  }
  const { username } = req.params;

  try {
    const user = await loginRepository.findUserByUsername(username);
    console.log(user);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await loginRepository.deleteUserByUsername(username); // Call delete function from the repository
    res.status(200).json({ message: `User with username ${username} has been deleted successfully.` });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

