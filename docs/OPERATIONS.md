# Operations runbook

What to do when RT AG Connect is live and something needs attention.

Written to be read **under pressure**. Procedures first, explanation second.
Keep a copy somewhere you can reach when the server is down — not only on the
server.

---

## Emergency contact sheet

Fill this in before your first church goes live. Print it.

| | |
|---|---|
| Server IP / SSH | `ssh churchadmin@___________` |
| Hosting provider + account | ___________ |
| Domain registrar | Namecheap — ___________ |
| Off-site backup location | ___________ |
| Church's main contact | ___________ |
| Escalation (second developer) | ___________ |

---

# Daily / weekly / monthly

| Frequency | Task | Time |
|---|---|---|
| Daily (automatic) | Backup at 02:15 | — |
| **Weekly** | Confirm last night's backup exists and is non-empty | 2 min |
| **Weekly** | Skim `docker compose logs app --tail=200` for repeated errors | 5 min |
| **Monthly** | **Restore drill** — restore to a scratch database | 20 min |
| **Monthly** | `sudo apt update && sudo apt list --upgradable` | 5 min |
| **Monthly** | Check disk: `df -h` and `docker system df` | 2 min |
| **Quarterly** | Review user accounts with the church — remove people who have left | 15 min |
| **Quarterly** | Rebuild images to pick up base-image security patches | 15 min |

The weekly backup check is two minutes and is the single highest-value habit
here:

```bash
ls -lh /opt/churchconnect/deploy/backups | tail -5
```

If the newest file is older than yesterday, or is 0 bytes, treat it as an
incident. Backups fail silently — usually because the disk filled up.

---

# Backup and restore

## Verify a backup is real

A file existing is not proof it can be restored. This confirms the dump is
readable and contains what it should:

```bash
cd /opt/churchconnect/deploy
LATEST=$(ls -t backups/db_*.dump | head -1)
docker compose exec -T db pg_restore --list "/backups/$(basename $LATEST)" | head -20
```

You should see a table of contents listing `members`, `attendance`, `follow_ups`
and the rest. An error here means the dump is corrupt.

## The restore drill — do this monthly

Restore into a **scratch** database. This never touches live data, so it is safe
to practise.

```bash
cd /opt/churchconnect/deploy
source .env
LATEST=$(ls -t backups/db_*.dump | head -1)

# 1. Create a scratch database
docker compose exec -T db createdb -U "$POSTGRES_USER" restore_test

# 2. Restore into it
docker compose exec -T db pg_restore \
  --username "$POSTGRES_USER" --dbname restore_test --no-owner \
  "/backups/$(basename $LATEST)"

# 3. Prove the data is there
docker compose exec -T db psql -U "$POSTGRES_USER" -d restore_test -c \
  "SELECT (SELECT COUNT(*) FROM members) AS members,
          (SELECT COUNT(*) FROM attendance) AS marks,
          (SELECT COUNT(*) FROM follow_ups) AS follow_ups,
          (SELECT MAX(service_date) FROM attendance_services) AS latest_service;"

# 4. Clean up
docker compose exec -T db dropdb -U "$POSTGRES_USER" restore_test
```

Compare those counts against the live system. If they match, your backups work.
**Write the date in a log somewhere.** If they do not match, you have found a
problem on a Tuesday afternoon rather than during a real disaster.

## Real restore — the database is damaged

> Stop and think first. If the problem is one bad deletion, `member.restore` or a
> single `UPDATE` is far less disruptive than restoring the whole database and
> losing everything recorded since the backup.

```bash
cd /opt/churchconnect/deploy

# 1. Stop the API so nothing writes during the restore
docker compose stop app

# 2. Take a dump of the CURRENT broken state first - you may need it
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom > "backups/PRE-RESTORE_$(date +%F_%H%M).dump"

# 3. Recreate the database
source .env
docker compose exec -T db dropdb   -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T db createdb -U "$POSTGRES_USER" "$POSTGRES_DB"

# 4. Restore
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner "/backups/db_2026-08-10_021500.dump"

# 5. Bring the API back
docker compose start app
curl -sS https://your-domain/api/health
```

