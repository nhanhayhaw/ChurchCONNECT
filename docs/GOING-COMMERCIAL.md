# Going commercial — selling RT AG Connect to multiple churches

An honest assessment of what stands between the working system you have now and
a product several churches pay for, plus how to price, onboard and support it.

Read the first section before anything else. It is the decision everything else
depends on.

---

# 1. The decision that shapes everything: how many churches share one system?

RT AG Connect today is **single-tenant**. One deployment serves one church. There
is no `church_id` anywhere in the schema — every member, register and follow-up
belongs to the one congregation using that database.

That is not a defect. It is the right design for one church, and it gives you the
strongest possible data isolation for free. But it decides how you can sell.

## Your three options

### Option 1 — One deployment per church *(what you have)*

Each church gets its own containers, its own database, its own subdomain.

| | |
|---|---|
| **Code change** | **None.** You can sell tomorrow. |
| Isolation | Perfect. A bug cannot leak one church's members into another's. |
| Onboarding | ~1 hour per church, mostly waiting for DNS |
| Updates | Repeated per church — 5 minutes × N |
| Practical ceiling | **8–12 churches** before it dominates your week |
| Cost | ~$3/church/month on a shared VPS |

**This is where to start.** It gets you to revenue and to real feedback without
a rewrite. Most of what you will learn in the first year is about support and
onboarding, not architecture.

### Option 2 — Database per church, one application

One Node process; it picks a connection pool based on the subdomain.

| | |
|---|---|
| **Code change** | Moderate — 2–4 weeks |
| Isolation | Strong. Still one database per church. |
| Updates | One deploy, then migrations run per database |
| Practical ceiling | 50–100 churches |

Work required: resolve tenant from the `Host` header, a pool registry keyed by
tenant, a tenant lookup table in a control database, and a migration runner that
iterates every tenant database. Connection count is the thing that eventually
bites — each pool holds sockets.

**This is the sweet spot** for a business serving tens of churches, and the
smallest step that removes the per-church operations burden.

### Option 3 — True multi-tenancy: `church_id` on every table

One database, one application, rows tagged by church.

| | |
|---|---|
| **Code change** | **Large — 6–10 weeks, and risky** |
| Isolation | Only as good as your weakest query |
| Updates | One deploy, one migration |
| Ceiling | Thousands |

Every one of the ~90 queries in `server/src/modules/**` needs a `church_id`
predicate. Miss one and a church sees another church's members — which for
personal data is not a bug, it is a notifiable breach.

If you go here, use **PostgreSQL Row-Level Security** rather than trusting
yourself to write the predicate ninety times:

```sql
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON members
  USING (church_id = current_setting('app.church_id')::bigint);
```

The database then enforces isolation even on a query you forgot. Set
`app.church_id` once per request, from the authenticated session.

## Recommendation

**Sell on Option 1 now. Move to Option 2 at around eight churches.** Do not build
Option 3 until a customer's scale actually requires it — the risk is
disproportionate to the benefit at the size you will realistically reach in two
years.

Whichever you choose, `docs/ARCHITECTURE.md` already flags the four root tables
that would need a tenant column: `members`, `departments`, `groups`,
`attendance_services`. Everything else hangs off those.

---

# 2. What must be built before you charge anyone

The system works. It is not yet a product. These are ordered by what will hurt
first.

## Blocking — do not sell without these

| # | Gap | Why it blocks | Effort |
|---|---|---|---|
| ~~1~~ | ~~**Password reset by email**~~ | **BUILT.** Self-service reset, single-use hashed tokens, plus a "password changed" security notice. All that remains per church is an SMTP account and three DNS records — see [EMAIL.md](EMAIL.md). | Done |
| 2 | **`--roles-only` seed + `create-admin` script** | A clean production install currently has no roles. Today's workaround (see DEPLOYMENT.md) is genuinely rough and error-prone. | 1 day |
| 3 | **Bulk member import from CSV/Excel** | The largest barrier to adoption. A 600-member church will not hand-type 600 records, and if you do it for them you have burned 30 hours per sale. **Full plan, template and spec: [ONBOARDING-DATA.md](ONBOARDING-DATA.md)** — the fixed-template version is 1–2 days, not 4–6, and the template itself is usable before any code is written. | 1–2 days |
| 4 | **Tested backup + restore** | You are holding a congregation's records. Losing them ends the business. The restore drill in OPERATIONS.md must be performed, not merely written. | 1 day |
| 5 | **Terms of service, privacy policy, data processing agreement** | You will be processing personal data on churches' behalf. Get these reviewed by a Ghanaian lawyer — this is not a template-download exercise. | Legal cost |
| 6 | **Data Protection Commission registration** | Under Act 843 a data controller processing personal data in Ghana must register. Verify your obligation and your customers' before signing anyone. | Legal cost |

## Strongly recommended before the third customer

