/**
 * Environment configuration.
 *
 * Parsed once, at boot, through a Zod schema. If a required secret is missing
 * or too weak the process refuses to start - a loud failure at deploy time is
 * far better than a silently insecure server.
 */
import 'dotenv/config';
import { z } from 'zod';
import path from 'node:path';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PGSSL: z.enum(['true', 'false']).default('false'),

  // 32 chars is the practical floor for an HMAC secret worth having.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // Broad per-IP ceiling on /api. Keyed by client IP, so a whole church behind
  // one NAT address shares a single bucket - raise it for a large congregation
  // taking attendance from many devices on the church Wi-Fi.
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),

  // How many reverse proxies sit in front of the API in production. 1 for a
  // platform router alone (Render, Railway); 2 when a CDN rewrite such as
  // Vercel's /api/* proxy sits in front of that. Wrong and every visitor
  // shares one rate-limit bucket, or X-Forwarded-For can be spoofed.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  // Upper bound on simultaneous database connections from THIS process. A
  // hosted pooler caps connections per project - Supabase free tier allows 15
  // in session mode, shared by every client - and exceeding it fails requests
  // outright with EMAXCONNSESSION rather than queueing. The dashboard fans
  // out about a dozen queries at once, so keep this comfortably below the
  // cap, leaving room for a migration run or a developer session alongside.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(3 * 1024 * 1024),

  // --- Outbound email ------------------------------------------------------
  // All optional. With no SMTP_HOST the application still runs; password reset
  // links are written to the server log instead of being sent, and a Super
  // Administrator can still reset passwords by hand. That degradation is
  // deliberate: a misconfigured mail server must not stop a church signing in.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // true only for implicit TLS on port 465. Port 587 uses STARTTLS, which
  // nodemailer negotiates automatically with secure=false.
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  // Must be an address at a domain you control and have authorised (SPF/DKIM),
  // or the message lands in spam. See docs/EMAIL.md.
  MAIL_FROM: z.string().default('RT AG Connect <no-reply@localhost>'),
  MAIL_REPLY_TO: z.string().optional(),
  // Minutes a password-reset link stays valid.
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(60),
  // Days an invitation stays valid. Longer than a reset on purpose: an
  // administrator often creates accounts days before a training session, and an
  // invitation that expired before the church even met would be useless.
  INVITE_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(7),

  ENABLE_JOBS: z.enum(['true', 'false']).default('true'),
  ABSENCE_JOB_CRON: z.string().default('30 1 * * *'),
  BIRTHDAY_JOB_CRON: z.string().default('0 6 * * *'),
  TZ: z.string().default('Africa/Accra'),

  SEED_DEFAULT_PASSWORD: z.string().default('ChurchConnect#2026'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nRT AG Connect cannot start - invalid environment:\n${issues}\n\nCopy server/.env.example to server/.env and complete it.\n`);
  process.exit(1);
}

const raw = parsed.data;

// Refuse to boot production with the placeholder secrets from .env.example.
if (raw.NODE_ENV === 'production') {
  const weak = [raw.JWT_ACCESS_SECRET, raw.JWT_REFRESH_SECRET].some((s) => s.includes('change-me'));
  if (weak) {
    // eslint-disable-next-line no-console
    console.error('Refusing to start in production with example JWT secrets. Generate real ones.');
    process.exit(1);
  }
}

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  pgSsl: raw.PGSSL === 'true',
  jobsEnabled: raw.ENABLE_JOBS === 'true',
  uploadDir: path.resolve(process.cwd(), raw.UPLOAD_DIR),
  smtpSecure: raw.SMTP_SECURE === 'true',
  /** True once enough is configured to actually send mail. */
  emailEnabled: Boolean(raw.SMTP_HOST),
  /**
   * The origin used to build links inside emails.
   * CLIENT_ORIGIN may hold a comma-separated allow-list for CORS; a link can
   * only have one destination, so the first entry wins.
   */
  publicUrl: raw.CLIENT_ORIGIN.split(',')[0]!.trim().replace(/\/$/, ''),
};

export type Env = typeof env;
