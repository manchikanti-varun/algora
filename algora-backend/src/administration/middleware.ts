import type { RequestHandler } from 'express';
import { authContext } from '../auth/middleware.js';
import { idSchema, type Permission } from './contracts.js';
import type { AdministrationService } from './service.js';
export const requireCollegePermission =
  (
    service: AdministrationService,
    permission: Permission,
    mutation = false,
  ): RequestHandler =>
  async (req, res, next) => {
    try {
      res.locals.college = await service.authorizedCollege(
        authContext(res).user.id,
        idSchema.parse(req.params.collegeId),
        permission,
        mutation,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
