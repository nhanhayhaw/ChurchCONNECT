# RT AG Connect — Presentation Guide for Leadership

**Audience:** Pastors, elders, department heads, church council
**Purpose:** Source material for a PowerPoint deck introducing the system
**Suggested length:** 21 slides, 25 minutes presenting + 10 minutes questions

> ## The deck is already built
>
> **[`ChurchConnect-Leadership-Presentation.pptx`](ChurchConnect-Leadership-Presentation.pptx)**
> — 21 slides in the church colours, with the "what to say" text below already
> loaded into PowerPoint's **speaker notes**, so whoever presents does not need
> this document open.
>
> Two things to do before presenting:
>
> 1. **Drop in seven screenshots.** They are marked with gold dashed boxes
>    naming the exact capture needed (slides 6, 7, 8, 11, 12, 13).
> 2. **Replace the sample figures** on slides 11 and 16, and the church name and
>    date on slide 1.
>
> To regenerate after editing the content: `cd tools/deck && npm install && npm run build`

Everything below is written in ministry language, not technical language. Each
slide gives you **what goes on the slide** (keep it short — the slide is a
signpost) and **what to say** (the actual substance). Speak the second part;
don't read the first.

> **Note on numbers.** Every figure in this guide comes from the demonstration
> data loaded in the system. They illustrate what the screens look like — they
> are not your church's real figures. Replace them with your own before
> presenting, or label them clearly as sample data.

---

## Before you build the deck

### Visual identity

| Element | Value |
|---|---|
| Primary | Deep navy `#0F2A4A` — titles, header bars |
| Accent | Gold `#B8892B` — underlines, key numbers, emphasis only |
| Background | White or a very light warm grey `#F8FAFC` |
| Body text | Near-black `#0F172A` |
| Font | Inter, or Calibri if Inter is unavailable |
| Aspect ratio | 16:9 widescreen |

Three rules that will carry the deck:

1. **One idea per slide.** If a slide needs two headings, it is two slides.
2. **Screenshots over descriptions.** A picture of the Alerts screen persuades
   more than four bullet points about it.
3. **Gold is for one thing per slide, not for decoration.**

### Get your screenshots first

> **Already done.** Since September 2026 the deck is generated with real captures
> from the live system (`tools/deck/screenshots`, demonstration data). Re-run the
> capture only if the screens change. The notes below describe what each
> capture should show, which still applies.

Sign in and capture these seven, at full screen, before you start building:

1. Login page
2. Dashboard (top statistics + the attendance trend chart)
3. Member profile page
4. Attendance register mid-marking
5. **Follow-Up → Alerts** (the most important screenshot in the deck)
6. A follow-up case with its note history
7. Birthdays page

---

## Slide-by-slide

### Slide 1 — Title

**On the slide**
> **RT AG Connect**
> Church Membership, Attendance & Follow-Up Management System
> *A Smart Digital Platform for Effective Church Membership Management*
> [Church name] · [Date]

**What to say**
Introduce it in one sentence and resist explaining anything yet: *"This is a
system for knowing our people — not just counting them."*

---

### Slide 2 — The question behind everything

**On the slide**
> A member stops coming.
> **How long before someone notices?**

**What to say**
This is the emotional centre of the whole presentation. Let the question sit for
a moment before answering it.

In most churches the honest answer is months — and usually it is noticed by
accident, when someone happens to ask after them. By then the person has often
already decided they are no longer part of us. Nobody failed here; the
information simply was not in front of anyone. That is what we are fixing.

---

### Slide 3 — What we currently rely on

**On the slide**
Two columns.

| Today | The cost |
|---|---|
| Attendance counted, not recorded by name | We know *how many* came, never *who* stopped coming |
| Membership register in a book or spreadsheet | Out of date, one copy, easily lost |
| Follow-up depends on someone remembering | Quiet members are missed; the same few get called twice |
| Birthdays remembered informally | Missed birthdays, no consistency |
| Reports assembled by hand before meetings | Hours of work, often for figures nobody trusts |

**What to say**
Be careful of tone here. This is not a criticism of anyone's faithfulness — it
is a description of what happens when good people work without good
information. Say that out loud; it keeps the room with you.

---

### Slide 4 — Seven questions the system answers

**On the slide**
> - Who are our members?
> - Who attended church?
> - **Who has been absent?**
> - **Who needs follow-up?**
> - Whose birthday is coming up?
> - How is our membership growing?
> - Which departments and groups are active?

