/**
 * Express application assembly.
 *
 * Middleware order matters and is deliberate:
 *   helmet -> cors -> body parsers -> rate limit -> routes -> 404 -> errors.
 * Security headers go on first so they are present even on error responses.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env } from './config/env.js';
import { pool } from './config/db.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import authRoutes from './modules/auth/auth.routes.js';
import memberRoutes from './modules/members/members.routes.js';
import attendanceRoutes from './modules/attendance/attendance.routes.js';
import followUpRoutes from './modules/followups/followups.routes.js';
import birthdayRoutes from './modules/birthdays/birthdays.routes.js';
import departmentRoutes from './modules/departments/departments.routes.js';
import groupRoutes from './modules/groups/groups.routes.js';
import reportRoutes from './modules/reports/reports.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import userRoutes from './modules/users/users.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import searchRoutes from './modules/search/search.routes.js';

export function createApp() {
  const app = express();

  // Behind exactly one reverse proxy in production (nginx / a platform router).
  // Trusting a specific hop rather than `true` keeps X-Forwarded-For spoofing
  // from defeating the rate limiter.
  app.set('trust proxy', env.isProd ? env.TRUST_PROXY : false);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and images only; the React client is served
      // separately, so a strict default CSP here costs nothing.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin: env.CLIENT_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true, // required for the refresh-token cookie
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(compression());
  app.use(cookieParser());
  // A 1 MB JSON ceiling is ample for a 5,000-row attendance register and
  // small enough that a malicious payload cannot exhaust memory.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  if (!env.isProd) app.use(morgan('dev'));

  // Health is registered BEFORE the rate limiter so a monitoring probe never
  // competes with visitors for the per-IP budget, and it checks the database
  // rather than only the process: a 200 from an instance that has lost its
  // database would keep a load balancer routing traffic into failures.
  app.get('/api/health', async (_req, res) => {
    const base = { service: 'churchconnect-api', time: new Date().toISOString() };
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('database probe timed out')), 2_000).unref()),
      ]);
      res.json({ status: 'ok', database: 'ok', ...base });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable', ...base });
    }
  });

  // Broad limiter; the credential endpoints add a much tighter one of their own.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: env.API_RATE_LIMIT_PER_MINUTE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        error: { code: 'rate_limited', message: 'Too many requests. Please slow down and try again shortly.' },
      },
    }),
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/members', memberRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/follow-ups', followUpRoutes);
  app.use('/api/birthdays', birthdayRoutes);
  app.use('/api/departments', departmentRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api/search', searchRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
