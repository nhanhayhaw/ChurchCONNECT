/**
 * Express request augmentation.
 *
 * `req.auth` is populated by middleware/auth.ts once a valid access token has
 * been verified. Nothing else in the codebase writes to it.
 */
import 'express';

declare global {
  namespace Express {
    interface AuthContext {
      userId: number;
      email: string;
      fullName: string;
      roleId: number;
      roleName: string;
      permissions: string[];
      /** Set for Department Leaders - restricts what rows they may see. */
      departmentId: number | null;
      memberId: number | null;
    }

    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