Put the two bold ones in gold.

**What to say**
Every church can answer the first two with enough effort. Almost none can answer
the two in gold, and those are the two that actually change whether a person
stays. That is where most of the value of this system sits.

---

### Slide 5 — What it is

**On the slide**
> A secure web application.
> Works on a computer, tablet or phone.
> Nothing to install.

**What to say**
Keep this slide short — it exists to close off the "what am I looking at"
question so nobody is distracted for the rest of the talk. It runs in a browser.
The usher marks the register on a phone; the pastor reads the alerts on a
tablet; the administrator works on a desktop. Same system, same information.

---

### Slide 6 — The dashboard *(screenshot)*

**On the slide**
Full-width dashboard screenshot. One line of text only:
> Everything the leadership needs, on one screen.

**What to say**
Walk them through the four bands, top to bottom, in about 45 seconds:

- **Membership** — total, active, inactive, new this month, male, female
- **Attendance** — today, this week, this month, and the attendance rate
- **Follow-up** — absent 2 weeks / 3 weeks / 1 month, pending, overdue
- **Birthdays** — today, this week, this month

Then say the thing that matters: *"Notice the order. What needs attention is at
the top. This screen is arranged by pastoral urgency, not by what was easiest to
build."*

---

### Slide 7 — Member records *(screenshot)*

**On the slide**
Member profile screenshot.
> One complete record per member — with a photograph.

**What to say**
Each member has a profile holding personal details, contact information, church
standing (date joined, baptism, Holy Communion, category), their department and
group, and an emergency contact.

The photograph matters more than it sounds. A leader who has just moved to this
congregation can put a face to a name before making a call. So can an usher
looking for someone who has been away.

Six tabs on each profile: Overview, Attendance, Follow-Up, Church Activities,
Documents, and an Activity Timeline showing everything that has happened to that
record.

---

### Slide 8 — Recording attendance *(screenshot)*

**On the slide**
Attendance register screenshot.
> Choose the service. Mark the register. Save.

**What to say**
The person taking the register picks the date and service type, and the full
membership appears. **Mark All Present** in one tap, then adjust the handful who
are not there. Three states: Present, Absent, Excused.

Eight service types are supported — Sunday Service, Midweek, Bible Study, Prayer
Meeting, Youth, Women's Ministry, Men's Ministry, and Special Programmes — and a
register can be for the whole congregation or for a single department or cell.

If a question comes about speed: a register of several hundred is a few minutes'
work, and it saves in one action rather than one member at a time.

---

### Slide 9 — The heart of it: absence is noticed automatically

**On the slide**
> The system reviews attendance every night.
>
> **2 services missed** → Level 1 · Follow-Up Reminder
> **3 services missed** → Level 2 · Urgent Follow-Up
> **4 services missed** → Level 3 · Pastoral Follow-Up

**What to say**
This is the slide to slow down on.

Nobody has to remember to check. Every night the system reviews who has been
missing and raises a graded alert. Two missed services is a friendly check-in.
Three is a proper phone call this week. Four — about a month — is a pastoral
visit.

The thresholds are ours to set. If our pattern means two weeks is too quick, we
change the number ourselves in Settings; it is not fixed by whoever built it.

---

### Slide 10 — What the system does *not* conclude

**On the slide**
> The system **never** decides that someone has left the church.
>
> It raises an alert for a person. A person decides what it means.

**What to say**
Say this clearly, because it is the concern a thoughtful pastor will raise
before you finish the previous slide.

Absence has many innocent explanations — travel, illness, a new baby, night
shifts, a work posting, caring for a relative. A computer cannot tell the
difference and should not try. So the system never changes anyone's status,
never marks anyone as backslidden, and never contacts a member on its own. Its
only output is an alert addressed to a church worker.

There is a second safeguard worth mentioning: if someone tells us in advance
they will be away and we mark them **Excused**, the count resets. We do not chase
people who already told us.

---

### Slide 11 — What an alert looks like *(screenshot)*

**On the slide**
Screenshot of the Alerts page. Alongside it, one worked example:

> **Attendance Alert**
> John Mensah
> Absent for 3 consecutive weeks
> Last attendance: 19 July 2026
> Department: Ushering · Phone: 024 000 0000
>
> **[ Start Follow-Up ]**

**What to say**
Everything needed to act is on the row: who, how long, when they were last with
us, which department, and the phone number. The leader presses **Start
Follow-Up** and the case opens.

