# Deployment — putting RT AG Connect online

Step by step, from a Namecheap domain to a working church system on HTTPS.

Written for someone who has not run a server before. Every command is given in
full. If a step needs a decision, the decision is explained rather than assumed.

---

## Read this first: Namecheap shared hosting will not work

You have a Namecheap account, so start with the thing that will otherwise cost
you a wasted weekend.

**RT AG Connect cannot run on Namecheap Shared Hosting (cPanel).** Two blockers,
either one fatal:

| Requirement | Namecheap shared hosting |
|---|---|
| PostgreSQL database | **Not offered.** Shared plans provide MySQL only. |
| Long-running Node.js process | Restricted; the nightly absence scan and the API need a persistent process |

The application is built on PostgreSQL — the schema uses partial unique indexes,
`JSONB` settings and date functions that MySQL does not have. Porting it is a
rewrite of the data layer, not a configuration change.

**What you use Namecheap for: the domain.** That part is genuinely good value
and the instructions below assume it.

**What you need in addition: somewhere to run the application.** Two supported
paths follow. Read both, then pick.

---

## Choosing a path

| | **Path A — Managed platform** | **Path B — Your own server (VPS)** |
|---|---|---|
| Best for | Your first one to three churches | Four or more churches, or cost control |
| Server administration | None | You are the system administrator |
| Cost per month | ~$14–25 per church | ~$6–12 total, hosting several churches |
| Set-up time | About 1 hour | About 3 hours the first time |
| Backups | Managed, but **verify** they exist | Yours to configure |
| Security patching | Handled | Yours (`unattended-upgrades`) |
| Risk if you disappear | Church can be handed to another developer | Church is stranded unless someone else has the runbook |

**Recommendation.** Start with **Path A** for your first church. You will have
enough to learn about supporting real users without also learning Linux
administration during your first outage. Move to **Path B** once you have three
or more churches, when the per-church cost starts to matter and you have a
routine.

A VPS at Namecheap keeps everything under one vendor, which some people prefer
for billing. It is not technically better than the alternatives.

---

## Which provider? (if Namecheap shared hosting is out)

You need one of two things: a **VPS** (a small Linux server, root access) or a
**managed platform**. Here are the realistic options, judged for a developer in
Ghana selling to Ghanaian churches.

| Provider | ~4 GB plan | Nearest region to Accra | Signup friction | Verdict |
|---|---|---|---|---|
| **Namecheap VPS** | ~$24/mo | UK | **None — you already pay them** | Safe, unexciting, works |
| **Hetzner Cloud** | ~€5/mo | Germany / Finland | Can be strict on ID | **Best value by a wide margin** |
| **DigitalOcean** | $24/mo | Frankfurt, London | Easy; accepts PayPal | Reliable, good docs |
| **Contabo** | ~€6/mo | Germany | Easy | Cheap; mixed performance reports |
| **Render** *(managed)* | ~$15/church | Frankfurt | Easy | No server admin, poor margin |

**Latency reality check.** There is no major cloud region in West Africa. From
Accra you are looking at roughly **90–130 ms to Frankfurt or London**, and
similar to Johannesburg. That is completely fine for this application — pages
are small and the heavy work happens server-side. Do not pay a premium chasing a
closer region; it does not exist.

### What I would actually do

**Take a Hetzner CX-series instance (~€5/month, 4 GB).** At that price a single
server hosts eight churches comfortably, which is about **€0.60 per church per
month** — your margin works from the very first customer. Their network and disk
performance are genuinely excellent for the money.

**The catch:** Hetzner's identity verification is stricter than most and has been
known to reject or delay signups from some countries. Try it first; if you hit a
wall, do not fight it.

**Fall back to Namecheap VPS.** It is roughly four times the price of Hetzner for
similar resources, but there is one advantage that matters more than it looks:
**your payment method already works there.** Getting an international card
accepted by a new provider is a real and common obstacle, and a working billing
relationship is worth paying something for. Everything in Part B below runs
identically on it.

**Choose Render only if** you are certain you do not want to learn server
administration. At ~$15 per church per month it consumes most of the margin on
the 150 GHS tier — it is viable on the Growing tier and above, and a poor fit for
small churches.

### One decision you should not get wrong

