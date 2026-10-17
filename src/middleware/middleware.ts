import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../service/prisma-client';

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers['authorization']?.split(' ')[1]; // Extract token from Authorization header
    const maintenance = await prisma.maintenance.findFirst();
    if (maintenance?.isActive) {
       res.status(503).json({
        error: "System is under maintenance. Please try again later."
      });
      return
    }
    if (!token) {
        res.sendStatus(401); // Unauthorized if token is not present
        return; // Ensure we return to avoid further processing
    }

    jwt.verify(token, process.env.JWT_SECRET as string, { algorithms: ['HS256'] }, (err: any, user: any) => {
        // Purpose-scoped tokens (login challenge, download grant) share the
        // secret but are never valid as a session token.
        if (err || user?.purpose) {
            res.sendStatus(403); // Forbidden if token is invalid
            return; // Ensure we return to avoid further processing
        }
        req.user = user; // Attach user information to request
        next(); // Proceed to the next middleware or route handler
    });
};
