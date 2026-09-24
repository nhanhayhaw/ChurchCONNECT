/**
 * Generates the RT AG Connect leadership presentation.
 *
 *   cd tools/deck && npm install && npm run build
 *
 * Content is kept in step with docs/PRESENTATION.md - that document is the
 * source of truth for wording; this file is the source of truth for layout.
 * The "what to say" text from the guide becomes PowerPoint speaker notes, so
 * the deck is self-contained: whoever presents it does not need the markdown.
 *
 * Screen slides use real captures from the live system (tools/deck/screenshots,
 * demonstration data, fictional names). If a capture file is missing the slide
 * gets a clearly marked placeholder instead - an unmarked empty box would ship
 * looking finished.
 */
import PptxGenJS from 'pptxgenjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(here, '../../docs/ChurchConnect-Leadership-Presentation.pptx');
const LOGO = path.resolve(here, '../../client/public/logo.png');
// Screens captured from the live system with the demonstration data. A slide
// whose capture is missing falls back to a marked placeholder, never to an
// empty box.
const SHOTS = path.resolve(here, 'screenshots');

const CHURCH = 'Redemption Temple AG';
const BRIEFING_DATE = 'Board briefing · September 2026';

// --- Design tokens ---------------------------------------------------------
// The same navy and gold the application uses, so the deck and the software
// look like one thing.
const NAVY = '0F2A4A';
const NAVY_LIGHT = '1B3050';
const GOLD = 'B8892B';
const GOLD_LIGHT = 'DBB877';
const WHITE = 'FFFFFF';
const INK = '0F172A';
const MUTED = '64748B';
const PAGE = 'F8FAFC';
const RULE = 'E2E8F0';

// Status colours, matching the application's charts.
const GREEN = '0CA30C';
const AMBER = 'FAB219';
const RED = 'D03B3B';

// Calibri ships with Office on both Windows and macOS, so the deck renders the
// same wherever it is opened. Inter (the app's typeface) would not.
const FONT = 'Calibri';

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';
pptx.author = 'RT AG Connect';
pptx.company = 'RT AG Connect';
pptx.title = 'RT AG Connect - Membership, Attendance & Follow-Up';
pptx.subject = 'Leadership briefing';

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** A standard content slide: white page, navy title, gold rule beneath it. */
function contentSlide(title, kicker) {
  const slide = pptx.addSlide();
  slide.background = { color: PAGE };

  if (kicker) {
    slide.addText(kicker.toUpperCase(), {
      x: 0.7, y: 0.42, w: 11.9, h: 0.28,
      fontFace: FONT, fontSize: 11, color: GOLD, bold: true, charSpacing: 2,
    });
  }

  slide.addText(title, {
    x: 0.7, y: kicker ? 0.72 : 0.6, w: 11.9, h: 0.75,
    fontFace: FONT, fontSize: 30, color: NAVY, bold: true,
  });

  // Quiet footer: the church on the left, the crest on the right.
  slide.addText(`${CHURCH}  ·  RT AG Connect`, {
    x: 0.7, y: 6.92, w: 6, h: 0.3,
    fontFace: FONT, fontSize: 9, color: MUTED,
  });
  slide.addImage({ path: LOGO, x: 12.25, y: 6.82, w: 0.42, h: 0.42 });

  return slide;
}

/**
 * A screen captured from the live system, framed on a white card. Falls back
 * to the marked placeholder if the capture file is absent so a missing image
 * is never mistaken for a finished slide.
 */
function screenshot(slide, { x, y, w, h, file, label, capture }) {
  const p = path.join(SHOTS, file);
  if (!fs.existsSync(p)) {
    screenshotPlaceholder(slide, { x, y, w, h, label, capture });
    return;
  }
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: WHITE }, line: { color: RULE, width: 1 },
    shadow: { type: 'outer', color: '0F172A', blur: 6, offset: 2, angle: 90, opacity: 0.18 },
  });
  const inset = 0.05;
  slide.addImage({
    path: p,
    x: x + inset, y: y + inset, w: w - 2 * inset, h: h - 2 * inset,
    sizing: { type: 'cover', w: w - 2 * inset, h: h - 2 * inset },
  });
}

/** A full-bleed navy slide for the title and the big statements. */
function statementSlide() {
  const slide = pptx.addSlide();
  slide.background = { color: NAVY };
  return slide;
}

/** A dashed box marking where a screenshot must be pasted. */
function screenshotPlaceholder(slide, { x, y, w, h, label, capture }) {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: 'FFFFFF' },
    line: { color: GOLD, width: 1.5, dashType: 'dash' },
  });
  slide.addText(
    [
      { text: 'PASTE SCREENSHOT\n', options: { fontSize: 13, bold: true, color: GOLD, charSpacing: 1 } },
      { text: `${label}\n`, options: { fontSize: 15, color: NAVY, bold: true } },
      { text: capture, options: { fontSize: 11, color: MUTED, italic: true } },
    ],
    { x, y, w, h, align: 'center', valign: 'middle', fontFace: FONT },
  );
}

/** Consistent bullet list. */
function bullets(slide, items, opts = {}) {
  const text = items.map((item) => {
    const isString = typeof item === 'string';
    const body = isString ? item : item.text;
    const highlight = !isString && item.highlight;
    return {
      text: body,
      options: {
        bullet: { code: '2022' },
        color: highlight ? GOLD : (opts.color ?? INK),
        bold: Boolean(highlight),
        fontSize: opts.fontSize ?? 17,
        breakLine: true,
        paraSpaceAfter: opts.spaceAfter ?? 11,
      },
    };
  });

  slide.addText(text, {
    x: opts.x ?? 0.95, y: opts.y ?? 2.0, w: opts.w ?? 11.5, h: opts.h ?? 4.4,
    fontFace: FONT, valign: 'top',
  });
}

