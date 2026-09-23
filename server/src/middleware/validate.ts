/**
 * Request validation.
 *
 * Every route that accepts input runs it through a Zod schema first. The
 * parsed (and coerced) result replaces req.body / req.query, so handlers only
 * ever see values that already satisfy the schema.
 */
import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    // req.query is a getter-only property on Express 5; assign through defineProperty
    // to stay compatible with both major versions.
    Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    next();
  };
}

export function validateParams(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) return next(result.error);
    Object.defineProperty(req, 'params', { value: result.data, writable: true, configurable: true });
    next();
  };
}