Step 2 is not optional. Restoring over a broken database destroys the evidence of
what went wrong.

## Real restore — member photographs

```bash
cd /opt/churchconnect/deploy
docker compose stop app
docker compose run --rm --no-deps \
  -v "$(pwd)/backups:/backup" \
  app tar xzf /backup/uploads_2026-08-10_021500.tar.gz -C /app
docker compose start app
```

## Total loss — rebuilding on a new server

1. Provision a new server, follow **DEPLOYMENT.md** Part B, steps B1–B6.
2. **Do not** run `migrate:prod` — the restore brings the schema with it.
3. Copy the newest `db_*.dump` and `uploads_*.tar.gz` to `deploy/backups/`.
4. Restore both, as above.
5. Update the Namecheap DNS A record to the new IP.
6. Wait for propagation, then work through the Part 3 verification list.

Realistic time: **60–90 minutes** if you have off-site backups. Indefinite if you
do not. That difference is the entire argument for the off-site copy.

---

# Common incidents

### The site is completely down

```bash
cd /opt/churchconnect/deploy
docker compose ps
```

| What you see | Do this |
|---|---|
| All three `running` | Not the app — check DNS and the provider status page |
| `app` restarting | `docker compose logs app --tail=100` |
| `db` unhealthy | Usually a full disk: `df -h` |
| Nothing running | `docker compose up -d`; check the server rebooted cleanly |

### Disk full

The most common cause of a self-inflicted outage.

```bash
df -h
docker system df
du -sh /opt/churchconnect/deploy/backups
```

Reclaim:

```bash
docker system prune -a --volumes   # CAREFUL: read the warning below
```

**Never run `--volumes` without checking what it will remove.** Your database and
uploads live in volumes. Safer:

```bash
docker image prune -a          # unused images only
find backups -name '*.dump' -mtime +30 -delete
sudo journalctl --vacuum-time=7d
```

### A user is locked out

Five failed sign-ins locks an account for 15 minutes. It clears itself — but if
they need in now, another administrator can unlock from **Users & Roles** (the
padlock icon).

If **every** administrator is locked out, from the server:

```bash
source .env
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE email = 'admin@church.org';"
```

### Someone forgot their password

With SMTP configured (EMAIL.md) they use **Forgot password?** on the sign-in
page. Without it, a Super Administrator resets it from **Users & Roles → key
icon**. Either way the old sessions are signed out.

If people report that reset links never arrive, check the API log for
`[email] send failed` — the application deliberately answers "a link has been
sent" whether or not delivery worked, and it does not retry. A dead mail
provider is invisible from the browser; it is only visible in the log.

### Absence alerts have stopped appearing

Work through in order:

1. Are registers being **finalised**? A saved-but-not-finalised register does not
   count. Check **Attendance history** for "In progress" badges.
2. `ENABLE_JOBS=true` in `.env`?
3. Is the service type tracked? **Settings → Absence monitoring**.
4. Force a run: **Follow-Up → Alerts → Run absence scan**.
5. Check the job actually fires: `docker compose logs app | grep jobs`.

### The nightly job did not run

`node-cron` runs in-process, so a restarted container may have missed its window.
All three jobs are idempotent — just trigger the two visible ones manually from
the UI (Alerts → Run absence scan; Settings → Birthdays → Run the reminder job
now). Nothing duplicates. The third job, `auth-token-cleanup` at 03:15, only
prunes expired session rows older than 30 days; a missed run costs nothing.

A job that throws is logged as `[jobs] "<name>" failed:` and the API carries on.
Nothing else alerts you, so the weekly log skim is what catches a scan that has
been failing every night.

### Absence alerts are missing for a member who came back and lapsed again

Fixed in the September 2026 review: the notification key now includes the
member's last attendance date, so each new lapse is announced. Rows written
before that update keep their old key and are unaffected.

### Suspected unauthorised access

1. **Audit Logs** — filter by `auth.login_failed` and by the suspect user.
2. Deactivate the account: **Users & Roles** → uncheck *Account is active*. This
   revokes every session immediately.