/** Table with the house style applied. */
function table(slide, header, rows, opts = {}) {
  const headerRow = header.map((h) => ({
    text: h,
    options: { bold: true, color: WHITE, fill: { color: NAVY }, fontSize: opts.headerSize ?? 13 },
  }));

  const bodyRows = rows.map((row, i) =>
    row.map((cell) => {
      const isObj = typeof cell === 'object' && cell !== null;
      return {
        text: isObj ? cell.text : cell,
        options: {
          color: isObj && cell.color ? cell.color : INK,
          bold: Boolean(isObj && cell.bold),
          fontSize: opts.bodySize ?? 13,
          fill: { color: i % 2 === 1 ? 'EEF2F7' : WHITE },
        },
      };
    }),
  );

  slide.addTable([headerRow, ...bodyRows], {
    x: opts.x ?? 0.7, y: opts.y ?? 2.0, w: opts.w ?? 11.93,
    colW: opts.colW,
    border: { type: 'solid', color: RULE, pt: 1 },
    fontFace: FONT,
    rowH: opts.rowH ?? 0.42,
    valign: 'middle',
    margin: 0.09,
  });
}

/** Speaker notes - the "what to say" from the guide. */
function notes(slide, text) {
  slide.addNotes(text.trim());
}

// ===========================================================================
// SLIDE 1 - Title
// ===========================================================================
{
  const s = statementSlide();

  // Lighter panel on the right carries the crest; the text sits on the left.
  s.addShape(pptx.ShapeType.rect, { x: 8.6, y: 0, w: 4.733, h: SLIDE_H, fill: { color: NAVY_LIGHT }, line: { color: NAVY_LIGHT } });
  s.addImage({ path: LOGO, x: 9.72, y: 2.45, w: 2.5, h: 2.5 });

  s.addText('RT AG CONNECT', {
    x: 0.95, y: 2.25, w: 8, h: 0.9,
    fontFace: FONT, fontSize: 46, bold: true, color: WHITE, charSpacing: 3,
  });
  s.addText('Church Membership, Attendance & Follow-Up\nManagement System', {
    x: 0.95, y: 3.25, w: 7.6, h: 1.0,
    fontFace: FONT, fontSize: 19, color: 'C5D3E4', lineSpacing: 26,
  });
  s.addText('A Smart Digital Platform for Effective\nChurch Membership Management', {
    x: 0.95, y: 4.6, w: 7.6, h: 0.8,
    fontFace: FONT, fontSize: 14, color: GOLD_LIGHT, italic: true, lineSpacing: 20,
  });
  s.addText(`${CHURCH}   ·   ${BRIEFING_DATE}`, {
    x: 0.95, y: 6.25, w: 7.6, h: 0.4,
    fontFace: FONT, fontSize: 13, color: '9BB2CD',
  });

  notes(s, `
Introduce it in ONE sentence and resist explaining anything yet:

  "This is a system for knowing our people - not just counting them."

Then move straight to the next slide. Do not open with features.

The system is already built and online; the screens in this deck are real
captures with demonstration data (fictional names). Say so if asked.
  `);
}

// ===========================================================================
// SLIDE 2 - The question
// ===========================================================================
{
  const s = statementSlide();

  s.addText('A member stops coming.', {
    x: 1.2, y: 2.5, w: 11, h: 0.85,
    fontFace: FONT, fontSize: 36, color: 'C5D3E4',
  });
  s.addText('How long before someone notices?', {
    x: 1.2, y: 3.45, w: 11, h: 1.0,
    fontFace: FONT, fontSize: 44, bold: true, color: WHITE,
  });

  notes(s, `
This is the emotional centre of the whole presentation.

ASK THE QUESTION, THEN STOP TALKING. Let it sit for a few seconds. The silence
is doing the work.

Then answer it honestly:

  "In most churches the answer is months. And usually it is noticed by accident -
   when someone happens to ask after them. By then the person has often already
   decided they are no longer part of us."

Immediately protect the room:

  "Nobody has failed here. The information simply was not in front of anyone.
   That is what we are fixing."

Return to this question on the final slide.
  `);
}

// ===========================================================================
// SLIDE 3 - What we currently rely on
// ===========================================================================
{
  const s = contentSlide('What we currently rely on', 'The situation today');
  table(
    s,
    ['Today', 'The cost'],
    [
      ['Attendance counted, not recorded by name', { text: 'We know how many came, never who stopped coming', color: RED }],
      ['Membership register in a book or spreadsheet', 'Out of date, one copy, easily lost'],
      ['Follow-up depends on someone remembering', 'Quiet members are missed; the same few get called twice'],
      ['Birthdays remembered informally', 'Missed birthdays, no consistency'],
      ['Reports assembled by hand before meetings', 'Hours of work, often for figures nobody trusts'],
    ],
    { y: 2.1, colW: [5.4, 6.53], rowH: 0.62 },
  );

  notes(s, `
WATCH YOUR TONE HERE. This is not a criticism of anyone's faithfulness - it is a
description of what happens when good people work without good information.

Say that out loud. It keeps the room with you:

  "None of this is anyone's fault. It is what happens when committed people are
   asked to hold hundreds of names in their heads."

Do not read all five rows. Read the first one, and let them scan the rest.
  `);
}

// ===========================================================================
// SLIDE 4 - Seven questions
// ===========================================================================
{
  const s = contentSlide('Seven questions the system answers', 'What we get');
  bullets(s, [
    'Who are our members?',
    'Who attended church?',
    { text: 'Who has been absent?', highlight: true },
    { text: 'Who needs follow-up?', highlight: true },
    'Whose birthday is coming up?',
    'How is our membership growing?',
    'Which departments and groups are active?',
  ], { y: 1.95, fontSize: 20, spaceAfter: 13 });

  notes(s, `
Point at the two questions in gold.

  "Every church can answer the first two with enough effort. Almost none can
   answer the two in gold - and those are the two that actually decide whether
   a person stays with us."

That is where most of the value of this system sits. Everything else is
housekeeping by comparison.
  `);
}