Whatever you pick, take **4 GB of RAM, not 2 GB**, the moment you have a second
church. PostgreSQL, Node and the image processing in `sharp` all want memory, and
an out-of-memory kill during a Sunday register is exactly the failure that loses
you a customer. The price difference is a few dollars.

---

# Part 1 — Point your domain (both paths)

Decide your naming before you touch DNS, because it is awkward to change later.

**If you are selling to several churches, use subdomains of one domain you own:**

```
churchconnect.app              your marketing site
graceassembly.churchconnect.app    first church
kingdomchapel.churchconnect.app    second church
```

One certificate mechanism, one deployment routine, and you keep control. This is
the recommended shape.

**If a church insists on its own domain** (`portal.gracechurch.org`), that works
too — they point a record at your server. Note it means their DNS is outside your
control, so a lapse on their side takes their system down and you get the call.

## Setting the DNS record at Namecheap

1. Sign in to Namecheap → **Domain List** → **Manage** beside your domain.
2. Open the **Advanced DNS** tab.
3. Under **Host Records**, remove any parked/placeholder records Namecheap added
   (usually a `CNAME` on `www` pointing to `parkingpage.namecheap.com`, and a
   URL Redirect on `@`). Leaving them causes confusing half-working results.
4. Add records:

**Path A (managed platform), for a subdomain:**

| Type | Host | Value | TTL |
|---|---|---|---|
| CNAME Record | `graceassembly` | *(the hostname your platform gives you)* | Automatic |

