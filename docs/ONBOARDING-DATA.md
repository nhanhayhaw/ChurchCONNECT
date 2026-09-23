# Getting a church's members into the system

The single biggest obstacle to a church adopting RT AG Connect is not price,
features or trust. It is the 600 people already written in a book.

This document is the answer to *"how do we get their register in without it
costing me thirty hours per sale?"* — the template to send them today, the
import feature to build, and the parts of the problem that can simply be
deleted.

---

## The problem, stated honestly

A 600-member church will not hand-type 600 records. Neither will you — at two to
three minutes each that is **20 to 30 hours**, which on a 3,000 GHS annual
subscription means you are working for roughly 100 GHS an hour before you have
written a line of code.

Do that for five churches and you no longer have a software business. You have a
data-entry business with a software attachment.

There are three parts to fixing it, and only the first is code.

---

# 1. Shrink the problem before writing anything

Two decisions cut the work roughly in half, and both are free.

## You do not need every member to go live

Start with the people who actually attend — often 150–250 of a "600-member"
church. Everyone else can be added over the following months, as they turn up or
as someone gets round to it.

This is not a compromise. The absence engine only works on people who attend
anyway: a member entered but never marked present simply sits there. Loading 350
names nobody will mark makes the register look impressive and the reports worse.

**Say this to the church explicitly.** Left to themselves they will assume they
must enter everyone before starting, and the project stalls for a month.

## Photographs are not a launch requirement

They are the slowest part of onboarding and the least urgent. Members show
coloured initials until someone photographs them.

The efficient method, once the church is live: set up a phone and a plain wall
after a service for two Sundays. An usher photographs whoever passes and matches
them by Member ID afterwards. Ten seconds a person, in a queue that already
exists.

---

# 2. Change what you ask for

Never say *"send us your member data."* You will receive a Word table, three
WhatsApp photographs of a ledger, and a spreadsheet where the Phone column holds
two numbers and the note "call the wife".

Say instead:

> "Here is our template. Fill in what you have. **Name, gender and phone are
> enough to start** — everything else can be added later."

That single change turns an open-ended data-cleaning project into a task a church
secretary can finish in an evening, and it moves the awkward work of mapping
*their* column headings to *your* fields onto the person who actually knows what
the columns mean.

## The template

Two files, ready to send:

| File | Purpose |
|---|---|
| [`templates/member-import-template.csv`](templates/member-import-template.csv) | Empty — the one they fill in |
| [`templates/member-import-example.csv`](templates/member-import-example.csv) | Five filled rows showing the formats |

Send **both**. The example answers nine of the ten questions they would otherwise
telephone you about.

### Columns

Only three are genuinely required.

| Column | Required | Accepted values | Notes |
|---|---|---|---|
| `first_name` | **Yes** | any, 2+ characters | |
| `middle_name` | | | Leave blank if none |
| `last_name` | **Yes** | any, 2+ characters | |
| `gender` | **Yes** | `male` / `female` | |
| `date_of_birth` | | `YYYY-MM-DD` | Drives birthdays; blank is fine |
| `marital_status` | | `single` `married` `divorced` `widowed` | |
| `phone` | | `024 000 1001` or `+233 24 000 1001` | Strongly recommended — it is how follow-up happens |
| `alt_phone` | | as above | |
| `email` | | | |
| `address` | | free text | Quote it if it contains a comma |
| `date_joined` | **see below** | `YYYY-MM-DD` | |
| `membership_status` | | `active` `inactive` `transferred` `deceased` | Defaults to `active` |
| `membership_category` | | `full_member` `associate` `new_convert` `visitor` `child` | Defaults to `full_member` |
| `baptism_status` | | `baptised` `not_baptised` `pending` | |
| `communion_status` | | `communicant` `not_communicant` | |
| `department` | | the department **name** | Must already exist — see below |
| `group` | | the group **name** | Must already exist |
| `ministry` | | free text | |
| `emergency_name` | | | |
| `emergency_relationship` | | e.g. `Spouse`, `Parent` | |
| `emergency_phone` | | | |
| `notes` | | free text | |

### Departments and groups go by name, not number

The template asks for `Choir`, not `4`. No church secretary knows your database
ids, and asking for them guarantees a mistake.

**Consequence for your process:** create the church's departments and groups
*before* importing members. That is step 2 of the onboarding checklist anyway,
and it takes ten minutes.

An unrecognised name is not silently ignored — it is reported as a row error, so
a typo (`Choire`) surfaces in the preview rather than quietly leaving forty
people unassigned.

### The `date_joined` problem

`date_joined` is required by the database, and a church will not know it for
members who joined in 2009.

Tell them: **use 1 January of the year they think it was.** If they have no idea,
use the date the church was founded.

Be honest about the consequence: the Membership Growth chart will show a spike
in every January, and one very large bar for the founding year. That is a
cosmetic artefact of unknown history, not a fault — and it is far better than
blocking the import on data nobody has.

If they genuinely cannot guess, the import can fall back to the import date.
Flag it clearly when you do, because then the chart shows 400 people joining in
one week.

---

# 3. Build the importer

Estimated **1–2 days** for the version that solves most of the problem, against
4–6 days for the full one. Build the small one first.