// ===========================================================================
// SLIDE 5 - What it is
// ===========================================================================
{
  const s = contentSlide('What it is', 'In plain terms');

  const cards = [
    { t: 'A secure web application', d: 'Reached through a browser, protected by a personal sign-in' },
    { t: 'Computer, tablet or phone', d: 'The same information wherever you are' },
    { t: 'Nothing to install', d: 'No app store, no software on anyone’s machine' },
  ];

  cards.forEach((card, i) => {
    const x = 0.7 + i * 4.02;
    s.addShape(pptx.ShapeType.rect, { x, y: 2.3, w: 3.75, h: 2.5, fill: { color: WHITE }, line: { color: RULE, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x, y: 2.3, w: 3.75, h: 0.08, fill: { color: GOLD }, line: { color: GOLD } });
    s.addText(card.t, { x: x + 0.3, y: 2.7, w: 3.15, h: 0.8, fontFace: FONT, fontSize: 18, bold: true, color: NAVY });
    s.addText(card.d, { x: x + 0.3, y: 3.5, w: 3.15, h: 1.1, fontFace: FONT, fontSize: 13, color: MUTED });
  });

  notes(s, `
Keep this slide SHORT - about twenty seconds. It exists only to close off the
"what am I actually looking at" question so nobody is distracted for the rest of
the talk.

  "It runs in a browser. The usher marks the register on a phone, the pastor
   reads the alerts on a tablet, the administrator works at a desk. Same system,
   same information, at the same moment."

Then move on.
  `);
}

// ===========================================================================
// SLIDE 6 - Dashboard
// ===========================================================================
{
  const s = contentSlide('Everything leadership needs, on one screen', 'The dashboard');
  screenshot(s, {
    x: 0.7, y: 1.95, w: 8.1, h: 4.45,
    file: 'dashboard.png', label: 'Dashboard',
    capture: 'Capture the top statistics and the attendance trend chart',
  });

  const bands = [
    { t: 'Membership', d: 'Total, active, inactive, new this month, male, female', c: NAVY },
    { t: 'Attendance', d: 'Today, this week, this month, attendance rate', c: NAVY },
    { t: 'Follow-up', d: 'Absent 2 / 3 weeks / 1 month, pending, overdue', c: RED },
    { t: 'Birthdays', d: 'Today, this week, this month', c: GOLD },
  ];
  bands.forEach((b, i) => {
    const y = 1.95 + i * 1.13;
    s.addShape(pptx.ShapeType.rect, { x: 9.05, y, w: 0.07, h: 0.95, fill: { color: b.c }, line: { color: b.c } });
    s.addText(b.t, { x: 9.3, y, w: 3.3, h: 0.32, fontFace: FONT, fontSize: 15, bold: true, color: NAVY });
    s.addText(b.d, { x: 9.3, y: y + 0.33, w: 3.3, h: 0.62, fontFace: FONT, fontSize: 11, color: MUTED });
  });

  notes(s, `
Walk the four bands top to bottom in about 45 seconds. Do not linger on numbers.

Then make the point that actually matters:

  "Notice the ORDER. What needs attention is at the top - the people, not the
   totals. This screen is arranged by pastoral urgency, not by what was easiest
   to build."

There are also six charts further down the page: attendance trend over twelve
weeks, membership growth, gender split, members by department, members by age,
and attendance by service type. Mention them; do not tour them.
  `);
}

// ===========================================================================
// SLIDE 7 - Member records
// ===========================================================================
{
  const s = contentSlide('One complete record per member', 'Member management');
  screenshot(s, {
    x: 0.7, y: 1.95, w: 7.3, h: 4.45,
    file: 'member-profile.png', label: 'Member profile',
    capture: 'Open any member and capture the full profile page',
  });

  s.addText('Each profile holds', { x: 8.35, y: 1.95, w: 4.3, h: 0.35, fontFace: FONT, fontSize: 15, bold: true, color: NAVY });
  bullets(s, [
    'Photograph',
    'Personal and contact details',
    'Date joined, baptism, Holy Communion',
    'Department, group and ministry',
    'Emergency contact',
  ], { x: 8.4, y: 2.4, w: 4.3, h: 2.0, fontSize: 12, spaceAfter: 7 });

  s.addText('Six tabs', { x: 8.35, y: 4.5, w: 4.3, h: 0.35, fontFace: FONT, fontSize: 15, bold: true, color: NAVY });
  s.addText('Overview · Attendance · Follow-Up ·\nChurch Activities · Documents ·\nActivity Timeline', {
    x: 8.4, y: 4.9, w: 4.3, h: 1.1, fontFace: FONT, fontSize: 12, color: MUTED, lineSpacing: 18,
  });

  notes(s, `
Run through the record quickly - it is the least surprising part of the system.

Spend your time on the PHOTOGRAPH, which matters more than it sounds:

  "A leader who has recently joined this congregation can put a face to a name
   before making a call. So can an usher looking for someone who has been away
   for a month."

The Activity Timeline is worth one sentence: every change to a record is kept,
so you can see what happened to it and when.
  `);
}

// ===========================================================================
// SLIDE 8 - Attendance
// ===========================================================================
{
  const s = contentSlide('Choose the service. Mark the register. Save.', 'Recording attendance');
  screenshot(s, {
    x: 0.7, y: 1.95, w: 7.3, h: 4.45,
    file: 'register.png', label: 'Attendance register',
    capture: 'Capture mid-marking, with some members already marked',
  });

  s.addText('Three states', { x: 8.35, y: 1.95, w: 4.3, h: 0.35, fontFace: FONT, fontSize: 15, bold: true, color: NAVY });
  [['Present', GREEN], ['Absent', RED], ['Excused', AMBER]].forEach(([label, colour], i) => {
    s.addShape(pptx.ShapeType.roundRect, {
      x: 8.4 + i * 1.42, y: 2.4, w: 1.3, h: 0.42, fill: { color: colour }, line: { color: colour }, rectRadius: 0.06,
    });
    s.addText(label, { x: 8.4 + i * 1.42, y: 2.4, w: 1.3, h: 0.42, fontFace: FONT, fontSize: 11, bold: true, color: WHITE, align: 'center', valign: 'middle' });
  });

  s.addText('Mark All Present, then adjust', { x: 8.35, y: 3.1, w: 4.3, h: 0.35, fontFace: FONT, fontSize: 15, bold: true, color: NAVY });
  s.addText('One tap sets the common case. Change only the handful who are not there.', {
    x: 8.4, y: 3.5, w: 4.3, h: 0.75, fontFace: FONT, fontSize: 12, color: MUTED,
  });

  s.addText('Eight service types', { x: 8.35, y: 4.35, w: 4.3, h: 0.35, fontFace: FONT, fontSize: 15, bold: true, color: NAVY });
  s.addText('Sunday · Midweek · Bible Study ·\nPrayer Meeting · Youth · Women’s ·\nMen’s · Special Programme', {
    x: 8.4, y: 4.75, w: 4.3, h: 1.1, fontFace: FONT, fontSize: 12, color: MUTED, lineSpacing: 18,
  });

  notes(s, `
Demonstrate the speed, because that is the objection you will get:

  "Mark All Present in one tap, then change the handful who are not there. A
   register of several hundred is a few minutes' work, and it saves in one
   action - not one member at a time."

A register can cover the whole congregation, or a single department or cell.

IF ASKED ABOUT UNMARKED PEOPLE: anyone not marked is recorded as "not recorded",
never as absent. A half-finished register never makes the congregation look
absent, and never triggers a false alert. That safeguard is deliberate.
  `);
}

// ===========================================================================
// SLIDE 9 - The absence engine
// ===========================================================================
{
  const s = contentSlide('Absence is noticed automatically', 'The heart of the system');

  s.addText('The system reviews attendance every night. Nobody has to remember to check.', {
    x: 0.7, y: 1.9, w: 11.9, h: 0.4, fontFace: FONT, fontSize: 17, color: INK,
  });

  const levels = [
    { n: '2', label: 'services missed', title: 'Level 1', name: 'Follow-Up Reminder', desc: 'A friendly check-in', colour: '0EA5E9' },
    { n: '3', label: 'services missed', title: 'Level 2', name: 'Urgent Follow-Up', desc: 'A proper phone call this week', colour: AMBER },
    { n: '4', label: 'services missed', title: 'Level 3', name: 'Pastoral Follow-Up', desc: 'A visit — roughly a month away', colour: RED },
  ];

  levels.forEach((lv, i) => {
    const x = 0.7 + i * 4.02;
    s.addShape(pptx.ShapeType.rect, { x, y: 2.5, w: 3.75, h: 3.05, fill: { color: WHITE }, line: { color: RULE, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x, y: 2.5, w: 3.75, h: 0.12, fill: { color: lv.colour }, line: { color: lv.colour } });

    s.addText(lv.n, { x: x + 0.28, y: 2.75, w: 1.1, h: 0.95, fontFace: FONT, fontSize: 54, bold: true, color: lv.colour });
    s.addText(lv.label, { x: x + 1.35, y: 3.15, w: 2.2, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED });

    s.addText(lv.title, { x: x + 0.28, y: 3.85, w: 3.2, h: 0.32, fontFace: FONT, fontSize: 13, bold: true, color: MUTED, charSpacing: 1 });
    s.addText(lv.name, { x: x + 0.28, y: 4.2, w: 3.2, h: 0.42, fontFace: FONT, fontSize: 18, bold: true, color: NAVY });
    s.addText(lv.desc, { x: x + 0.28, y: 4.68, w: 3.2, h: 0.65, fontFace: FONT, fontSize: 12, color: MUTED });
  });

  s.addText('These thresholds are ours to set — they can be changed in Settings at any time.', {
    x: 0.7, y: 5.75, w: 11.9, h: 0.4, fontFace: FONT, fontSize: 13, color: GOLD, italic: true,
  });

  notes(s, `
SLOW DOWN HERE. This is the slide the whole presentation is built towards.

  "Nobody has to remember to check. Every night the system reviews who has been
   missing, and raises a graded alert. Two missed services is a friendly
   check-in. Three is a proper phone call this week. Four - about a month - is a
   pastoral visit."

Then hand back control, which matters to a room being asked to adopt something:

  "The thresholds are ours. If two weeks is too quick for our pattern, we change
   the number ourselves in Settings. It is not fixed by whoever built this."

Do not click away until someone has had a chance to react.
  `);
}

// ===========================================================================
// SLIDE 10 - What it does NOT conclude
// ===========================================================================
{
  const s = statementSlide();

  s.addText('The system never decides that\nsomeone has left the church.', {
    x: 1.2, y: 2.0, w: 11, h: 1.7,
    fontFace: FONT, fontSize: 38, bold: true, color: WHITE, lineSpacing: 46,
  });
  s.addShape(pptx.ShapeType.rect, { x: 1.2, y: 3.95, w: 1.4, h: 0.055, fill: { color: GOLD }, line: { color: GOLD } });
  s.addText('It raises an alert for a person.\nA person decides what it means.', {
    x: 1.2, y: 4.25, w: 11, h: 1.1,
    fontFace: FONT, fontSize: 22, color: GOLD_LIGHT, lineSpacing: 32,
  });

  notes(s, `
Say this CLEARLY and without hurrying. It is the concern a thoughtful pastor will
already be forming, and answering it before it is asked buys you enormous
credibility.

  "Absence has many innocent explanations - travel, illness, a new baby, night
   shifts, a work posting, caring for a relative. A computer cannot tell the
   difference between those and someone drifting away, and it should not try."

So the system:
  - never changes anyone's membership status
  - never marks anyone as backslidden or lapsed
  - never contacts a member on its own

Its only output is an alert addressed to a church worker.

SECOND SAFEGUARD, worth mentioning here: if someone tells us in advance that they
will be away and we mark them EXCUSED, the count resets. We do not chase people
who already told us.
  `);
}

// ===========================================================================
// SLIDE 11 - What an alert looks like
// ===========================================================================
{
  const s = contentSlide('What an alert looks like', 'Attendance alerts');
  screenshot(s, {
    x: 0.7, y: 1.95, w: 7.0, h: 4.45,
    file: 'alerts.png', label: 'Follow-Up › Alerts',
    capture: 'THE most important screenshot in the deck',
  });

  // Mock alert card.
  const cx = 8.05;
  s.addShape(pptx.ShapeType.rect, { x: cx, y: 1.95, w: 4.58, h: 3.05, fill: { color: WHITE }, line: { color: RED, width: 1.5 } });
  s.addShape(pptx.ShapeType.rect, { x: cx, y: 1.95, w: 4.58, h: 0.1, fill: { color: RED }, line: { color: RED } });

  s.addText('ATTENDANCE ALERT', { x: cx + 0.28, y: 2.2, w: 4.0, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: RED, charSpacing: 1.5 });
  s.addText('John Mensah', { x: cx + 0.28, y: 2.5, w: 4.0, h: 0.42, fontFace: FONT, fontSize: 21, bold: true, color: NAVY });
  s.addText('Absent for 3 consecutive weeks', { x: cx + 0.28, y: 2.95, w: 4.0, h: 0.32, fontFace: FONT, fontSize: 14, color: INK });
  s.addText('Last attendance:  19 July 2026\nDepartment:  Ushering\nPhone:  024 000 0000', {
    x: cx + 0.28, y: 3.32, w: 4.0, h: 0.95, fontFace: FONT, fontSize: 12, color: MUTED, lineSpacing: 17,
  });
  s.addShape(pptx.ShapeType.roundRect, { x: cx + 0.28, y: 4.35, w: 2.0, h: 0.45, fill: { color: NAVY }, line: { color: NAVY }, rectRadius: 0.06 });
  s.addText('Start Follow-Up', { x: cx + 0.28, y: 4.35, w: 2.0, h: 0.45, fontFace: FONT, fontSize: 12, bold: true, color: WHITE, align: 'center', valign: 'middle' });

  s.addText('In our sample data the system flagged 13 members from twelve weeks of attendance — 5 at Level 1, 2 at Level 2, 6 at Level 3.', {
    x: cx, y: 5.2, w: 4.58, h: 1.0, fontFace: FONT, fontSize: 12, color: GOLD, italic: true, lineSpacing: 17,
  });

  notes(s, `
Read the card out loud, exactly as it appears. Hearing a name makes it real in a
way that a bullet point never does.

  "Everything needed to act is on the row: who, how long, when they were last
   with us, which department they serve in, and the phone number. The leader
   presses Start Follow-Up, and the case opens."

THE NUMBERS ON THIS SLIDE ARE SAMPLE DATA. Replace them with your own before
presenting, or say so plainly. Either way, land the point:

  "Thirteen conversations that would otherwise not have happened."

John Mensah is a fictional example, not a member of this church.
  `);
}

// ===========================================================================
// SLIDE 12 - Follow-up
// ===========================================================================
{
  const s = contentSlide('Follow-up is a conversation, not a tick-box', 'Follow-up management');
  screenshot(s, {
    x: 0.7, y: 1.95, w: 7.0, h: 3.1,
    file: 'follow-up.png', label: 'A follow-up case',
    capture: 'Show the note history',
  });

  s.addText('Six statuses', { x: 8.05, y: 1.95, w: 4.6, h: 0.35, fontFace: FONT, fontSize: 15, bold: true, color: NAVY });
  bullets(s, [
    'Pending',
    'Contacted',
    'Responded',
    'Needs Further Follow-Up',
    'Resolved',
    'Unable to Reach',
  ], { x: 8.1, y: 2.35, w: 4.5, h: 2.6, fontSize: 12, spaceAfter: 6 });

  // The worked example quote.
  s.addShape(pptx.ShapeType.rect, { x: 0.7, y: 5.25, w: 7.0, h: 1.15, fill: { color: 'EEF2F7' }, line: { color: 'EEF2F7' } });
  s.addText('“Member was contacted and stated that he travelled for work.\nExpected to return next Sunday.”', {
    x: 0.95, y: 5.4, w: 6.6, h: 0.85, fontFace: FONT, fontSize: 13, color: NAVY, italic: true, lineSpacing: 20,
  });

  s.addText('Overdue cases are flagged automatically.', {
    x: 8.05, y: 5.25, w: 4.6, h: 0.9, fontFace: FONT, fontSize: 13, color: RED, bold: true,
  });

  notes(s, `
A case carries the member, the level, the officer responsible, and the date of
the next contact. Every attempt is written down - what was said, how contact was
made, what happens next.

READ THE QUOTED NOTE ALOUD, then explain why it matters:

  "That single sentence means the next person to open this case knows exactly
   where it stands. No repeated calls. No awkward second conversation. No case
   quietly dropped because the person handling it travelled."

Then the safeguard:

  "Overdue cases are flagged automatically. A case cannot be forgotten simply
   because it stopped feeling urgent."
  `);
}

// ===========================================================================
// SLIDE 13 - Birthdays
// ===========================================================================
{
  const s = contentSlide('Nobody is forgotten', 'Birthdays');
  screenshot(s, {
    x: 0.7, y: 1.95, w: 7.3, h: 4.45,
    file: 'birthdays.png', label: 'Birthdays',
    capture: 'Capture the birthday cards with photographs',
  });

  s.addText('Reminders are generated automatically', { x: 8.35, y: 1.95, w: 4.3, h: 0.6, fontFace: FONT, fontSize: 15, bold: true, color: NAVY });

  ['7 days before', '3 days before', '1 day before', 'On the day'].forEach((label, i) => {
    s.addShape(pptx.ShapeType.roundRect, {
      x: 8.4, y: 2.6 + i * 0.62, w: 4.2, h: 0.48, fill: { color: WHITE }, line: { color: GOLD, width: 1 }, rectRadius: 0.06,
    });
    s.addText(label, { x: 8.6, y: 2.6 + i * 0.62, w: 3.9, h: 0.48, fontFace: FONT, fontSize: 13, color: NAVY, valign: 'middle' });
  });

  s.addShape(pptx.ShapeType.rect, { x: 8.4, y: 5.3, w: 4.2, h: 1.05, fill: { color: 'EEF2F7' }, line: { color: 'EEF2F7' } });
  s.addText('The system does not message the member.\nIt reminds us.', {
    x: 8.6, y: 5.45, w: 3.9, h: 0.8, fontFace: FONT, fontSize: 12, bold: true, color: NAVY, lineSpacing: 18,
  });

  notes(s, `
Keep this one light - it is a breather between two heavy sections.

Birthdays today, this week and this month, each card showing the photograph,
name, date, age, department and phone number. Reminder points are configurable.

STATE THIS PLAINLY, because it is the same principle as the absence alerts:

  "The system does not message the member. It reminds US. Sending greetings stays
   a human act - which is the whole point of it."
  `);
}

// ===========================================================================
// SLIDE 14 - Departments and groups
// ===========================================================================
{
  const s = contentSlide('Departments and groups', 'Church structure');

  const panels = [
    {
      title: 'Departments',
      sub: 'What a member does',
      items: 'Choir · Ushering · Media · Youth\nChildren’s · Evangelism · Welfare\nProtocol · Men’s · Women’s · Technical',
      x: 0.7,
    },
    {
      title: 'Groups',
      sub: 'Where a member belongs',
      items: 'Cell groups · Prayer groups\nBible study groups\nZones · Fellowships',
      x: 6.75,
    },
  ];

  panels.forEach((p) => {
    s.addShape(pptx.ShapeType.rect, { x: p.x, y: 2.1, w: 5.88, h: 3.1, fill: { color: WHITE }, line: { color: RULE, width: 1 } });
    s.addShape(pptx.ShapeType.rect, { x: p.x, y: 2.1, w: 5.88, h: 0.1, fill: { color: GOLD }, line: { color: GOLD } });
    s.addText(p.title, { x: p.x + 0.35, y: 2.4, w: 5.2, h: 0.45, fontFace: FONT, fontSize: 22, bold: true, color: NAVY });
    s.addText(p.sub, { x: p.x + 0.35, y: 2.85, w: 5.2, h: 0.35, fontFace: FONT, fontSize: 13, color: GOLD, italic: true });
    s.addText(p.items, { x: p.x + 0.35, y: 3.35, w: 5.2, h: 1.6, fontFace: FONT, fontSize: 13, color: INK, lineSpacing: 22 });
  });

  s.addText('Each has a leader, a meeting day and time, its own roster and its own attendance figures.', {
    x: 0.7, y: 5.45, w: 11.9, h: 0.4, fontFace: FONT, fontSize: 14, color: MUTED,
  });

  notes(s, `
The distinction is worth stating once, clearly:

  "A department is what a member DOES. A group is where a member BELONGS."

Every member can have one of each.

Then the payoff, which is the real reason this slide exists:

  "This tells us something we usually only guess at - which parts of the church
   are genuinely active, and which have quietly stopped meeting."

That last point often prompts the first honest question of the meeting.
  `);
}

// ===========================================================================
// SLIDE 15 - Reports
// ===========================================================================
{
  const s = contentSlide('Ten reports, ready in seconds', 'Reporting');

  table(
    s,
    ['Membership', 'Attendance & care'],
    [
      ['Membership summary', 'Attendance by service'],
      ['New members', 'Attendance by department'],
      ['Members by department', 'Members with low attendance'],
      ['Members by age group', 'Absentee register'],
      ['Birthday register', 'Follow-up register'],
    ],
    { y: 2.1, colW: [5.965, 5.965], rowH: 0.5 },
  );

  ['Export to Excel', 'Export to PDF', 'Print'].forEach((label, i) => {
    s.addShape(pptx.ShapeType.roundRect, {
      x: 0.7 + i * 2.4, y: 5.35, w: 2.2, h: 0.5, fill: { color: NAVY }, line: { color: NAVY }, rectRadius: 0.06,
    });
    s.addText(label, { x: 0.7 + i * 2.4, y: 5.35, w: 2.2, h: 0.5, fontFace: FONT, fontSize: 12, bold: true, color: WHITE, align: 'center', valign: 'middle' });
  });

  s.addText('Every report carries the church name and the date it was produced.', {
    x: 0.7, y: 6.1, w: 11.9, h: 0.35, fontFace: FONT, fontSize: 12, color: MUTED, italic: true,
  });

  notes(s, `
  "No more assembling figures by hand the night before a council meeting. Choose
   a report, choose the dates, export it."

The small detail at the bottom is worth saying, because anyone who has sat
through a disputed council meeting will recognise it:

  "Every report carries the church name and the date it was produced - so there
   is never confusion about which version is on the table."
  `);
}

// ===========================================================================
// SLIDE 16 - Who sees what
// ===========================================================================
{
  const s = contentSlide('Who sees what', 'Access and roles');

  table(
    s,
    ['Role', 'Access'],
    [
      [{ text: 'Super Administrator', bold: true }, 'Everything, including user accounts and settings'],
      [{ text: 'Pastor', bold: true }, 'Full visibility of members, attendance, alerts and reports; manages follow-ups'],
      [{ text: 'Church Administrator', bold: true }, 'Registers members, records attendance, manages departments and groups'],
      [{ text: 'Department Leader', bold: true }, { text: 'Their own department only', color: RED, bold: true }],
      [{ text: 'Viewer', bold: true }, 'Read-only'],
    ],
    { y: 2.1, colW: [4.0, 7.93], rowH: 0.58 },
  );

  s.addText('Access is enforced by the system — not by trust, and not by hiding menus.', {
    x: 0.7, y: 5.6, w: 11.9, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: NAVY,
  });

  notes(s, `
  "A Department Leader who signs in sees only the people in their department. In
   our sample data that is 5 members instead of 62. They cannot reach anyone
   else's record even by trying."

Then the sentence that unlocks the practical benefit:

  "This is what makes it safe to give a dozen leaders access, rather than keeping
   everything with one overloaded administrator."

That reframing usually converts the last sceptic in the room.
  `);
}

// ===========================================================================
// SLIDE 17 - Protecting information
// ===========================================================================
{
  const s = contentSlide('Protecting our members’ information', 'Privacy and trust');

  bullets(s, [
    'Every person signs in with their own account',
    'Passwords are stored so that even we cannot read them',
    'Access is limited by role',
    { text: 'Every action is recorded — who did what, and when', highlight: true },
    'Photographs are visible only to signed-in church workers',
  ], { y: 2.1, fontSize: 17, spaceAfter: 15 });

  s.addShape(pptx.ShapeType.rect, { x: 0.7, y: 5.1, w: 11.93, h: 1.1, fill: { color: 'EEF2F7' }, line: { color: 'EEF2F7' } });
  s.addText('Before going live we will confirm our handling meets Ghana’s Data Protection Act, 2012 (Act 843).', {
    x: 1.0, y: 5.4, w: 11.3, h: 0.5, fontFace: FONT, fontSize: 14, color: NAVY,
  });

  notes(s, `
Open by naming the responsibility rather than the feature:

  "This system holds personal information about our congregation - addresses,
   phone numbers, dates of birth, photographs of children. That is a trust, and
   it should be treated as one."

DWELL ON THE AUDIT LOG. It is the point that reassures leaders most:

  "Every view, every change, every deletion is recorded against a named person.
   If a member ever asks 'who has looked at my record?', we can answer. That
   protects our members - and it protects our workers from suspicion."

The Data Protection Act line signals that we have thought past the software.
  `);
}

// ===========================================================================
// SLIDE 17b - Where our data lives
// ===========================================================================
{
  const s = contentSlide('Where our data lives', 'The system is online today');

  const cards = [
    { t: 'The website', d: `What staff open in a browser. Served over a secure (HTTPS) connection, the same protection a bank's site uses.`, k: 'church-connect-omega.vercel.app' },
    { t: 'The application', d: 'The part that enforces who may see what and records every action. Runs in a data centre in Frankfurt.', k: 'Render' },
    { t: 'The database', d: 'Member records, attendance and follow-ups. Hosted in Dublin, in the EU, with daily backups kept for seven days.', k: 'Supabase' },
  ];
  cards.forEach((c, i) => {
    const x = 0.7 + i * 4.05;
    s.addShape(pptx.ShapeType.roundRect, {
      x, y: 2.0, w: 3.85, h: 3.2, rectRadius: 0.12,
      fill: { color: WHITE }, line: { color: RULE, width: 1 },
    });
    s.addShape(pptx.ShapeType.ellipse, { x: x + 0.3, y: 2.3, w: 0.55, h: 0.55, fill: { color: NAVY }, line: { color: NAVY } });
    s.addText(String(i + 1), { x: x + 0.3, y: 2.3, w: 0.55, h: 0.55, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
    s.addText(c.t, { x: x + 0.3, y: 3.05, w: 3.25, h: 0.4, fontFace: FONT, fontSize: 17, bold: true, color: NAVY, margin: 0 });
    s.addText(c.d, { x: x + 0.3, y: 3.5, w: 3.25, h: 1.2, fontFace: FONT, fontSize: 12.5, color: INK, valign: 'top', margin: 0 });
    s.addText(c.k, { x: x + 0.3, y: 4.72, w: 3.25, h: 0.3, fontFace: FONT, fontSize: 11, color: GOLD, bold: true, margin: 0 });
  });

  s.addShape(pptx.ShapeType.rect, { x: 0.7, y: 5.5, w: 11.93, h: 1.0, fill: { color: 'EEF2F7' }, line: { color: 'EEF2F7' } });
  s.addText('Only the application can reach the database. Nothing about our members is reachable from the public internet, and the member register has been checked against direct access.', {
    x: 1.0, y: 5.62, w: 11.3, h: 0.78, fontFace: FONT, fontSize: 13, color: NAVY, valign: 'middle',
  });

  notes(s, `
This slide answers the question someone will otherwise ask at the worst moment:
"where is all this information actually kept?"

Three pieces, three reputable hosting companies, all in Europe. The database is
backed up every day. Nothing is on anyone's laptop.

If asked about cost: the website and database are on free tiers today; the
application server costs a few dollars a month once we want it to stay awake
around the clock. This is a fraction of what one printed register costs a year.
  `);
}

// ===========================================================================
// SLIDE 18 - What it does not do
// ===========================================================================
{
  const s = contentSlide('What it does not do', 'Being straight with you');

  bullets(s, [
    'It does not send SMS or emails  —  planned, not yet built',
    { text: 'It does not replace pastoral visiting', highlight: true },
    'It does not decide who is committed',
    'It does not manage finances, tithes or donations  —  future',
  ], { y: 2.2, fontSize: 18, spaceAfter: 20 });

  s.addShape(pptx.ShapeType.rect, { x: 0.7, y: 4.85, w: 11.93, h: 1.35, fill: { color: NAVY }, line: { color: NAVY } });
  s.addText('This system tells us who to visit.\nIt does not visit them. The ministry is still ours.', {
    x: 1.1, y: 5.05, w: 11.1, h: 1.0, fontFace: FONT, fontSize: 19, bold: true, color: WHITE, lineSpacing: 30,
  });

  notes(s, `
PUT THIS SLIDE IN DELIBERATELY, and say why:

  "A presentation that only lists strengths invites suspicion. So here is what
   this does not do."

Naming the limits earns trust now and prevents disappointment in month two.

EMPHASISE THE SECOND POINT. Read the navy panel aloud, slowly:

  "This system tells us who to visit. It does not visit them. The ministry is
   still ours - the system just makes sure we are pointed at the right people."

If the room only remembers one sentence from the whole presentation, this is a
good candidate.
  `);
}

// ===========================================================================
// SLIDE 19 - What we are asking for
// ===========================================================================
{
  const s = contentSlide('What we are asking for', 'Decisions needed today');

  const asks = [
    'Approval to adopt the system — it is built, online and ready',
    'A decision on our absence thresholds — is 2 / 3 / 4 services right for us?',
    'Names for the roles: who administers, who follows up',
    'Agreement to record attendance BY NAME, every Sunday',
    'A start date for entering the existing register',
  ];

  asks.forEach((ask, i) => {
    const y = 2.05 + i * 0.82;
    const isCritical = i === 3;
    s.addShape(pptx.ShapeType.ellipse, {
      x: 0.7, y, w: 0.55, h: 0.55,
      fill: { color: isCritical ? GOLD : NAVY }, line: { color: isCritical ? GOLD : NAVY },
    });
    s.addText(String(i + 1), { x: 0.7, y, w: 0.55, h: 0.55, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, align: 'center', valign: 'middle' });
    s.addText(ask, {
      x: 1.45, y, w: 11.1, h: 0.55,
      fontFace: FONT, fontSize: 17, color: isCritical ? NAVY : INK, bold: isCritical, valign: 'middle',
    });
  });

  s.addText('Point 4 decides whether this succeeds or fails.', {
    x: 0.7, y: 6.2, w: 11.9, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: GOLD,
  });

  notes(s, `
Go straight to point 4 and be blunt about it:

  "Everything this system does depends on someone marking a register by name,
   every Sunday. If we cannot commit to that, the alerts will be empty and the
   reports meaningless."

  "Better that we settle it now than discover it in three months."

Do not soften this. A leadership team that agrees to point 4 with their eyes open
is worth far more than one that agrees to everything vaguely.

Get names against points 2 and 3 before leaving the room if you can.
  `);
}

// ===========================================================================
// SLIDE 20 - Rollout
// ===========================================================================
{
  const s = contentSlide('Suggested rollout', 'Getting there');

  table(
    s,
    ['Phase', 'What happens', 'Rough time'],
    [
      [{ text: '✓', color: GREEN, bold: true }, { text: 'System set up and online; departments and groups entered', color: MUTED }, { text: 'Done', color: GREEN, bold: true }],
      ['1', 'Enter existing members', 'Weeks 1–3'],
      ['2', 'Train the administrator and ushers', 'Week 3'],
      ['3', 'Record attendance every Sunday', 'From week 4'],
      [{ text: '4', bold: true }, { text: 'First alerts appear; train leaders on follow-up', bold: true, color: NAVY }, { text: 'Week 6', bold: true }],
      ['5', 'First full report to the board', 'Week 8'],
    ],
    { y: 2.1, colW: [1.3, 8.13, 2.5], rowH: 0.5 },
  );

  s.addShape(pptx.ShapeType.rect, { x: 0.7, y: 5.5, w: 11.93, h: 1.0, fill: { color: 'EEF2F7' }, line: { color: 'EEF2F7' } });
  s.addText('Alerts cannot appear until there are a few weeks of attendance to compare. Expect roughly two months to the first genuinely useful alert.', {
    x: 1.0, y: 5.72, w: 11.3, h: 0.6, fontFace: FONT, fontSize: 13, color: NAVY,
  });

  notes(s, `
Set the expectation about timing explicitly, because it is where enthusiasm
usually turns into disappointment:

  "The system needs history before it can spot a pattern. Alerts cannot appear
   until there are a few weeks of attendance to compare - roughly two months from
   start to the first genuinely useful alert."

  "Say that now, so nobody thinks it has failed in week three."

Phase 2 is the heaviest lift. If asked: roughly two to three minutes per member,
so about 20 hours for 500 members - two or three people over a fortnight.
  `);
}

// ===========================================================================
// SLIDE 21 - Closing
// ===========================================================================
{
  const s = statementSlide();

  s.addText('BEFORE', { x: 1.2, y: 1.75, w: 11, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: '6A8AB0', charSpacing: 2.5 });
  s.addText('A member stops coming, and we notice months later.', {
    x: 1.2, y: 2.15, w: 10.8, h: 0.6, fontFace: FONT, fontSize: 24, color: '9BB2CD',
  });

  s.addShape(pptx.ShapeType.rect, { x: 1.2, y: 3.15, w: 10.8, h: 0.02, fill: { color: NAVY_LIGHT }, line: { color: NAVY_LIGHT } });

  s.addText('AFTER', { x: 1.2, y: 3.5, w: 11, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: GOLD, charSpacing: 2.5 });
  s.addText('A member misses two services, and someone is\nholding their name by the following week.', {
    x: 1.2, y: 3.9, w: 10.8, h: 1.4, fontFace: FONT, fontSize: 28, bold: true, color: WHITE, lineSpacing: 40,
  });

  s.addText(`${CHURCH}  —  Connecting People. Strengthening the Church.`, {
    x: 1.2, y: 6.2, w: 11, h: 0.4, fontFace: FONT, fontSize: 14, color: GOLD_LIGHT, italic: true,
  });
  s.addImage({ path: LOGO, x: 11.6, y: 5.9, w: 1.0, h: 1.0 });

  notes(s, `
Return to the question you asked on slide 2, and answer it.

Read the AFTER line, then STOP TALKING. Do not add a summary, do not thank the
software, do not list the features again. Let the contrast do the work and take
questions.

If you need a single closing line, use:

  "We are not asking to change how we care for people. We are asking to stop
   losing track of who needs it."
  `);
}

// ===========================================================================
await pptx.writeFile({ fileName: OUTPUT });
console.log(`\nDeck written to:\n  ${OUTPUT}\n`);
const captured = fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png')).length : 0;
console.log('  22 slides, each with speaker notes.');
console.log(`  ${captured} screen captures found in tools/deck/screenshots; any missing one is a gold placeholder.\n`);
