/**
 * Small HTTP helpers shared by every route module.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wrap an async route so a rejected promise reaches the Express error handler.
 * Without this, an await that throws produces a hung request.
 */
export function asyncHandler<T extends RequestHandler>(fn: T): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Read `page` / `pageSize` from the query string with sane bounds. */
export function readPagination(req: Request, defaultSize = 20, maxSize = 200) {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const requested = Number.parseInt(String(req.query.pageSize ?? defaultSize), 10) || defaultSize;
  const pageSize = Math.min(maxSize, Math.max(1, requested));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginate<T>(data: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Whitelist a sort column. Sort fields arrive from the query string, so they
 * can never be interpolated into SQL without passing through a fixed map.
 */
export function safeSort(
  requested: unknown,
  allowed: Record<string, string>,
  fallback: string,
  direction: unknown = 'asc',
): string {
  const key = typeof requested === 'string' ? requested : '';
  const column = allowed[key] ?? allowed[fallback];
  const dir = String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `${column} ${dir}`;
}
