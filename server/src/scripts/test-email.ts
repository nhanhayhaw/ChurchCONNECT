/**
 * Verify email configuration without waiting for a real password reset.
 *
 *   npm run email:test                      connection check only
 *   npm run email:test -- you@example.com   connection check, then send
 *
 * Run this on every new deployment. Discovering that SMTP is misconfigured
 * because a pastor cannot get back into the system on a Sunday is a bad way to
 * find out.
 */
import { env } from '../config/env.js';
import { verifyTransport, sendMail, isEmailConfigured, closeMailTransport } from '../services/email/email.service.js';
import { testEmail } from '../services/email/templates.js';
import { getPublicBranding } from '../services/settings.service.js';
import { closePool } from '../config/db.js';

async function run(): Promise<void> {
  const recipient = process.argv[2];

  console.log('\nRT AG Connect - email configuration test\n');

  // --- 1. What is configured -------------------------------------------------
  console.log('  Settings');
  console.log(`    SMTP_HOST      : ${env.SMTP_HOST ?? '(not set)'}`);
  console.log(`    SMTP_PORT      : ${env.SMTP_PORT}`);
  console.log(`    SMTP_SECURE    : ${env.smtpSecure}  ${env.smtpSecure ? '(implicit TLS)' : '(STARTTLS)'}`);
  console.log(`    SMTP_USER      : ${env.SMTP_USER ?? '(none - unauthenticated)'}`);
  console.log(`    SMTP_PASSWORD  : ${env.SMTP_PASSWORD ? '(set)' : '(not set)'}`);
  console.log(`    MAIL_FROM      : ${env.MAIL_FROM}`);
  console.log(`    MAIL_REPLY_TO  : ${env.MAIL_REPLY_TO ?? '(none)'}`);
  console.log(`    Link base URL  : ${env.publicUrl}`);
  console.log(`    Token lifetime : ${env.RESET_TOKEN_TTL_MINUTES} minutes\n`);

  if (!isEmailConfigured()) {
    console.log('  RESULT: email is DISABLED (SMTP_HOST is not set).\n');
    console.log('  The application still works. Password reset links are written to the');
    console.log('  server log, and a Super Administrator can reset passwords by hand.');
    console.log('  See docs/EMAIL.md to enable sending.\n');
    return;
  }

  // --- 2. Common misconfiguration --------------------------------------------
  const warnings: string[] = [];
  if (env.SMTP_PORT === 587 && env.smtpSecure) {
    warnings.push('Port 587 with SMTP_SECURE=true will usually fail. Port 587 uses STARTTLS - set SMTP_SECURE=false.');
  }
  if (env.SMTP_PORT === 465 && !env.smtpSecure) {
    warnings.push('Port 465 with SMTP_SECURE=false will usually fail. Port 465 uses implicit TLS - set SMTP_SECURE=true.');
  }
  if (env.MAIL_FROM.includes('localhost')) {
    warnings.push('MAIL_FROM still points at localhost. Set it to an address at a domain you control.');
  }
  if (env.publicUrl.includes('localhost') && env.isProd) {
    warnings.push('CLIENT_ORIGIN is localhost in production - reset links in emails will not work.');
  }
  if (warnings.length > 0) {
    console.log('  Warnings');
    for (const w of warnings) console.log(`    ! ${w}`);
    console.log('');
  }

  // --- 3. Connection ---------------------------------------------------------
  console.log('  Connecting...');
  const check = await verifyTransport();
  console.log(`    ${check.ok ? 'OK  ' : 'FAIL'}  ${check.message}\n`);

  if (!check.ok) {
    console.log('  Common causes:');
    console.log('    - wrong port/secure combination (see warnings above)');
    console.log('    - username or password incorrect');
    console.log('    - provider requires an app-specific password, not the account password');
    console.log('    - outbound port blocked by the host firewall\n');
    process.exitCode = 1;
    return;
  }

  // --- 4. Send ---------------------------------------------------------------
  if (!recipient) {
    console.log('  Connection works. To send a real test message:\n');
    console.log('    npm run email:test -- you@example.com\n');
    return;
  }

  const branding = await getPublicBranding();
  console.log(`  Sending a test message to ${recipient} ...`);

  const result = await sendMail({ to: recipient, ...testEmail(branding) });

  if (result.sent) {
    console.log(`    OK    message id ${result.messageId}\n`);
    console.log('  Now check the inbox - AND the spam folder.');
    console.log('  If it landed in spam, your SPF and DKIM records need attention.');
    console.log('  See docs/EMAIL.md, "Making sure email actually arrives".\n');
  } else {
    console.log(`    FAIL  ${result.reason}\n`);
    process.exitCode = 1;
  }
}

run()
  .catch((err) => {
    console.error('\nEmail test failed:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    closeMailTransport();
    await closePool().catch(() => undefined);
  });