In our demonstration data the system flagged 13 members — 5 at Level 1, 2 at
Level 2 and 6 at Level 3 — from twelve weeks of attendance. Thirteen
conversations that would otherwise not have happened.

---

### Slide 12 — Follow-up is a conversation, not a tick-box *(screenshot)*

**On the slide**
Follow-up case screenshot.
> Assigned to a named person. Every contact recorded. Nothing lost in handover.

**What to say**
A case carries the member, the level, the officer responsible, and the date of
the next contact. Six statuses track where things stand: Pending, Contacted,
Responded, Needs Further Follow-Up, Resolved, and Unable to Reach.

Every attempt is written down — what was said, how contact was made, what
happens next. For example:

> *"Member was contacted and stated that he travelled for work. Expected to
> return next Sunday."*

That single sentence means the next person to look at this case knows exactly
where it stands. No repeated calls, no awkward second conversation, no case
quietly dropped because the person handling it travelled.

Overdue cases are flagged automatically, so a case cannot be forgotten simply
because it stopped being urgent.

---

### Slide 13 — Birthdays *(screenshot)*

**On the slide**
Birthdays page screenshot.
> Nobody is forgotten.

**What to say**
Birthdays today, this week and this month, each card showing the photograph,
name, date, age, department and phone number.

Reminders are generated automatically — by default 7 days, 3 days, 1 day before,
and on the day — so there is time to prepare rather than scrambling on the
morning.

Worth stating plainly: **the system does not message the member.** It reminds
*us*. Sending greetings stays a human act, which is the whole point of it.

---

### Slide 14 — Departments and groups *(screenshot)*

**On the slide**
> **Departments** — Choir, Ushering, Media, Youth, Children's, Evangelism,
> Welfare, Protocol, Men's, Women's, Technical
>
> **Groups** — cells, prayer groups, Bible study groups, zones, fellowships

**What to say**
Every member can belong to a department (what they *do*) and a group (where they
*belong*). Each has a leader, meeting day and time, and its own roster and
attendance figures.

This tells us something we usually only guess at: which parts of the church are
genuinely active, and which have quietly stopped meeting.

---

### Slide 15 — Reports for meetings

**On the slide**
> Ten reports, ready in seconds. Export to **Excel** or **PDF**, or print.

Two columns:

| Membership | Attendance & care |
|---|---|
| Membership summary | Attendance by service |
| New members | Attendance by department |
| Members by department | Members with low attendance |
| Members by age group | Absentee register |
| Birthday register | Follow-up register |

**What to say**
No more assembling figures by hand the night before a council meeting. Choose a
report, choose the dates, and export it. Every report carries the church name and
the date it was produced, so there is no confusion about which version is on the
table.

---

### Slide 16 — Who sees what

**On the slide**

| Role | Access |
|---|---|
| **Super Administrator** | Everything, including user accounts and settings |
| **Pastor** | Full visibility of members, attendance, alerts and reports; manages follow-ups |
| **Church Administrator** | Registers members, records attendance, manages departments and groups |
| **Department Leader** | **Their own department only** |
| **Viewer** | Read-only |

**What to say**
Access is by role, and it is enforced by the system, not by trust or by hiding
menus. A Department Leader who signs in sees only the people in their
department — in the demonstration data, 5 members instead of 62. They cannot
reach anyone else's record even by trying.

This is what makes it safe to give a dozen leaders access rather than keeping
everything with one overloaded administrator.

---

### Slide 17 — Protecting our members' information

**On the slide**
> - Every person signs in with their own account
> - Passwords are stored so that even we cannot read them
> - Access is limited by role
> - **Every action is recorded — who did what, and when**
> - Photographs are only visible to signed-in staff

**What to say**
This system holds personal information about our congregation — addresses, phone
numbers, dates of birth, photographs of children. That is a trust, and it should
be treated as one.

The point to dwell on is the audit log. Every view, change and deletion is
recorded against a named person. If anyone ever asks *"who looked at my
record?"*, we can answer. That protects our members, and it protects our
workers from suspicion.

Before we go live we will confirm our handling meets Ghana's Data Protection
Act, 2012.

---

### Slide 18 — What it does not do

**On the slide**
> - It does not send SMS or emails *(planned, not built)*
> - It does not replace pastoral visiting
> - It does not decide who is committed
> - It does not manage finances, tithes or donations *(future)*