**Path B (your own server):**

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `graceassembly` | `203.0.113.45` *(your server's IP)* | Automatic |

For the root domain itself, use `@` as the Host. Namecheap does not support
`CNAME` on `@` — use an **A Record**, or their **ALIAS Record** if you need to
point the root at a hostname.

5. Save (the green tick at the end of the row).

**Wait before continuing.** DNS propagation is usually minutes but can take
hours. Verify from your own machine before you go further:

```powershell
nslookup graceassembly.churchconnect.app
```

You should see your server's IP. **Do not start the server until this resolves** —
Let's Encrypt will try to verify the domain, fail, and you can hit rate limits
that lock you out for an hour.

---

# Part 2, Path A — Managed platform (Render)

Render is used here because it has a free PostgreSQL tier for testing, persistent
disks for the member photographs, and no server administration. Railway and
Fly.io are comparable; the concepts map directly.

## A1. Put the code in a Git repository

The platform deploys from Git. Locally:

```powershell
cd C:\Users\ANP\Desktop\churchconnect
git init
git add .
git commit -m "RT AG Connect initial deployment"
```

Confirm `.gitignore` is doing its job **before** you push:

```powershell
git status --porcelain | Select-String "\.env"
```

That must print **nothing**. If a `.env` appears, stop and fix `.gitignore` —
pushing JWT secrets to a repository means rotating everything.

Create a **private** repository on GitHub and push:

```powershell
git remote add origin https://github.com/YOUR-USERNAME/churchconnect.git
git branch -M main
git push -u origin main
```

Keep it private. It contains a complete member-management system, and public
repositories get scanned for secrets within minutes.

## A2. Create the database

Render dashboard → **New** → **PostgreSQL**.

- Name: `churchconnect-graceassembly`
- Region: closest to the congregation (Frankfurt is usually the best latency to Ghana)
- Plan: the free tier is fine to trial; **move to a paid plan before a real church relies on it** — free databases are deleted after 90 days.

When it is created, copy the **Internal Database URL**.

## A3. Create the API service

**New** → **Web Service** → connect your repository.

| Setting | Value |
|---|---|
| Name | `churchconnect-api` |
| Root Directory | `server` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run migrate:prod && npm start` |
| Plan | Starter ($7/mo) — the free tier sleeps, which stops the nightly absence scan |

Putting `migrate:prod` in the start command means the schema is applied
automatically on every deploy. It is safe to run repeatedly — already-applied
migrations are skipped.

Add a **Disk** (Render → your service → Disks):

- Mount path: `/opt/render/project/src/server/uploads`
- Size: 1 GB (roughly 20,000 member photographs at ~50 KB each)

**Without this disk, every member photograph is deleted on each deploy.** Photos
are stored on the filesystem, and platform filesystems are ephemeral by default.

Environment variables (**Environment** tab):

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *(the Internal Database URL from A2)* |
| `PGSSL` | `true` |
| `CLIENT_ORIGIN` | `https://graceassembly.churchconnect.app` |
| `JWT_ACCESS_SECRET` | *(generate — see below)* |
| `JWT_REFRESH_SECRET` | *(generate — different)* |
| `UPLOAD_DIR` | `/opt/render/project/src/server/uploads` |
| `TZ` | `Africa/Accra` |
| `ENABLE_JOBS` | `true` |

Generate each secret separately:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

They must be **different from each other** and different for **every church**.

## A4. Create the client service

**New** → **Static Site** → same repository.

| Setting | Value |
|---|---|
| Root Directory | `client` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |

Then, critically, add two rules under **Redirects/Rewrites**:

| Source | Destination | Action |
|---|---|---|
| `/api/*` | `https://churchconnect-api.onrender.com/api/*` | Rewrite |
| `/*` | `/index.html` | Rewrite |

The first keeps the browser on one origin, which is what allows the refresh
cookie (`SameSite=Strict`) to work. The second makes client-side routing work —
without it, reloading `/members/42` returns 404.

Order matters: the `/api/*` rule must come first.

## A5. Attach your domain

Static Site → **Settings** → **Custom Domains** → add
`graceassembly.churchconnect.app`. Render shows the CNAME target — put it in the
Namecheap record from Part 1. HTTPS is issued automatically within a few minutes.

## A6. Create the first administrator

The seed script loads 62 fictional demo members and must **not** be run on a real
church's system. Create one real administrator instead. From Render → API
service → **Shell**:

```bash
node --input-type=module -e "
import pg from 'pg';
import argon2 from 'argon2';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
await c.connect();
const roles = JSON.parse(await import('node:fs').then(fs=>'[]'));
const r = await c.query(\"SELECT id FROM roles WHERE name='super_admin'\");
const hash = await argon2.hash('ChangeThisOnFirstLogin!2026', { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
await c.query('INSERT INTO users (full_name,email,password_hash,role_id,must_change_password) VALUES (\$1,\$2,\$3,\$4,TRUE)',
  ['Church Administrator','admin@gracechurch.org',hash,r.rows[0].id]);
console.log('administrator created');
await c.end();
"
```

> The five default roles are inserted by the seed script, not by the migration.
> On a fresh production database run **`npm run seed:prod -- --roles-only`** —
> see *Known gap* at the end of this document; today you must either run the
> full seed on a throwaway database and copy the five role rows, or insert them
> manually. This is the one rough edge in the production path.

Sign in, change the password immediately, then create the church's real users
from **Users & Roles**.

---

# Part 2, Path B — Your own server (VPS)

Fuller control, and the only sensible economics once you host several churches.
Everything is containerised, so the same steps work on Namecheap VPS,
DigitalOcean, Hetzner or Contabo.

## B1. Create the server

Namecheap → **Hosting** → **VPS**. Minimum sensible specification:

| Resource | Minimum | Comfortable |
|---|---|---|
| RAM | 2 GB | 4 GB |
| CPU | 1 core | 2 cores |
| Disk | 40 GB SSD | 80 GB SSD |
| OS | **Ubuntu 24.04 LTS** | Ubuntu 24.04 LTS |

2 GB is a real floor, not a comfortable one: PostgreSQL, Node and the image
processing in `sharp` all want memory. One church runs on 2 GB. Three or more
want 4 GB.

Note the server's IP address and set the DNS A record (Part 1) now, so it has
time to propagate.

## B2. First login and basic hardening

```powershell
ssh root@203.0.113.45
```

Update, then create a non-root user:

```bash
apt update && apt upgrade -y

adduser churchadmin
usermod -aG sudo churchadmin

# Copy your SSH key across so you can log in as the new user
rsync --archive --chown=churchadmin:churchadmin ~/.ssh /home/churchadmin/
```

Open a **second** terminal and confirm `ssh churchadmin@203.0.113.45` works
**before** closing the first. Locking yourself out of a fresh server is a rite of
passage worth skipping.

Now disable password logins and root SSH:

```bash
sudo nano /etc/ssh/sshd_config
```

Set:

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
sudo systemctl restart ssh
```

Firewall — allow only SSH and web:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Note that PostgreSQL's port 5432 is **not** opened. It never should be. The
database is reachable only from inside Docker.

Automatic security updates:

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

## B3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker churchadmin
newgrp docker
docker --version
docker compose version
```

## B4. Get the code onto the server

```bash
sudo mkdir -p /opt/churchconnect
sudo chown churchadmin:churchadmin /opt/churchconnect
git clone https://github.com/YOUR-USERNAME/churchconnect.git /opt/churchconnect
cd /opt/churchconnect/deploy
```

(For a private repository, use a deploy key or a personal access token.)

## B5. Configure

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Fill in every value. Generate the three secrets **on the server**, one at a time:

```bash
openssl rand -base64 30      # POSTGRES_PASSWORD
openssl rand -hex 48         # JWT_ACCESS_SECRET
openssl rand -hex 48         # JWT_REFRESH_SECRET
```

Set `DOMAIN` to the exact hostname whose DNS you pointed here. Caddy requests a
certificate for precisely this name.

Set `TZ` to the church's timezone. The nightly absence scan and the morning
birthday job run on local time; getting this wrong shifts both by hours.

## B6. Start it

```bash
cd /opt/churchconnect/deploy
docker compose up -d --build
```

First build takes 3–5 minutes. Then:

```bash
docker compose ps          # all three services should be "running"/"healthy"
docker compose logs -f web # watch Caddy obtain the certificate
```

You are looking for `certificate obtained successfully`. If instead you see a
challenge failure, DNS is not pointing here yet — fix that and restart `web`.

## B7. Create the schema

```bash
docker compose run --rm app npm run migrate:prod
```

Expected output: `+ 001_init.sql` then `Applied 1 migration(s).`

## B8. Create the first administrator

Same caveat as Path A: **do not run the seed on a real church's system.** See the
*Known gap* below, then create the church's Super Administrator, sign in, change
the password, and build the real user list from **Users & Roles**.

## B9. Set up backups

```bash
cd /opt/churchconnect/deploy
chmod +x backup.sh
./backup.sh          # run once by hand and read the output
crontab -e
```

Add:

```
15 2 * * * cd /opt/churchconnect/deploy && ./backup.sh >> /var/log/cc-backup.log 2>&1
```

Then read **[OPERATIONS.md](OPERATIONS.md)** and actually perform the restore
drill. A backup you have never restored is a hope, not a backup.

---

# Part 3 — Verify the deployment

Work through all of these before handing anything to a church.

| # | Check | Expected |
|---|---|---|
| 1 | Visit `https://your-domain` | Login page, padlock in the address bar |
| 2 | `https://your-domain/api/health` | `{"status":"ok",...}` |
| 3 | Sign in as the administrator | Dashboard loads |
| 4 | Forced password change on first login | Prompted |
| 5 | Register a test member **with a photograph** | Photo displays on the profile |
| 6 | Restart the stack, reload the member | **Photo still there** — proves the volume works |
| 7 | Record and finalise an attendance register | Saves; alert count reported |
| 8 | Open **Follow-Up → Alerts** | Loads (likely empty at first) |
| 9 | Export a report to PDF and to Excel | Both download and open |
| 10 | Visit `https://your-domain/members/1` directly | Loads — SPA rewrite works |
| 11 | `curl -I https://your-domain` | `strict-transport-security` present |
| 12 | Try `http://your-domain` | Redirects to HTTPS |
| 13 | Run `./backup.sh` | Two files in `backups/`, both non-empty |
| 14 | **Restore that backup to a scratch database** | Member count matches |
| 15 | Delete the test member | Gone from the list |

Step 6 and step 14 are the two people skip and the two that cost you a church's
data. Do them.

---

# Part 4 — Hosting several churches on one server

Path B scales to roughly 5–10 small churches on a 4 GB server by running one
stack per church. Each gets its own database, its own uploads volume, its own
secrets — so a mistake on one cannot touch another.

```bash
/opt/churches/
  graceassembly/     # a full clone of the repo, its own deploy/.env
  kingdomchapel/
  livingword/
```

Two changes are needed:

**1. Only one stack can own ports 80/443.** Run a single shared Caddy instance in
front, and have each church's stack expose only its API and static files on the
internal network. Practically: give each stack a distinct compose project name
(`name: cc-graceassembly`) and a shared external Docker network.

**2. Give each stack a distinct name** so volumes do not collide:

```yaml
name: cc-graceassembly
```

Without this, two stacks share `churchconnect_db-data` and **two churches write
to one database.** That is the single most dangerous mistake available in this
setup — verify with `docker volume ls` after adding a church.

Be honest with yourself about the ceiling: one stack per church means one
database, one Node process and one certificate per church, and every update is
repeated per church. Past about ten, read
**[GOING-COMMERCIAL.md](GOING-COMMERCIAL.md)** on proper multi-tenancy — the
per-church model stops being an economy and becomes your full-time job.

---

# Part 5 — Deploying an update

**Path A:** push to `main`. Render rebuilds and redeploys; `migrate:prod` runs on
start.

**Path B:**

```bash
cd /opt/churchconnect/deploy
./backup.sh                                   # always, before anything
git pull
docker compose up -d --build
docker compose run --rm app npm run migrate:prod
docker compose ps
curl -sS https://your-domain/api/health
```

Expect roughly 30–60 seconds of downtime while containers restart. Deploy on a
**Tuesday morning**, never a Saturday night — if something breaks you want a
working week ahead of you, not a Sunday service.

---

# Troubleshooting

**Caddy will not obtain a certificate**
DNS is not pointing at the server yet, or port 80 is blocked. Check
`dig +short your-domain` and `sudo ufw status`. Let's Encrypt needs port 80
reachable even though the site ends up on 443.

**`502 Bad Gateway`**
The API is down. `docker compose logs app --tail=50`. Most often a bad
`DATABASE_URL` or a missing secret in `.env`.

**The API exits at startup with `schema not found`**
Migrations have not run: `docker compose run --rm app npm run migrate:prod`.

**Member photographs vanish after a deploy**
The uploads volume is not mounted (Path B) or the disk is not attached (Path A).
Photos gone this way are unrecoverable unless you have a backup — fix the mount,
then restore from `uploads_*.tar.gz`.

**Login works, then every request returns 401**
`CLIENT_ORIGIN` does not match the address in the browser, so the `SameSite=Strict`
refresh cookie is rejected. It must be the exact origin, including `https://` and
no trailing slash.

**Absence alerts never appear**
Three things to check, in order: registers must be **finalised** (not just
saved); `ENABLE_JOBS` must be `true`; and the service type must be in the tracked
list under **Settings → Absence monitoring**. You can always force a scan from
**Follow-Up → Alerts → Run absence scan**.

**Everything is slow, or the API is killed repeatedly**
Out of memory. `free -h` and `docker stats`. Add swap or move to a larger
instance; `sharp` in particular spikes during photo uploads.

---

# Known gap — role seeding on a fresh production database

The five default roles (Super Administrator, Pastor, Church Administrator,
Department Leader, Viewer) are currently created by **`npm run seed`**, together
with 62 fictional demo members. There is no "roles only" option, so a genuinely
clean production install has no roles until you add them.

Until that is fixed, use whichever of these suits you:

1. **Recommended:** run the full seed on a **throwaway** database, `pg_dump` the
   five `roles` rows, and restore just those into the church's database.
2. Insert the five roles by hand from `server/src/config/permissions.ts`, which
   holds the exact names, labels and permission arrays.
3. Run the full seed on the church's database, then delete the 62 demo members
   and 5 demo users before handover. **Verify the deletion carefully** — handing a
   church a system containing fictional people is a bad first impression, and
   the demo accounts all share one published password.

The proper fix is a `--roles-only` flag on the seed script and a separate
`create-admin` script. Both are small; they are listed as pre-sale work in
[GOING-COMMERCIAL.md](GOING-COMMERCIAL.md).

---

# Cost summary

**Path A, per church, per month**

| Item | Cost |
|---|---|
| Render web service (Starter) | $7 |
| Render PostgreSQL (Basic) | $7 |
| Persistent disk, 1 GB | ~$0.25 |
| Domain (amortised) | ~$1 |
| **Total** | **~$15** |

**Path B, one server, several churches**

| Item | Cost |
|---|---|
| VPS, 4 GB | $12–24 |
| Domain | ~$1/mo |
| Off-site backup storage | ~$1–5 |
| **Total for up to ~8 churches** | **$14–30** |

Path B is roughly **$3 per church per month** at eight churches, against $15 on
Path A — but it costs you the system administration. Price your own time in
before deciding.
