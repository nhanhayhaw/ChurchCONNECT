# Email setup — self-service password reset

How to turn on outbound email, which provider to use, and how to stop your
messages landing in spam.

**Why this matters commercially:** forgotten passwords are roughly 40% of the
support requests any system with logins receives. Without this, every one of them
is a phone call to you. With it, they are a self-service link.

---

## What is already built

Everything except the mail account. The code is in place and tested:

| Piece | Where |
|---|---|
| SMTP transport, pooled, with graceful degradation | `server/src/services/email/email.service.ts` |
| HTML + plain-text templates | `server/src/services/email/templates.ts` |
| Reset request / completion | `server/src/modules/auth/auth.service.ts` |
| The page members land on | `client/src/pages/ResetPasswordPage.tsx` |
| Configuration check | `npm run email:test` |

Three messages are sent:

1. **Invitation** — when an administrator creates a user account. The new person
   sets their own password; nobody else ever knows it.
2. **Password reset link** — when someone uses *Forgot password?*
3. **Password changed notice** — after a password *reset*, or a change made while
   signed in. This is a security control, not a courtesy: if an attacker resets a
   password, this is how the real owner finds out. It is deliberately **not**
   sent when someone accepts an invitation — telling a brand-new volunteer their
   password "was changed" seconds after they first set it is just confusing.

## It is safe to leave off

With no `SMTP_HOST` set, the system runs normally. Reset links are written to the
server log, and a Super Administrator can still reset passwords by hand from
**Users & Roles**. The *Forgot password?* page detects this and tells the user to
contact an administrator rather than promising an email that will never arrive.

That degradation is deliberate. A broken mail provider must never stop a
congregation signing in on a Sunday morning.

---

# 1. Choose a provider

You need an SMTP account. Do **not** use a personal Gmail account for a system
that sends on behalf of a church — Google throttles it, it sends from your
personal address, and it breaks the moment you enable 2FA properly.

| Provider | Free tier | Notes |
|---|---|---|
| **Brevo** (ex-Sendinblue) | **300/day, permanently** | SMTP + good deliverability; works well from Ghana. **Recommended.** |
| **Resend** | 3,000/month | Excellent developer experience; newer, smaller reputation pool |
| **Mailgun** | Trial only | Solid; billing starts sooner |
| **Amazon SES** | ~$0.10 per 1,000 | Cheapest at scale; sandbox restrictions until you request production access |
| **Zoho Mail** | Paid, from ~$1/user/mo | Sensible if the church also wants real mailboxes |

**Recommendation: Brevo.** 300 emails a day is far beyond what a church needs
(you will send perhaps ten a week), the free tier does not expire, and it
supports the SPF/DKIM setup described below.

Sanity check on volume: a 500-member church with 15 staff logins might send
**20–40 password-related emails in a year**. Every free tier here is enormous by
comparison. Choose on deliverability and ease, not on quota.

---

# 2. Configure Brevo

1. Create an account at brevo.com and verify your own email address.
2. Go to **SMTP & API** → **SMTP** tab.
3. Note the server (`smtp-relay.brevo.com`), port (`587`), and your login.
4. Click **Generate a new SMTP key**. This is your `SMTP_PASSWORD` — it is not
   your account password, and it is shown once.

Then in `server/.env` (or `deploy/.env` in production):

```ini
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-brevo-login@example.com
SMTP_PASSWORD=your-generated-smtp-key

MAIL_FROM="Grace Assembly <no-reply@graceassembly.org>"
MAIL_REPLY_TO=office@graceassembly.org

RESET_TOKEN_TTL_MINUTES=60
```

## The one setting people get wrong

`SMTP_PORT` and `SMTP_SECURE` must agree:

| Port | `SMTP_SECURE` | Why |
|---|---|---|
| **587** | **`false`** | STARTTLS — the connection starts plain and upgrades. This is the normal choice. |
| **465** | **`true`** | Implicit TLS — encrypted from the first byte. |

Setting `SMTP_SECURE=true` on port 587 fails to connect, and the error message is
unhelpful. `npm run email:test` checks for this specific mistake and warns you.

## `MAIL_FROM` must be a domain you control

`no-reply@gmail.com` will be rejected or spam-filed. Use an address at the
church's own domain, or a subdomain of yours (`no-reply@churchconnect.app`).
The address does not need a real mailbox — but the **domain** must be one you can
add DNS records to, which is what section 4 is about.

---

# 3. Test it

```powershell
cd server

# Connection check only
npm run email:test

# Connection check, then send a real message
npm run email:test -- you@example.com
```

The script prints every setting it resolved, warns about the port/TLS mismatch
and other common errors, verifies the connection, and optionally sends.

