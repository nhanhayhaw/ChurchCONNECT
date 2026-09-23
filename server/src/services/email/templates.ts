/**
 * Email templates.
 *
 * Constraints that shape every decision here:
 *  - Email clients are not browsers. Outlook renders with Microsoft Word's
 *    engine, Gmail strips <style> blocks. So: tables for layout, inline styles
 *    only, no flexbox, no grid, no external CSS, no web fonts.
 *  - Every message ships a plain-text alternative. It is not optional courtesy:
 *    a message with no text part scores badly with spam filters, and some
 *    security gateways deliver only the text part.
 *  - Links are written out in full in the text version, because "click here"
 *    is useless in plain text and because a visible URL lets a cautious user
 *    verify the domain before clicking.
 *  - No images. No tracking pixel. A church system that quietly reports who
 *    opened its email would deserve to lose the church's trust.
 */
import { env } from '../../config/env.js';

const NAVY = '#0F2A4A';
const GOLD = '#B8892B';
const INK = '#0F172A';
const MUTED = '#64748B';
const RULE = '#E2E8F0';

export interface Branding {
  churchName: string;
  tagline: string;
}

/** Shared shell: header bar, body, footer. */
function layout(branding: Branding, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(branding.churchName)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;">
  <!-- Preheader is hidden but is what most clients show in the inbox list. -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid ${RULE};">

          <tr>
            <td style="background-color:${NAVY};padding:22px 28px;">
              <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:2px;color:#FFFFFF;">
                RT AG CONNECT
              </div>
              <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;color:${GOLD};padding-top:3px;">
                ${escapeHtml(branding.churchName)}
              </div>
            </td>
          </tr>

          <tr><td style="height:3px;background-color:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>

          <tr>
            <td style="padding:30px 28px 26px 28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:${INK};">
              ${bodyHtml}
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 22px 28px;border-top:1px solid ${RULE};font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:${MUTED};">
              This is an automated message from the ${escapeHtml(branding.churchName)} membership system.
              Please do not reply to it.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** A navy call-to-action button that survives Outlook. */
function button(url: string, label: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">
  <tr>
    <td align="center" bgcolor="${NAVY}" style="border-radius:8px;">
      <a href="${escapeAttr(url)}"
         style="display:inline-block;padding:13px 28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">
        ${escapeHtml(label)}
      </a>
    </td>
  </tr>
</table>`;
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export function passwordResetEmail(opts: {
  branding: Branding;
  fullName: string;
  resetUrl: string;
  expiryMinutes: number;
}): { subject: string; html: string; text: string } {
  const { branding, fullName, resetUrl, expiryMinutes } = opts;
  const firstName = fullName.trim().split(/\s+/)[0] ?? 'there';

  const html = layout(
    branding,
    `
<p style="margin:0 0 16px 0;">Hello ${escapeHtml(firstName)},</p>

<p style="margin:0 0 16px 0;">
  We received a request to reset the password for your ${escapeHtml(branding.churchName)}
  membership system account.
</p>

<p style="margin:0;">Choose a new password using the button below.</p>

${button(resetUrl, 'Set a new password')}

<p style="margin:0 0 16px 0;color:${MUTED};font-size:13px;">
  Or copy this link into your browser:<br>
  <a href="${escapeAttr(resetUrl)}" style="color:${NAVY};word-break:break-all;">${escapeHtml(resetUrl)}</a>
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="margin:22px 0 0 0;background-color:#F8FAFC;border-left:3px solid ${GOLD};">
  <tr>
    <td style="padding:14px 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:${INK};">
      This link expires in <strong>${expiryMinutes} minutes</strong> and can be used once.
    </td>
  </tr>
</table>

<p style="margin:22px 0 0 0;color:${MUTED};font-size:13px;">
  <strong>If you did not request this,</strong> you can ignore this message - your password
  has not been changed. If you receive these repeatedly, tell a church administrator.
</p>
`,
  );

  const text = `Hello ${firstName},

We received a request to reset the password for your ${branding.churchName}
membership system account.

Set a new password here:
${resetUrl}

This link expires in ${expiryMinutes} minutes and can be used once.

If you did not request this, ignore this message - your password has not been
changed. If you receive these repeatedly, tell a church administrator.

--
${branding.churchName}
This is an automated message. Please do not reply.`;

  return {
    subject: `Reset your ${branding.churchName} password`,
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Password changed - a security notice, not a courtesy
// ---------------------------------------------------------------------------

export function passwordChangedEmail(opts: {
  branding: Branding;
  fullName: string;
  changedAt: Date;
  ipAddress?: string | null;
}): { subject: string; html: string; text: string } {
  const { branding, fullName, changedAt, ipAddress } = opts;
  const firstName = fullName.trim().split(/\s+/)[0] ?? 'there';
  const when = changedAt.toUTCString();
  const signInUrl = `${env.publicUrl}/login`;

  const html = layout(
    branding,
    `
<p style="margin:0 0 16px 0;">Hello ${escapeHtml(firstName)},</p>

<p style="margin:0 0 16px 0;">
  The password for your ${escapeHtml(branding.churchName)} membership system account
  was changed.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="margin:0 0 18px 0;background-color:#F8FAFC;">
  <tr>
    <td style="padding:14px 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;line-height:21px;color:${INK};">
      <strong>When:</strong> ${escapeHtml(when)}<br>
      ${ipAddress ? `<strong>From:</strong> ${escapeHtml(ipAddress)}` : ''}
    </td>
  </tr>
</table>

<p style="margin:0 0 16px 0;">You have been signed out on every device and will need to sign in again.</p>

${button(signInUrl, 'Sign in')}

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="margin:6px 0 0 0;background-color:#FEF2F2;border-left:3px solid #D03B3B;">
  <tr>
    <td style="padding:14px 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:${INK};">
      <strong>If this was not you,</strong> contact a Super Administrator immediately and ask
      them to deactivate your account. Someone may have access to it.
    </td>
  </tr>
</table>
`,
  );

  const text = `Hello ${firstName},

The password for your ${branding.churchName} membership system account was changed.

When: ${when}
${ipAddress ? `From: ${ipAddress}\n` : ''}
You have been signed out on every device and will need to sign in again:
${signInUrl}

IF THIS WAS NOT YOU, contact a Super Administrator immediately and ask them to
deactivate your account. Someone may have access to it.

--
${branding.churchName}
This is an automated message. Please do not reply.`;

  return {
    subject: `Your ${branding.churchName} password was changed`,
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Invitation - an administrator created an account for someone
// ---------------------------------------------------------------------------

export function invitationEmail(opts: {
  branding: Branding;
  fullName: string;
  roleLabel: string;
  invitedByName: string;
  inviteUrl: string;
  expiryDays: number;
}): { subject: string; html: string; text: string } {
  const { branding, fullName, roleLabel, invitedByName, inviteUrl, expiryDays } = opts;
  const firstName = fullName.trim().split(/\s+/)[0] ?? 'there';

  const html = layout(
    branding,
    `
<p style="margin:0 0 16px 0;">Hello ${escapeHtml(firstName)},</p>

<p style="margin:0 0 16px 0;">
  ${escapeHtml(invitedByName)} has created an account for you on the
  ${escapeHtml(branding.churchName)} membership system, as
  <strong>${escapeHtml(roleLabel)}</strong>.
</p>

<p style="margin:0;">Choose your own password to get started. Nobody else will know it.</p>

${button(inviteUrl, 'Set your password')}

<p style="margin:0 0 16px 0;color:${MUTED};font-size:13px;">
  Or copy this link into your browser:<br>
  <a href="${escapeAttr(inviteUrl)}" style="color:${NAVY};word-break:break-all;">${escapeHtml(inviteUrl)}</a>
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="margin:22px 0 0 0;background-color:#F8FAFC;border-left:3px solid ${GOLD};">
  <tr>
    <td style="padding:14px 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:${INK};">
      This invitation expires in <strong>${expiryDays} day${expiryDays === 1 ? '' : 's'}</strong>.
      If it runs out, ask ${escapeHtml(invitedByName)} to send another.
    </td>
  </tr>
</table>

<p style="margin:22px 0 0 0;color:${MUTED};font-size:13px;">
  This system holds personal information about members of the congregation.
  Please keep your password private and do not share your account.
</p>

<p style="margin:14px 0 0 0;color:${MUTED};font-size:13px;">
  If you were not expecting this, you can ignore it - the account cannot be used
  until someone sets a password.
</p>
`,
  );

  const text = `Hello ${firstName},

${invitedByName} has created an account for you on the ${branding.churchName}
membership system, as ${roleLabel}.

Choose your own password here:
${inviteUrl}

This invitation expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}. If it runs out, ask
${invitedByName} to send another.

This system holds personal information about members of the congregation.
Please keep your password private and do not share your account.

If you were not expecting this, you can ignore it - the account cannot be used
until someone sets a password.

--
${branding.churchName}
This is an automated message. Please do not reply.`;

  return {
    subject: `You have been given access to the ${branding.churchName} membership system`,
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Test message - used by `npm run email:test`
// ---------------------------------------------------------------------------

export function testEmail(branding: Branding): { subject: string; html: string; text: string } {
  return {
    subject: `RT AG Connect email test - ${branding.churchName}`,
    html: layout(
      branding,
      `
<p style="margin:0 0 16px 0;"><strong>Your email configuration works.</strong></p>
<p style="margin:0 0 16px 0;">
  If you are reading this, RT AG Connect can send password reset links and security
  notices to your members and staff.
</p>
<p style="margin:0;color:${MUTED};font-size:13px;">
  Sent from ${escapeHtml(env.SMTP_HOST ?? 'unknown host')} at ${escapeHtml(new Date().toUTCString())}.
</p>`,
    ),
    text: `Your email configuration works.

If you are reading this, RT AG Connect can send password reset links and
security notices to your members and staff.

Sent from ${env.SMTP_HOST ?? 'unknown host'} at ${new Date().toUTCString()}.`,
  };
}

// ---------------------------------------------------------------------------

/**
 * Escape untrusted text before it enters HTML.
 *
 * A member's name reaches these templates from the database, and a name
 * containing markup would otherwise be injected into the email body.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