**What to say**
Put this slide in deliberately. A presentation that only lists strengths invites
suspicion; naming the limits earns trust and prevents disappointment in month
two.

The middle point is the one to emphasise. This system tells us *who to visit*.
It does not visit them. The ministry is still ours — the system just makes sure
we are pointed at the right people.

---

### Slide 19 — What we are asking for

**On the slide**
> 1. Approval to proceed
> 2. A decision on our absence thresholds — is 2 / 3 / 4 services right for us?
> 3. Names for the roles: who administers, who follows up
> 4. Agreement to record attendance **by name**, every Sunday
> 5. A start date for entering the existing register

**What to say**
Point 4 is the one that decides whether this succeeds or fails. Everything the
system does depends on someone marking a register by name every Sunday. If we
cannot commit to that, the alerts will be empty and the reports meaningless.
Better to settle that now than to discover it in three months.

---

### Slide 20 — Suggested rollout

**On the slide**

| Phase | What happens | Rough time |
|---|---|---|
| 1 | Set up, enter departments and groups | Week 1 |
| 2 | Enter existing members | Weeks 2–4 |
| 3 | Train the administrator and ushers | Week 4 |
| 4 | Record attendance every Sunday | From week 5 |
| 5 | First alerts appear; train leaders on follow-up | Week 7 |
| 6 | First full report to council | Week 9 |

**What to say**
Alerts cannot appear until there are a few weeks of attendance to compare — the
system needs history before it can spot a pattern. Roughly two months from start
to the first genuinely useful alert. Set that expectation now so nobody thinks it
has failed in week three.

---

### Optional closing slide — The difference

**On the slide**
> **Before:** a member stops coming, and we notice months later.
> **After:** a member misses two services, and someone is holding their name by
> the following week.

**What to say**
Return to the question from slide 2 and answer it. Then stop talking. This is a
strong place to end.

---

## Five-minute live demonstration

If you can show the system rather than only its screenshots, do. Follow exactly
this path — it builds to the point.

1. **Sign in** as the Pastor account. *"Every person has their own login."*
2. **Dashboard** — read the top row aloud. *"This is our church, right now."*
3. **Follow-Up → Alerts** — spend the most time here. Pick one member and read
   the alert out. *"Three weeks. Last seen the nineteenth of July."*
4. **Press Start Follow-Up**, assign it, type a short note, save.
5. **Members → open that member → Follow-Up tab** — show the case now attached
   to their record. *"Whoever opens this record next sees exactly where we got
   to."*
6. **Birthdays** — quick, light, close on a positive note.

Do not demonstrate Settings, Users or Audit Logs unless someone asks. They are
administration, and they will flatten the room.

---

## Questions you should expect

**"Does this mean we stop visiting people?"**
The opposite. It means we visit the right people, sooner. The system finds them;
we still go.

**"What if someone was away for a good reason?"**
We mark them Excused and the count resets. And even without that, the alert only
ever asks a person to check — it never records a judgement about anyone.

**"Who can see my phone number and my children's photographs?"**
Only signed-in church workers, limited by role, and every access is logged
against a name.

**"What happens if the internet is down on a Sunday?"**
The register can be taken on paper and entered afterwards — a service can be
recorded for any past date. Nothing is lost.

**"How long to enter our existing members?"**
Roughly two to three minutes per member. For 500 members, that is about 20 hours
of work — realistically two or three people over a fortnight. Bulk import from a
spreadsheet is a planned addition.

**"What does it cost to run?"**
A server and a domain name. There are no per-member fees and no licence.

**"What if the person who set it up leaves?"**
Nothing is locked to one individual. More than one person holds administrator
access, the information belongs to the church, and it can be exported to Excel
at any time.

---

## One-page handout

If you print a single leaf for the meeting, put only this on it:

> **RT AG Connect** — Membership, Attendance & Follow-Up
>
> **The problem.** When a member drifts away, we notice months later, by accident.
>
> **What it does.** Records every member. Takes attendance by name. Reviews
> attendance nightly and raises a graded alert when someone misses 2, 3 or 4
> services. Turns that alert into an assigned follow-up with a written record of
> every conversation. Tracks birthdays, departments, groups. Produces reports in
> seconds.
>
> **What it does not do.** It never concludes that a member has left, and it never
> contacts them. It tells a person to make a call.
>
> **What it needs from us.** Attendance recorded by name, every Sunday.
>
> **We are asking for:** approval to proceed, our absence thresholds, names for
> the roles, and a start date.