**Run this on every new deployment.** Discovering that SMTP is misconfigured
because a pastor cannot get back in on a Sunday is a bad way to find out.

In production (inside Docker):

```bash
cd /opt/churchconnect/deploy
docker compose run --rm app npm run email:test:prod -- you@example.com
```

---

# 4. Making sure email actually arrives

Sending is easy. **Landing in the inbox rather than spam is the real work**, and
it is entirely DNS. Skip this and roughly half your reset emails will be missed.

You need three records at your domain's DNS — for you, that is **Namecheap →
Domain List → Manage → Advanced DNS**.

## SPF — states who may send as your domain

| Type | Host | Value |
|---|---|---|
| TXT Record | `@` | `v=spf1 include:spf.brevo.com ~all` |

If you already have an SPF record, **merge them** — a domain must have exactly
one. Two SPF records is worse than none:

```
v=spf1 include:spf.brevo.com include:_spf.google.com ~all
```

## DKIM — cryptographically signs your messages

Brevo generates this for you: **Senders & Domains** → add your domain → it shows
a `TXT` record. It looks like:

| Type | Host | Value |
|---|---|---|
| TXT Record | `mail._domainkey` | `k=rsa;p=MIGfMA0GCSq...` (long) |

Add it exactly as given. Namecheap appends your domain automatically, so enter
`mail._domainkey`, **not** `mail._domainkey.yourdomain.org`. Adding the full
name is the most common mistake here and produces a record that silently does
nothing.

## DMARC — tells receivers what to do when the above fail

| Type | Host | Value |
|---|---|---|
| TXT Record | `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@yourdomain.org` |

Start with `p=none`, which only reports. After a few weeks of clean reports,
tighten to `p=quarantine`.

## Verify

Wait 15–30 minutes, then:

- Send a test to a Gmail address. Open it → **Show original**. You want
  `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
- Or use **mail-tester.com**: send a test to the address it gives you and read
  the score. Aim for 8/10 or better.

## Warm up gently

A brand-new sending domain has no reputation. For the first two weeks, keep
volume low and make sure early recipients actually open the messages. Since you
will be sending a handful of password resets a week, this happens naturally —
just do not import a mailing list on day one.

---

# 5. How the flow works

```
Member clicks "Forgot password?"
   │
   ├─ POST /api/auth/forgot-password  { email }
   │     • always answers the same way, whether or not the address exists
   │     • any earlier unused link for that user is invalidated
   │     • a 32-byte token is generated; only its SHA-256 hash is stored
   │     • the email is queued IN THE BACKGROUND
   │
   ├─ Email arrives: "Set a new password"
   │     → https://church.example.org/reset-password?token=<64 hex chars>
   │
   ├─ ResetPasswordPage reads the token, then scrubs it from the URL
   │
   ├─ POST /api/auth/reset-password  { token, newPassword }
   │     • token must be unused and unexpired
   │     • password re-hashed with Argon2id
   │     • every refresh token for that user is revoked
   │     • a "password changed" notice is emailed
   │
   └─ Member signs in with the new password
