/**
 * Outbound email.
 *
 * WHY SMTP RATHER THAN A VENDOR SDK
 * Every transactional provider worth using (Brevo, Resend, Mailgun, SendGrid,
 * Amazon SES, Zoho, a self-hosted server) speaks SMTP. Writing to SMTP means one
 * implementation, no vendor lock-in, and a church can be moved between providers
 * by editing four environment variables. A provider SDK would buy nothing here
 * except a dependency.
 *
 * GRACEFUL DEGRADATION IS DELIBERATE
 * With no SMTP_HOST configured the application still runs normally. Password
 * reset links are written to the server log instead of being sent, and a Super
 * Administrator can still reset passwords by hand from Users & Roles. A
 * misconfigured mail server must never stop a congregation signing in on a
 * Sunday morning.
 *
 * SENDS ARE NEVER AWAITED BY A REQUEST HANDLER
 * See sendInBackground(). Two reasons: an SMTP server that hangs would hang the
 * HTTP request with it, and if /forgot-password waited for a send only when the
 * address existed, the response time itself would reveal which addresses are
 * registered - defeating the deliberate anti-enumeration design in auth.service.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';

let transporter: Transporter | null = null;
let transportFailed = false;

export function isEmailConfigured(): boolean {
  return env.emailEnabled;
}

function getTransporter(): Transporter | null {
  if (!env.emailEnabled) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // secure: true means implicit TLS (port 465). On 587 this must be false so
    // nodemailer negotiates STARTTLS - setting it true there fails to connect,
    // which is the single most common SMTP misconfiguration.
    secure: env.smtpSecure,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    // Modest pool: this application sends a handful of messages a day, not a
    // newsletter run.
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

/**
 * Send one message. Resolves with sent:false rather than throwing - callers are
 * expected to carry on regardless.
 */
export async function sendMail(message: MailMessage): Promise<SendResult> {
  const transport = getTransporter();

  if (!transport) {
    return { sent: false, reason: 'email_not_configured' };
  }

  try {
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      replyTo: env.MAIL_REPLY_TO || undefined,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: {
        // Stops well-behaved mail clients from auto-replying with an
        // out-of-office to a no-reply address.
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
      },
    });

    transportFailed = false;
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    const reason = (err as Error).message;

    // Log the first failure loudly; after that stay quiet so a dead SMTP server
    // cannot flood the log on every request.
    if (!transportFailed) {
      console.error(`[email] send failed to ${redact(message.to)}: ${reason}`);
      console.error('[email] further failures will be logged quietly until a send succeeds.');
      transportFailed = true;
    } else {
      console.warn(`[email] send failed (suppressed): ${reason}`);
    }

    return { sent: false, reason };
  }
}

/**
 * Fire-and-forget send. Use this from request handlers.
 *
 * `void` on the promise is intentional: the caller must not await it, so that
 * response timing carries no information about whether an address exists.
 */
export function sendInBackground(message: MailMessage, context: string): void {
  void sendMail(message)
    .then((result) => {
      if (result.sent) {
        console.log(`[email] ${context} -> ${redact(message.to)} (${result.messageId})`);
      } else if (result.reason === 'email_not_configured') {
        console.warn(`[email] ${context} NOT SENT to ${redact(message.to)} - SMTP is not configured.`);
      }
    })
    .catch((err) => console.error('[email] unexpected send error:', err));
}

/** Partially mask an address before it reaches a log file. */
function redact(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  const head = local!.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local!.length - 2))}@${domain}`;
}

/**
 * Check the SMTP settings without sending anything.
 * Used by `npm run email:test` and worth running on every new deployment.
 */
export async function verifyTransport(): Promise<{ ok: boolean; message: string }> {
  if (!env.emailEnabled) {
    return { ok: false, message: 'SMTP_HOST is not set - email is disabled.' };
  }

  const transport = getTransporter();
  if (!transport) return { ok: false, message: 'Transport could not be created.' };

  try {
    await transport.verify();
    return { ok: true, message: `Connected to ${env.SMTP_HOST}:${env.SMTP_PORT} successfully.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Release pooled connections on shutdown. */
export function closeMailTransport(): void {
  transporter?.close();
  transporter = null;
}
