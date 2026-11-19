/**
 * Writes the campaign documents (storyboards, voice-over scripts, captions,
 * reference board, README) from the specs and the measured timelines, so the
 * timings in the storyboards are the ones actually in the videos.
 *
 *   node docs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REELS, VOICE, VOICE_RATE } from './specs/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(here, 'build');
const OUT = path.resolve(here, '../../EKKLESIA_PROMOTIONAL_CAMPAIGN');
const D = (p) => { fs.mkdirSync(path.join(OUT, p), { recursive: true }); return path.join(OUT, p); };

const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

// Scene-by-scene visual direction. Keyed by reel/scene id.
const BOARD = {
  reel1: {
    message: 'What Ekklesia is: a system for knowing our people, not just counting them.',
    cold: { visual: 'Cold open. Sanctuary photograph under a deep-navy tint, slow push-in, gold dust particles. Headline words rise in one by one; "numbers." lands in gold.', text: 'A church is more than numbers.', screens: 'None (brand photograph)', sfx: 'Music bed opens' },
    people: { visual: 'A 5x5 grid of member avatars (app-style pastel discs with initials) pops in one by one in a scattered order, then floats gently. Headline settles beneath.', text: 'Every member matters.', screens: 'None (avatars recreated in the app\'s Avatar style)', sfx: 'Whoosh' },
    problem: { visual: 'Two cards land: a paper head-count sheet with tally marks filling in ("312 present"), and a spreadsheet with ticks, crosses and question marks. At 4.1 s both lose their colour, blur and sink.', text: 'THE CHALLENGE / Hundreds of members. One register. / Counted. But not known.', screens: 'None (illustrative props)', sfx: 'Whoosh, two pops' },
    bridge: { visual: 'Blurred sanctuary, a gold light sweep crosses the frame, two headline lines rise.', text: 'Know your people. / Understand your church.', screens: 'None', sfx: 'Whoosh' },
    dashboard: { visual: 'Wordmark reveal ("INTRODUCING / EKKLESIA"), then the live Dashboard capture rises in a browser frame with a glass highlight sweep. Camera holds the overview, pushes into the Membership band (gold ring), then slides down to the Follow-up band.', text: 'Introducing EKKLESIA / Church Membership, Attendance & Follow-Up Management System', screens: 'dashboard.png (live capture)', sfx: 'Riser, chime' },
    outro: { visual: 'Shared end card: logo scales in over a soft gold glow, wordmark, tagline, system name, organisation, sample-data notice. Fades to black.', text: 'EKKLESIA / Connecting People. Strengthening the Church. / Redemption Temple Assemblies of God', screens: 'None', sfx: 'Logo chord' },
  },
  reel2: {
    message: 'Why it matters: absence is noticed automatically and graded, but a person always decides what it means.',
    question: { visual: 'Sanctuary photograph, slow push. The question rises in two lines; the second in gold.', text: 'When a member stops attending, / how long before someone notices?', screens: 'None', sfx: 'Music' },
    calendar: { visual: 'A September 2026 calendar card. Red crosses stamp onto four consecutive Sundays (6, 13, 20, 27) while the "Services missed" counter climbs 1-2-3-4 and turns red.', text: 'THE REALITY / Weeks pass. Nobody notices. / Services missed: 4', screens: 'None (calendar recreated in app card style)', sfx: 'Whoosh, four ticks' },
    alerts: { visual: 'Live Attendance alerts capture rises. Camera pushes into the three summary pills (Pastoral 6 / Urgent 2 / Reminder 5) with a gold ring, then drifts down the Level 3 list.', text: 'EVERY NIGHT / Absence is noticed automatically.', screens: 'alerts.png (live capture)', sfx: 'Whoosh, alert chime' },
    levels: { visual: 'Three white cards land in turn: 2 → Level 1 Follow-Up Reminder (sky), 3 → Level 2 Urgent Follow-Up (amber), 4 → Level 3 Pastoral Follow-Up (red). Badge colours and descriptions are the application\'s own.', text: 'THREE LEVELS / Graded follow-up. / Thresholds are the church\'s to set, in Settings.', screens: 'None (recreated from AbsenceAlertsPage copy)', sfx: 'Whoosh, three pops' },
    alertcard: { visual: 'The worked example from the leadership deck as an alert row: John Mensah, absent 3 consecutive services, last attendance 19 July 2026, Ushering, phone. Cursor travels to "Start follow-up", presses it, and the Start-a-follow-up dialog opens (assign, next contact, opening note).', text: 'ONE PRESS / Everything needed to act.', screens: 'None (recreated 1:1 from the alerts row and StartFollowUpDialog)', sfx: 'Chime, click, pop' },
    human: { visual: 'Blurred sanctuary. Three statements build, then clear for the campaign\'s closing pair.', text: 'The system never decides that someone has left. / It never contacts a member on its own. / It raises an alert for a person. / Technology helps us care. People make the difference.', screens: 'None', sfx: 'Whoosh' },
    outro: { visual: 'Shared end card with the reel\'s line.', text: 'No member should go unnoticed.', screens: 'None', sfx: 'Logo chord' },
  },
  reel3: {
    message: 'How it works: the real screens, one dashboard, every module.',
    reveal: { visual: 'Dashboard capture rises; the statistic cards are masked and uncovered one after another (membership, attendance, follow-up).', text: 'Everything your church needs. One dashboard.', screens: 'dashboard.png', sfx: 'Riser, chime' },
    membership: { visual: 'Camera pushes into the Membership band; gold ring around the six cards (63 total, 60 active, 3 inactive, 3 new, 26 male, 34 female).', text: 'Membership at a glance.', screens: 'dashboard.png', sfx: 'Whoosh' },
    attendance: { visual: 'Camera slides down to Attendance (today / week / month / rate) and then to the Follow-up band (absent 2 w / 3 w / 1 month, pending, overdue, resolved) with a ring.', text: 'Attendance. Follow-up at the top.', screens: 'dashboard.png', sfx: 'Whoosh' },
    profile: { visual: 'Member profile capture; camera pushes to the navy header card (photograph disc, name, badges, contact strip) and rings the six tabs.', text: 'MEMBER PROFILES / One record per member. With a photograph.', screens: 'member-profile.png', sfx: 'Whoosh' },
    register: { visual: 'Attendance register capture. Cursor clicks "Mark all present" (ring), then the camera pans right and the cursor clicks "Save & finalise".', text: 'ATTENDANCE REGISTER / Choose the service. Mark. Save.', screens: 'register.png', sfx: 'Whoosh, two clicks' },
    birthdays: { visual: 'Birthdays capture; push into the "Celebrating today" card (gold border).', text: 'BIRTHDAYS / Nobody is forgotten.', screens: 'birthdays.png', sfx: 'Whoosh' },
    departments: { visual: 'Departments capture; slow push across the department cards (leader, meeting time, roster).', text: 'DEPARTMENTS & GROUPS / Each with a leader and a roster.', screens: 'departments.png', sfx: 'Whoosh' },
    reports: { visual: 'Reports capture; push to the Print / Excel / PDF buttons (ring); cursor clicks PDF; Excel / PDF / Print chips pop in beneath.', text: 'REPORTS / Ready in seconds.', screens: 'reports.png', sfx: 'Whoosh, pops, click' },
    outro: { visual: 'Shared end card with the feature list.', text: 'Membership · Attendance · Profiles · Birthdays / Departments · Groups · Reports · Excel & PDF', screens: 'None', sfx: 'Logo chord' },
  },
  reel4: {
    message: 'How it improves follow-up and pastoral care: information becomes a human action.',
    leader: { visual: 'Blurred sanctuary; the Dashboard capture rises slowly into frame.', text: 'MONDAY MORNING / Know who needs attention.', screens: 'dashboard.png', sfx: 'Music' },
    alert: { visual: 'Push into the "Needs your attention" banner (13 members over a threshold, 6 for about a month) with a ring; cursor clicks "Review alerts"; cut to the Attendance alerts capture and push to the Priscilla Baidoo row.', text: 'NEEDS YOUR ATTENTION / An alert is waiting.', screens: 'dashboard.png → alerts.png', sfx: 'Alert, click, whoosh' },
    profile: { visual: 'Follow-up case capture (Priscilla Baidoo, Level 3). Push into the case card; ring around Level and Status (Pending); drift to the Contact history panel.', text: 'THE MEMBER\'S RECORD / History and the case, together.', screens: 'follow-up.png', sfx: 'Whoosh' },
    statuses: { visual: 'A white card with the six status badges in the application\'s tones popping in: Pending, Contacted, Responded, Needs Further Follow-Up, Resolved, Unable to Reach. A Pending → Contacted → Resolved flow beneath.', text: 'SIX STATUSES / Keep every follow-up organised.', screens: 'None (Badge component recreated)', sfx: 'Whoosh, six pops' },
    note: { visual: 'Record-contact dialog (Phone call, Contacted). The deck\'s example note types itself out; cursor presses "Save note"; the entry appears in the contact history.', text: 'RECORD CONTACT / Never lose track of a conversation.', screens: 'None (recreated from the Modal/Form components)', sfx: 'Click, pop' },
    more: { visual: 'Birthdays and Departments captures slide in as two overlapping browser frames.', text: 'Birthdays. Departments. Groups.', screens: 'birthdays.png, departments.png', sfx: 'Whoosh' },
    close: { visual: 'Sanctuary; two statements.', text: 'Ekklesia doesn\'t replace a pastor\'s visit. / It makes sure the visit happens.', screens: 'None', sfx: 'Whoosh' },
    outro: { visual: 'Shared end card.', text: 'Give every member the attention they deserve.', screens: 'None', sfx: 'Logo chord' },
  },
  reel5: {
    message: 'Why leadership should embrace it: accessible, role-based, accountable, and better information for decisions.',
    cinematic: { visual: 'Sanctuary photograph, long push, gold light sweep. Three lines rise.', text: 'One church. / Better information. / Stronger leadership.', screens: 'None', sfx: 'Music' },
    devices: { visual: 'Desktop browser frame, tablet and phone mockups rise in turn, all showing the Dashboard capture (phone shows the statistic cards).', text: 'BROWSER-BASED / Desktop, tablet or phone. Nothing to install.', screens: 'dashboard.png', sfx: 'Whoosh, three pops' },
    roles: { visual: 'Five role cards land in time with the narration: Super Administrator, Pastor, Church Administrator, Department Leader (their own department only), Viewer (read-only).', text: 'ROLE-BASED ACCESS / Who sees what.', screens: 'None (from the roles table in the deck)', sfx: 'Whoosh, five pops' },
    privacy: { visual: 'A white card: shield, then four checked lines (own account, limited by role, every action recorded, photographs only to signed-in staff).', text: 'PRIVACY & ACCOUNTABILITY / Member information is a trust.', screens: 'None (deck slide 17)', sfx: 'Whoosh' },
    reports: { visual: 'Reports capture, slow push into the report list.', text: 'REPORTS & DASHBOARD / Better information for better decisions.', screens: 'reports.png', sfx: 'Whoosh' },
    close: { visual: 'Sanctuary; three statements, the last in gold.', text: 'Organised membership. / Meaningful follow-up. / Technology serving the mission of the church.', screens: 'None', sfx: 'Whoosh' },
    outro: { visual: 'Shared end card, held longer for the full closing line.', text: 'EKKLESIA / Connecting People. Strengthening the Church. / Developed for Redemption Temple Assemblies of God / Modern church administration.', screens: 'None', sfx: 'Logo chord' },
  },
};

const CAPTIONS = {
  reel1: {
    caption: `A church is more than numbers. Every member matters.\n\nIntroducing EKKLESIA - the Church Membership, Attendance & Follow-Up Management System built for Redemption Temple Assemblies of God.\n\nKnow your people. Understand your church.\n\nConnecting People. Strengthening the Church.`,
    tags: '#Ekklesia #RedemptionTemple #AssembliesOfGod #ChurchManagement #ChurchMembership #EveryMemberMatters #ChurchTech #ChurchAdmin #Ghana',
  },
  reel2: {
    caption: `When a member stops attending, how long before someone notices?\n\nEKKLESIA reviews attendance every night and raises a graded alert for a church worker: 2 missed services, 3, then 4. It never decides that someone has left, and it never contacts anyone on its own. People do that.\n\nNo member should go unnoticed.`,
    tags: '#Ekklesia #EveryMemberMatters #PastoralCare #ChurchFollowUp #ChurchAttendance #RedemptionTemple #AssembliesOfGod #ChurchManagement',
  },
  reel3: {
    caption: `Everything your church needs. One dashboard.\n\nMembership, attendance, member profiles with photographs, birthday reminders, departments and groups, and ten reports you can export to Excel or PDF.\n\nEKKLESIA - church management, made simpler.\n\n(Screens show demonstration data.)`,
    tags: '#Ekklesia #ChurchDashboard #ChurchManagement #ChurchAdmin #ChurchSoftware #RedemptionTemple #AssembliesOfGod #Membership',
  },
  reel4: {
    caption: `Smarter follow-up. Stronger connections.\n\nAn alert appears. A leader opens the record, sees the history, records the conversation. Six statuses keep every case honest - from Pending to Resolved - and nothing is lost in handover.\n\nEKKLESIA doesn't replace a pastor's visit. It makes sure the visit happens.`,
    tags: '#Ekklesia #PastoralCare #ChurchFollowUp #Shepherding #ChurchLeadership #RedemptionTemple #AssembliesOfGod #EveryMemberMatters',
  },
  reel5: {
    caption: `One church. Better information. Stronger leadership.\n\nEKKLESIA runs in the browser on desktop, tablet or phone. Five roles see exactly what they should, access is enforced by role, and every action is recorded.\n\nOrganised membership. Meaningful follow-up. Technology serving the mission of the church.\n\nDeveloped for Redemption Temple Assemblies of God.`,
    tags: '#Ekklesia #ChurchLeadership #ChurchManagement #ChurchTech #DataProtection #RedemptionTemple #AssembliesOfGod #ConnectingPeople',
  },
};

const timelines = Object.fromEntries(REELS.map((r) => [r.id, JSON.parse(fs.readFileSync(path.join(BUILD, `${r.id}.timeline.json`), 'utf8'))]));

// --- Storyboards -------------------------------------------------------------
const sbDir = D('Storyboards');
for (const reel of REELS) {
  const tl = timelines[reel.id];
  const b = BOARD[reel.id];
  let md = `# ${reel.file.replace(/_/g, ' ').replace(/^Reel (\d+)/, 'Reel $1 -')}\n\n`;
  md += `**Theme:** ${reel.theme}  \n**Duration:** ${tl.total.toFixed(1)} s · 1080 × 1920 · 30 fps · 9:16  \n**Message:** ${b.message}\n\n`;
  md += `| # | Time | Scene | Visual direction | On-screen text | Voice-over | Source screens | Sound |\n|---|---|---|---|---|---|---|---|\n`;
  tl.scenes.forEach((s, i) => {
    const d = b[s.id];
    md += `| ${i + 1} | ${fmt(s.start)} – ${fmt(s.end)} | ${s.id} | ${d.visual} | ${d.text.replace(/\|/g, '/')} | ${s.vo ? `"${s.vo.text}"` : '—'} | ${d.screens} | ${d.sfx} |\n`;
  });
  md += `\n**Persistent elements:** brand corner (logo + EKKLESIA / Redemption Temple AG) top-left on every scene except the end card; "SAMPLE DATA" top-right whenever a live capture or demonstration name is on screen; burned-in subtitles; gold particle field; shared end card.\n`;
  fs.writeFileSync(path.join(sbDir, `${reel.file}.md`), md);
}

// --- Voice-over scripts ------------------------------------------------------
const voDir = D('Voiceover_Scripts');
let all = `# Ekklesia campaign - voice-over scripts\n\nVoice: warm, confident, unhurried. Produced with the ${VOICE} neural voice at ${VOICE_RATE}; a human voice artist should read at the same pace (about 150 words per minute) so the picture cuts still land.\n\n`;
for (const reel of REELS) {
  const tl = timelines[reel.id];
  let md = `# ${reel.title} - voice-over\n\nTheme: ${reel.theme}. Running time ${tl.total.toFixed(1)} s.\n\n`;
  for (const s of tl.scenes) if (s.vo) md += `**[${fmt(s.vo.start)}] ${s.id}**  \n${s.vo.text}\n\n`;
  fs.writeFileSync(path.join(voDir, `${reel.file}.md`), md);
  all += md.replace(/^# /, '## ') + '\n';
}
fs.writeFileSync(path.join(voDir, 'All_Reels.md'), all);

// --- Captions ----------------------------------------------------------------
const capDir = D('Social_Media_Captions');
let cap = `# Captions, hashtags and publishing sequence\n\n`;
cap += `## Recommended publishing sequence\n\nPost one reel every three to four days so the story builds: what it is → why it matters → how it works → how it changes pastoral care → why leadership should embrace it.\n\n`;
cap += `| Order | Day | Reel | What the audience should understand |\n|---|---|---|---|\n`;
const seq = ['Sunday (after service)', 'Wednesday', 'Sunday', 'Wednesday', 'Sunday'];
REELS.forEach((r, i) => { cap += `| ${i + 1} | ${seq[i]} | ${r.file.replace(/_/g, ' ')} | ${BOARD[r.id].message} |\n`; });
cap += `\nRepost Reel 2 (the question) once more after Reel 5 as the campaign's "most important message": this is a system for knowing our people, not just counting them.\n\nPlatforms: Instagram Reels, Facebook Reels, TikTok, WhatsApp Status (WhatsApp accepts up to 60 s per status; every reel fits in one). Upload the matching .srt where the platform supports captions; subtitles are also burned in.\n\n`;
for (const r of REELS) {
  cap += `## ${r.file.replace(/_/g, ' ')}\n\n**Message:** ${BOARD[r.id].message}\n\n**Caption**\n\n${CAPTIONS[r.id].caption}\n\n**Hashtags**\n\n${CAPTIONS[r.id].tags}\n\n`;
}
fs.writeFileSync(path.join(capDir, 'Captions_and_Hashtags.md'), cap);

// --- Reference board ---------------------------------------------------------
const paDir = D('Production_Assets');
fs.writeFileSync(path.join(paDir, 'Visual_Reference_Board.md'), `# Visual reference board

Everything in the reels is drawn from the live Ekklesia application and the leadership deck. Nothing was invented.

## Captures used (Production_Assets/Screens, 2x captures from the running system, demonstration data)

| File | Screen | Used in |
|---|---|---|
| dashboard.png | Dashboard: greeting, "Needs your attention" banner, Membership / Attendance / Follow-up / Birthdays bands | Reels 1, 3, 4, 5 |
| alerts.png | Follow-Up → Alerts: summary pills, Level 3 list with "View follow-up" | Reels 2, 4 |
| follow-up.png | A follow-up case (Priscilla Baidoo, Level 3, Pending) with contact history | Reel 4 |
| member-profile.png | Member profile: navy header, photograph disc, badges, six tabs | Reel 3 |
| register.png | Attendance register: service header, Mark all present, Save & finalise | Reel 3 |
| birthdays.png | Birthdays: today / week / month / 30 days, celebrating today card | Reels 3, 4 |
| departments.png | Departments: cards with leader, meeting time, roster | Reels 3, 4 |
| reports.png | Reports: list, date range, Print / Excel / PDF | Reels 3, 5 |
| login.png | Login page (brand panel) | Reference only |

## Recreated elements (built from the component source, not re-imagined)

- **Badges** — \`client/src/components/ui/Badge.tsx\` tones: sky (Level 1 / Contacted), amber (Level 2 / Pending / Needs Further Follow-Up), red (Level 3 / Unable to Reach), emerald (Responded / Resolved).
- **Alert row and Start-follow-up dialog** — \`client/src/pages/AbsenceAlertsPage.tsx\` copy and layout; worked example (John Mensah) from the deck, slide 11.
- **Avatars** — pastel disc with initials, as \`Avatar.tsx\`.
- **Buttons, inputs, modal** — navy primary, outline secondary, rounded-xl cards (\`reel.css\` mirrors \`tailwind.config.js\` and \`index.css\`).

## Palette and type

| Token | Value | Use |
|---|---|---|
| Navy 900 / 950 | #0F2A4A / #0A1C33 | Backgrounds, primary buttons |
| Gold 500 / 300 | #B8892B / #DBB877 | Emphasis words, kickers, rings |
| Ink / Muted | #0F172A / #64748B | Text on cards |
| Status | #0ca30c / #fab219 / #d03b3b | Present / excused / absent, alert levels |
| Type | Inter (variable), 800 headlines, 600 captions | Same family as the application |

## Layout grid (1080 × 1920)

- Safe area: content between y = 230 and y = 1560; subtitles at y ≈ 1600; top 220 px and bottom 300 px left for platform UI.
- Brand corner at (60, 230); "SAMPLE DATA" at top-right whenever demonstration data is visible.
- Screen frame: x 40, width 1000, top 560 (490 on Reel 1), height follows the capture.
`);

// --- README ------------------------------------------------------------------
fs.writeFileSync(path.join(OUT, 'README.md'), `# EKKLESIA - Promotional Reels Campaign

Five connected reels introducing **Ekklesia**, the Church Membership, Attendance & Follow-Up Management System developed for **Redemption Temple Assemblies of God**.

| Reel | File | Length | Message |
|---|---|---|---|
${REELS.map((r, i) => `| ${i + 1} | ${r.file}.mp4 | ${timelines[r.id].total.toFixed(0)} s | ${BOARD[r.id].message} |`).join('\n')}

**Specification:** 1080 × 1920 (9:16), 30 fps, H.264 MP4 with AAC audio, burned-in subtitles plus a matching .srt beside each file. Suitable for Instagram Reels, Facebook Reels, TikTok and WhatsApp Status.

## Folders

- \`Reel_0N_*.mp4\` / \`.srt\` — the finished reels and their subtitle files.
- \`Storyboards/\` — scene-by-scene timing, visual direction, on-screen text, narration, source screens and sound for each reel.
- \`Voiceover_Scripts/\` — narration with timecodes (and a combined script for a voice artist).
- \`Social_Media_Captions/\` — caption and hashtags per reel, and the recommended publishing sequence.
- \`Production_Assets/\` — the application captures used, the logo, the visual reference board, music beds and subtitle files.

## Content accuracy

All product claims come from \`docs/PRESENTATION.md\` and the leadership deck. The reels do **not** claim SMS or email notifications, finance or tithes, automatic contact with members, or any conclusion that a member has left; Reel 2 says so explicitly. Every demonstration screen carries a "SAMPLE DATA" mark and the end card states that names and figures are samples. The worked alert example (John Mensah) is the deck's own.

## Production notes

- Visuals are rendered frame-by-frame from HTML compositions of the real captures (\`tools/reels\`), so the UI text is the application's own and stays sharp.
- Narration is a neural voice (${VOICE}); replace with a human voice artist by re-recording the scripts in \`Voiceover_Scripts/\` at the same pace and re-running the mix.
- The music bed and sound design are synthesised and royalty-free. A licensed track can be swapped in by replacing the bed in \`tools/reels/audio.mjs\`.
- Photographic scenes use the sanctuary image already shipped with the application. If the church films its own congregation or leadership footage, drop it into the cold-open scenes of Reels 1, 2 and 5 (see the storyboards) and re-render.

## Regenerating

\`\`\`
cd tools/reels
npm install
node voiceover.mjs   # narration + timelines
node render.mjs all  # silent 1080x1920 renders
node audio.mjs       # music, sound design, mix, mux -> EKKLESIA_PROMOTIONAL_CAMPAIGN/
node docs.mjs        # these documents
\`\`\`
`);

console.log('docs written to', OUT);
