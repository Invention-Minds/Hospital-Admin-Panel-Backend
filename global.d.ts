declare namespace NodeJS {
    interface ProcessEnv {
        DATABASE_URL: string;
      JWT_SECRET: string;
      JWT_EXPIRES_IN: string;
      // Add other environment variables here as needed
    }
  }
// global.d.ts
// import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;  // Adjust the type based on your user ID type
        username: string; // Include other properties if needed
      };
    }
  }
}
export{};
