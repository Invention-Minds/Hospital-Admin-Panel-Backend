import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers['authorization']?.split(' ')[1]; // Extract token from Authorization header

    if (!token) {
        res.sendStatus(401); // Unauthorized if token is not present
        return; // Ensure we return to avoid further processing
    }

    jwt.verify(token, process.env.JWT_SECRET as string, (err: any, user: any) => {
        if (err) {
            res.sendStatus(403); // Forbidden if token is invalid
            return; // Ensure we return to avoid further processing
        }
        req.user = user; // Attach user information to request
        next(); // Proceed to the next middleware or route handler
    });
};