3. Rotate the secrets in `.env` (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) and
   `docker compose up -d app`. **This signs everybody out** — tell the church first
   unless the risk is severe.
4. Reset passwords for affected users.
5. Export the relevant audit log range as evidence before it rotates.

Under Ghana's Data Protection Act, a breach involving personal data may require
notifying the Data Protection Commission and the affected people. Take advice
early — the clock starts at discovery, not at resolution.

---

# Maintenance procedures

## Applying an update

```bash
cd /opt/churchconnect/deploy
./backup.sh                                    # never skip
git pull
docker compose up -d --build
docker compose run --rm app npm run migrate:prod
docker compose ps
curl -sS https://your-domain/api/health
```

Then spot-check: sign in, open a member, load the dashboard.

**Deploy Tuesday morning.** Never Saturday. If it breaks you want a working week
ahead of you, not a Sunday service.

## Rolling back

```bash
cd /opt/churchconnect/deploy
git log --oneline -5
git checkout <previous-commit>
docker compose up -d --build
```

**Schema migrations do not roll back.** If the bad release added a migration, the
old code runs against the new schema — usually fine (columns are additive), but
verify. This is why the pre-update backup matters.

## Rotating secrets

Do this if a secret may have leaked, and once a year regardless.

```bash
cd /opt/churchconnect/deploy
openssl rand -hex 48    # new JWT_ACCESS_SECRET
openssl rand -hex 48    # new JWT_REFRESH_SECRET
nano .env
docker compose up -d app
```

Every user is signed out. Warn the church first.

Rotating the **database** password is more involved: change it in PostgreSQL
first (`ALTER USER ... WITH PASSWORD`), then in `.env`, then restart `app`.

## Adding a church admin's user account

Never share a login between people — it destroys the audit trail's value. Create
individual accounts from **Users & Roles → New user**, give a temporary password,
and leave *Require a password change at first sign-in* ticked.

---

# Monitoring

Minimum viable, and genuinely enough for a handful of churches:

**1. Uptime check.** A free UptimeRobot monitor on
`https://your-domain/api/health` every 5 minutes, alerting by email and SMS. This
tells you the site is down before the church does, which is worth more to the
relationship than any feature.

`/api/health` probes PostgreSQL and answers **503 `{"status":"degraded"}`** when
the database cannot be reached within two seconds, so configure the monitor to
alert on any non-200 status, not only on connection failure. It is exempt from
the API rate limit, so a frequent probe never counts against visitors.

**2. Disk alert.** Cron on the server:

```bash
# 0 8 * * * /opt/churchconnect/deploy/disk-check.sh
#!/usr/bin/env bash
USE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$USE" -gt 80 ]; then
  echo "RT AG Connect disk at ${USE}%" | mail -s "Disk warning" you@example.com
fi
```

**3. Backup alert.** Have `backup.sh` email you on failure — it already exits
non-zero on an empty dump, so wrapping the cron line in `|| mail ...` is enough.

What to look at when something feels wrong:

```bash
docker compose logs app --tail=100 --since=1h     # API
docker compose logs web --tail=50                 # requests, TLS
docker stats --no-stream                          # memory and CPU
```

The API logs slow queries over 300 ms in development. In production, if the
dashboard feels sluggish, that is where to look first.

---

# Health indicators

Quick reference for what "normal" looks like on a single small church:

| Metric | Healthy | Investigate |
|---|---|---|
| `/api/health` response | 200 in < 100 ms | > 1 s, or **503 = database unreachable** |
| Dashboard load | < 1 s | > 3 s |
| `app` container memory | 100–250 MB | > 700 MB |
| `db` container memory | 100–300 MB | > 1 GB |
| Disk used | < 60% | > 80% |
| Daily DB dump | 1–20 MB | 0 bytes, or sudden 10× change |
| Failed logins per day | 0–5 | > 50 (likely an attack) |

A sudden jump in dump size usually means the audit log is growing fast — check
for a loop hammering an endpoint.