## What makes it small

The expensive part of any import tool is the **column-mapping interface** —
letting a user say "our column called *Surname* is your *last_name*". Every
church's spreadsheet differs, so it feels unavoidable.

It is avoidable: publish a fixed template and the mapping problem moves to the
church, where it is five minutes of copy-and-paste rather than a week of your
engineering. Add mapping later, if churches actually ask for it. Most will not.

## What it must have anyway

Cutting these does not make it cheaper — it makes it cost you more in support.

| Requirement | Why |
|---|---|
| **Preview before committing** | Show exactly what will be created, updated and rejected. "It imported 600 members wrong" is far worse than no import at all. |
| **Row-level errors with line numbers** | Import the 580 good rows; report the 20 bad ones. All-or-nothing means one bad phone number blocks the whole church. |
| **Downloadable error file** | They fix 20 rows and re-upload only those. Without this they re-upload all 600 and you get duplicates. |
| **Duplicate detection** | Churches re-upload. Twice. Match on `member_code`, then phone, then first+last name. |
| **A dry-run that touches nothing** | So you can hand the file back and say "fix these eight rows" before anything is written. |

## Suggested shape

```
POST /api/members/import/preview     multipart CSV -> validation report, nothing written
POST /api/members/import/commit      the validated payload -> transactional insert
GET  /api/members/import/template    the CSV template, so it is never out of date
```

The preview response is the whole design:

```json
{
  "totalRows": 604,
  "willCreate": 580,
  "willSkip": 18,
  "errors": 6,
  "unknownDepartments": ["Choire"],
  "rows": [
    { "line": 47, "status": "error",   "field": "gender",
      "message": "Must be male or female. Found: 'M'." },
    { "line": 52, "status": "skip",
      "message": "A member with phone 024 000 1001 already exists (CC-2026-0031)." }
  ]
}
```

Implementation notes for whoever builds it:

- **Reuse `memberCreateSchema`** (`server/src/modules/members/members.schema.ts`).
  The import must not have its own, looser validation rules — that is how
  imported records end up in states the forms cannot produce.
- **Commit inside one transaction** so a failure halfway leaves nothing behind.
- **Resolve `department` / `group` names once**, up front, into an id map.
- **Generate `member_code`** through the existing `nextMemberCode()` path, which
  takes an advisory lock — do not invent codes in a loop.
- **Write one audit entry** for the import as a whole (`member.import`, with the
  row count), not 600 individual ones.
- **Cap the file** at ~5,000 rows and a few MB.

## Common cleaning the importer should do quietly

Do these silently rather than rejecting the row. Every one of them will occur in
a real church spreadsheet.

| Input | Store as |
|---|---|
| `Male`, `M`, `MALE` | `male` |
| `024-000-1001`, `0240001001` | `024 000 1001` |
| `14/03/1988`, `14-03-1988` | `1988-03-14` |
| Leading/trailing spaces | trimmed |
| `N/A`, `-`, `none`, `nil` | empty |

Reject only what is genuinely ambiguous. `Mr Kwame Mensah` in a first-name
column is a judgement call — flag it, do not guess.

---

# 4. When the church has only paper

Some genuinely have a ledger and nothing else. No importer helps.

**Do not absorb this into the subscription.** Price it as what it is:

| Option | Who does it | Suggested |
|---|---|---|
| Church's own volunteers | Two or three young people, one Saturday | Free — and they learn the system |
| Church secretary, paid overtime | Them | Their cost |
| **You**, as a service | You | **2–5 GHS per member**, or 500–1,500 GHS flat |

The first option is usually best and is rarely offered. A youth group will enter
400 members in an afternoon if someone buys lunch, and afterwards the church has
three people who already know how to register a member.

If you do it yourself, quote it separately and on the invoice. A church that sees
"Data entry — 600 members — 1,800 GHS" understands they are buying labour. One
that sees it folded into the subscription concludes your software is expensive.

---

# 5. The onboarding conversation

Roughly what to say, in order. This is the part that determines whether the data
arrives in a usable state.

1. *"How many members are on your register, and how many attend on a normal
   Sunday?"*
   The gap between the two numbers is the conversation. It is usually large, and
   it is what justifies starting with attenders.

2. *"What form is the register in now?"*
   Excel → template, done in an evening. Word/paper → §4.

3. *"Let's start with the people who attend. We can add the rest as they come."*
   Sets expectations before they stall trying to be complete.

4. *"Here is the template and a filled-in example. Name, gender and phone are
   enough — everything else can wait."*

5. *"Send it back and I will show you exactly what will be created before
   anything is saved."*
   The preview is a trust-builder, not just a safety feature. Use it in front of
   them.

6. *"Photographs come later. We'll set up after a service once you're running."*

---

# 6. Do this now, before the importer exists

The template is useful **today**. It costs nothing to send and it unblocks the
slowest part of onboarding while the import feature is still unbuilt.

Give your pilot church the template this week. By the time the importer is
finished the data will be waiting — and you will have discovered, on a church
that is not paying you, exactly which columns confuse people.

That feedback is worth more than a week of guessing at a mapping UI.
