import { Request, Response } from 'express';
import { loginUser, createUser, resetPassword, changePassword } from './login.resolver';
import { UserRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import loginRepository from './login.repository';


const extractRoleFromUsername = (username: string): UserRole => {
    const parts = username.split('_');
    if (parts.length > 1) {
      const roleString = parts[1].split('@')[0];
      
      // Ensure the role is one of the valid enum values
      switch (roleString.toLowerCase()) {
        case 'admin':
          return UserRole.admin;
        case 'subadmin':
          return UserRole.sub_admin;
        case 'doctor' :
            return UserRole.doctor;
            case 'super_admin':
                return UserRole.super_admin; // Added for completeness
            default:
                console.warn(`Unknown role: ${roleString}`); // Log unknown role
                return UserRole.unknown; // Return 'unknown' if role is unrecognized
      }
    }
    return UserRole.super_admin;  // Default to 'user' if no role is found
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
            res.status(200).json({ token, user: { username: user.username, role } }); // Send token and user data
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
        
        if (user) {
            const role = extractRoleFromUsername(user.username); // Extract role from username if needed
            res.status(200).json({ username: user.username, role }); // Send username and role
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
};