| Gap | Why | Effort |
|---|---|---|
| **Automated test suite** | You now have paying customers' data. A regression that corrupts attendance is a different event from a bug in a demo. Start with the absence engine's four exception rules. | 1–2 weeks |
| **Error monitoring (Sentry or similar)** | Otherwise you learn about failures from an upset pastor. | Half a day |
| **Uptime monitoring** | See OPERATIONS.md. | 1 hour |
| **A "reset this church" script** | For trials, and for the inevitable "we entered the test data into the real system". | 1 day |
| **Export-everything button** | Both a trust signal and, in some readings, a legal requirement. Churches must not feel locked in. | 2–3 days |
| **A simple marketing site** | One page: what it does, screenshots, price, a contact form. | 2–3 days |

## Deliberately defer

Do not build these before you have customers asking. Each is a plausible-sounding
trap.

- SMS integration — expensive, per-country, and the value is unproven until a
  church asks
- Mobile apps — the responsive web app already works on phones
- Donations and tithe management — a **much** larger regulatory problem than
  member records; do not stumble into handling money
- Multi-language — until a church actually needs it
- Anything on the "Future features" list in the README that nobody has requested

---

# 3. Pricing

## The shape

Church software is bought from a **tight budget by a committee**. Two things
follow: price by congregation size (fairness is visible and defensible), and keep
the entry tier low enough to be approved without a board meeting.

Annual billing matters more here than in most markets — many churches budget
yearly and find a monthly charge administratively annoying.

## An illustrative table

Figures below are **starting points to test, not researched market rates.** Ghana
and diaspora pricing differ substantially; validate with five real churches
before publishing anything.

| Tier | Members | Monthly (GHS) | Monthly (USD) | Annual (2 months free) |
|---|---|---|---|---|
| **Small** | up to 150 | 150 | ~$12 | 1,500 GHS |
| **Growing** | up to 500 | 300 | ~$24 | 3,000 GHS |
| **Large** | up to 1,500 | 600 | ~$48 | 6,000 GHS |
| **Multi-site** | unlimited | from 1,200 | ~$96 | negotiated |

Add-ons worth charging separately:

| Service | Suggested |
|---|---|
| Data entry of the existing register | 2–5 GHS per member, or a flat 500–1,500 GHS |
| On-site training (half day) | 500–800 GHS |
| Custom report | 300–600 GHS |
| Their own domain instead of a subdomain | 200 GHS setup + registrar cost |

## Check your margin

At Path B hosting (~$3/church/month at eight churches), even the Small tier is
roughly 75% gross margin. **Your real cost is support time, not servers.** Budget
2–4 hours per church per month in year one and price so that is covered — if a
church pays 150 GHS and costs you 3 hours, you are working below minimum wage.

## Free trial

Offer **30 days, no card**, with the demo data pre-loaded so they can see a
populated system immediately rather than an empty one. The seed script already
produces exactly that — it is a genuine sales asset, not just a development
convenience.

Make the trial→paid transition a fresh, empty database. Never let demo members
survive into a real congregation's records.

---

# 4. Onboarding a church — repeatable checklist

Target: **one week** from signature to a church using it for their own Sunday.

### Before day one
- [ ] Signed agreement and DPA
- [ ] Subdomain agreed (`gracechapel.churchconnect.app`)
- [ ] Named contact and named administrator identified

### Day 1 — provision *(≈1 hour)*
- [ ] DNS record created (DEPLOYMENT.md Part 1)
- [ ] Stack deployed, HTTPS verified
- [ ] Roles created, first administrator created
- [ ] Verification list (DEPLOYMENT.md Part 3) — **all 15 checks**
- [ ] Backups running and one restore drill completed

### Days 2–3 — configure *(≈2 hours, with them)*
- [ ] Church name, address, contact details in Settings
- [ ] **Absence thresholds agreed with the pastor** — do not just leave 2/3/4
- [ ] Service types they actually run
- [ ] Departments created
- [ ] Groups and cells created
- [ ] User accounts for leaders, with correct roles
- [ ] Department Leaders scoped to the right department

### Days 3–5 — data  *(see [ONBOARDING-DATA.md](ONBOARDING-DATA.md))*
- [ ] Template sent, and returned filled in
- [ ] **Departments and groups created first** — the import matches them by name
- [ ] Import previewed **with the church watching**, errors fixed, then committed
- [ ] Spot-check 10 records against their source
- [ ] Photographs deferred, and the church told so explicitly
- [ ] **Enter at least 3 past Sundays of attendance** — without history the
      absence engine has nothing to compare and the church concludes it does not
      work

### Day 5 — train *(≈2 hours)*
- [ ] Administrator: registering members, recording attendance, reports
- [ ] Ushers: the register on a phone, and *Mark All Present*
- [ ] Pastor: dashboard, alerts, follow-up
- [ ] Department leaders: their own scoped view
- [ ] Hand over a one-page quick reference

### Week 2 onward
- [ ] Attend their first Sunday register in person if you can
- [ ] Check in after the first week
- [ ] **Check in at week 7** — the first meaningful alerts appear around then,
      and this is the moment the church either sees the value or quietly stops
      using it

That week-7 call is the highest-leverage thing in this document. Diarise it at
signature.

---

# 5. Support

## Tiers