```

## The security decisions, and why

**Only the hash of the token is stored.** A database leak yields no usable reset
links. Same reasoning as the refresh tokens.

**Requesting a new link invalidates the previous one.** Otherwise every request a
confused user makes leaves another working key to their account sitting in their
inbox.

**Single use, one hour.** Both configurable through `RESET_TOKEN_TTL_MINUTES`.

**The response never reveals whether an address is registered.** Identical
message either way — and the email is sent *in the background* rather than
awaited, so the response time is the same too. Awaiting the send only when the
user exists would leak the answer through timing, undoing the whole design.

**The token is removed from the browser URL on arrival.** It does not linger in
history, in a screenshot, or in a `Referer` header.

**Every password change emails the owner.** If an attacker resets a password,
this is how the real owner learns of it.

---

# 5b. Inviting users instead of handing out passwords

Before this existed, adding a leader meant: create the account, invent a
temporary password, then tell them what it is — over the phone, or worse, over
WhatsApp. That is an awkward step in every onboarding and a bad habit to teach a
church that is handling members' personal data.

Now **Users & Roles → New user** offers a choice:

| | **Email them an invitation** *(default)* | **Set a temporary password** |
|---|---|---|
| Who chooses the password | They do | You do |
| Do you ever see it? | **No** | Yes |
| Anything to pass on? | No | Yes — and securely |
| Valid for | `INVITE_TOKEN_TTL_DAYS` (7 by default) | Until used |
| Available when email is off | No | Yes |

The invitation option is hidden when the server cannot send email, and the API
refuses it with an explanatory message rather than silently creating an account
nobody can reach.

## What the recipient sees

An email naming who invited them, which church, and what role they have been
given. The link lands on the same page as a password reset — but the page asks
the server what the token is for and changes its wording completely: *"Welcome,
Akosua. You have been given access to the Grace Covenant Assembly membership
system as Church Administrator."*

Until they follow that link, **the account cannot be signed into at all.** It is
created with a random password nobody knows, which is the point.

## Chasing up

The user list shows **Invitation sent** while one is outstanding, and **Never
signed in** for an account that was created with a password and never used.
Either way a send icon appears beside the row to issue a fresh invitation, which
supersedes any earlier link.

Invitations are longer-lived than resets (days rather than an hour) because an
administrator often creates accounts before a training session. An invitation
that expired before the church even met would be useless.

## Where it lives

| Piece | Where |
|---|---|
| Token issuing | `createInvitation()` in `auth.service.ts` |
| What a token is for | `POST /api/auth/token-info` |
| Create-with-invite | `POST /api/users` with `sendInvite: true` |
| Resend | `POST /api/users/:id/resend-invite` |
| Template | `invitationEmail()` in `templates.ts` |
| Schema | `002_invitations.sql` — adds `purpose` to `password_resets` |

Invitations reuse the password-reset token machinery rather than duplicating it:
both are a single-use, expiring, hashed token that authorises setting a password.
Only the wording and the lifetime differ, and both follow from the `purpose`
column.

---

# 6. Rate limits

Set deliberately, because a church office usually shares one public IP address:

| Endpoint | Limit | Notes |
|---|---|---|
| `/auth/login` | 20 failures / 15 min | **Successful sign-ins do not count.** Twenty ushers signing in on a Sunday never trip it. |
| `/auth/forgot-password` | 5 / hour | Tight on purpose — the abuse here is flooding someone's inbox, not guessing a password. |
| `/auth/reset-password` | 15 failures / hour | Generous: someone failing the password rules is a confused member, not an attacker. |

The real defence against a targeted attack is the **per-account lockout** — five
failures locks that one account for fifteen minutes, regardless of IP. These
limiters are defence in depth.

> This was found by testing. Originally all three endpoints shared one bucket of
> 10 requests per 15 minutes, counting successes as well as failures — which
> would have locked out a whole church office on a normal Sunday morning.

---

# 7. Troubleshooting

**`npm run email:test` fails to connect**
Check the port/TLS pairing first (§2). Then confirm the password is the
provider's generated **SMTP key**, not your account password. If it still fails,
your host may block outbound port 587 — try 2525, which Brevo also accepts.

**Mail sends but lands in spam**
DNS. Work through §4 and check the result on mail-tester.com. In practice a
missing or malformed DKIM record is the usual culprit — especially entering
`mail._domainkey.yourdomain.org` where Namecheap expects `mail._domainkey`.

**The reset link points at `localhost`**
`CLIENT_ORIGIN` is wrong. Links are built from it, so in production it must be
the public HTTPS address with no trailing slash.

**"This password reset link is invalid or has expired"**
Expected in four cases: it was already used; it is older than
`RESET_TOKEN_TTL_MINUTES`; a newer link was requested afterwards; or the email
client wrapped the URL across two lines and it was copied incompletely. Ask the
member to request a new one.

**Nothing arrives and nothing is logged**
Confirm `SMTP_HOST` is actually set in the environment the server sees:

```bash
docker compose exec app printenv | grep SMTP
```

**Emails send, but no "password changed" notice**
That notice is only sent when email is configured, and it is fire-and-forget.
Check the server log for `[email] password changed notice`.

---

# 8. Extending this

The plumbing is now in place, so each of these is a template plus one call:

| Feature | Effort | Value |
|---|---|---|
| ~~Welcome / invite email~~ | — | **Built.** See §5b. |
| Weekly absence digest to the pastor | ~4 hours | **High** — brings leaders back into the system without them logging in |
| Birthday reminder emails to department leaders | ~3 hours | Moderate — the setting `birthday_notifications_enabled` already exists |
| Monthly attendance summary to leadership | ~4 hours | Moderate |

**Build the weekly absence digest next.** The alerts are the most valuable thing
this system produces, and today they only exist for someone who signs in and
looks. A Monday-morning email listing who missed the last two Sundays puts the
system's best output in front of a pastor who may not open it otherwise — and it
is the feature most likely to keep a church using it past month three.

The job machinery already exists (`jobs/scheduler.ts`), as does the query
(`getAbsenceAlerts`), so it is a template plus one cron entry.

One caution, since this is a church system holding personal data: **never add
tracking pixels or open-tracking**, and never email a member's personal
information in the body of a message. Everything here links back to the
authenticated application, which is where member data belongs.