| | Standard *(included)* | Priority *(+50%)* |
|---|---|---|
| Channel | WhatsApp / email | WhatsApp / email / phone |
| Hours | Mon–Fri, 9–5 | Mon–Sat, 8–8 |
| First response | 1 business day | 4 hours |
| **Sunday outage** | Best effort | 1 hour |

Be careful what you promise on Sundays. That is the one morning a church cannot
tolerate an outage and the one morning you would rather be in church yourself. If
you cannot honour a one-hour Sunday response, do not sell it.

## Predictable support burden

| Cause | Roughly | Fix |
|---|---|---|
| Forgotten password | 40% | **Build email reset** — this alone halves your support load |
| "How do I…" | 25% | Quick reference sheet, short videos |
| Data entry mistakes | 15% | The undo paths already exist; show them |
| Genuine bugs | 10% | Error monitoring so you see them first |
| Outages | 5% | Uptime monitoring |
| Feature requests | 5% | Keep a list; batch them |

## Two operational rules

**Never make ad-hoc changes directly in the database on a live system.** If a fix
needs SQL, write it as a script, test it against a restored backup, and keep it.

**Every church gets its own credentials, always.** Reusing a password across
churches means one leak compromises all of them.

---

# 6. Legal and data protection — Ghana

**This section is orientation, not legal advice. Engage a Ghanaian lawyer before
your first paying customer.**

## What applies

The **Data Protection Act, 2012 (Act 843)** governs processing personal data in
Ghana. RT AG Connect processes exactly the categories it is concerned with:
names, addresses, phone numbers, dates of birth, photographs — including of
children — and attendance patterns that reveal religious participation.

Points to take advice on:

1. **Registration.** Data controllers must register with the Data Protection
   Commission. Establish whether you register, whether each church registers, or
   both.
2. **Controller vs processor.** The church almost certainly controls the data;
   you process it on their behalf. That distinction drives who is liable for
   what, and it belongs in a written agreement.
3. **Children's data.** Photographs and records of minors deserve specific
   attention and probably parental consent.
4. **Breach notification.** Know the obligation and the timeline **before** you
   need it, not during an incident.
5. **Retention.** How long do you keep a member's record after they leave? After
   a church cancels? Decide, write it down, and honour it.

## What the software already gives you

Genuine compliance assets you can point to:

- Role-based access, enforced in SQL rather than by hiding menus
- A complete audit log — who accessed what, when, from where
- Argon2id password hashing
- HTTPS everywhere; database never exposed to the internet
- Soft deletion, so a mistaken removal is recoverable
- Excel and PDF export for subject-access requests

## What is missing

- A retention policy and any automatic purge
- A consent record against each member
- A documented breach response procedure *(start from OPERATIONS.md)*
- A signed processing agreement with each church

## Put in the contract

- Who owns the data — **the church, unambiguously**
- What happens to it if they cancel: exported to them, then deleted, within a
  stated period
- What happens if **you** stop trading — an escrow or handover arrangement.
  Churches will ask. Having an answer is a competitive advantage.
- Uptime commitment (be conservative; 99% is honest for a single VPS)
- Backup frequency and retention
- Your right to access their data for support, and the limits on it

---

# 7. A realistic first year

| Months | Focus | Milestone |
|---|---|---|
| 1–2 | Build the six blocking items in §2 | Product is sellable |
| 2–3 | One pilot church, **free**, in exchange for candid feedback | A real congregation using it weekly |
| 3–4 | Fix what the pilot exposes. It will expose things. | Second and third churches, paid |
| 4–6 | Onboarding you can repeat without thinking | Five churches |
| 6–9 | Tests, monitoring, bulk import | Eight churches — the Option 1 ceiling |
| 9–12 | Migrate to Option 2 (database per church) | Fifteen churches, one deploy |

At fifteen churches on the Growing tier, that is roughly **4,500 GHS/month**
recurring against maybe $30/month of hosting. The constraint is not technology —
it is how many churches you can onboard and support well.

## The three things most likely to sink this

1. **Onboarding cost.** If entering 600 members takes you 30 hours per church,
   you have a services business with a software attachment, not a software
   business. Bulk import is the fix, and it is why it sits at #3 in the blocking
   list.
2. **Attendance discipline.** Every valuable thing this system does depends on
   someone marking a register by name every Sunday. Churches that do not sustain
   that will conclude the product does not work. Make it part of onboarding, and
   check at week 7.
3. **Support load.** Ten churches × four hours a month is a part-time job on top
   of building. Build email password reset first — it is 40% of your tickets.

---

# 8. Immediate next steps

1. Read §1 and consciously choose Option 1. Write down the date you will
   reconsider (suggest: at eight churches).
2. Build the six blocking items in §2. Realistically **3–4 weeks**.
3. Find one pilot church that will be honest with you, and host them free.
4. Get the legal documents drafted while the pilot runs.
5. Perform the restore drill in OPERATIONS.md, and diarise it monthly.
6. Price it, publish it, and sell to the second church.

The system works. The gap between here and a business is roughly a month of
engineering, some legal groundwork, and the discipline to check in at week seven.
