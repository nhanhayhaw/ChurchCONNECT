/**
 * The reels: scene order, voice-over lines and minimum hold per scene.
 *
 * The voice-over decides the pacing: a scene lasts max(min, delay + VO + pad)
 * so narration is never cut off, and the visuals in reels/*.html key off the
 * resulting timeline (build/<reel>.timeline.json).
 *
 * Product facts come from docs/PRESENTATION.md and the leadership deck only.
 * Nothing here claims SMS/email, finance, automatic contact, or conclusions
 * about a member - those are explicitly out of scope in the deck.
 */
export const VOICE = 'en-GB-RyanNeural';
export const VOICE_RATE = '+10%';

export const REELS = [
  {
    id: 'reel1',
    file: 'Reel_01_Introducing_Ekklesia',
    title: 'Introducing Ekklesia',
    theme: "A Smarter Way to Care for God's People",
    scenes: [
      { id: 'cold', min: 4.0, pad: 1.0, vo: 'A church is more than numbers.' },
      { id: 'people', min: 5.0, pad: 0.7, vo: 'Behind every seat is a person. Every member matters.' },
      { id: 'problem', min: 6.5, pad: 0.6, sfx: [['pop', 0.6], ['pop', 1.0]], vo: 'But paper registers and spreadsheets can only count. They cannot tell you who has quietly stopped coming.' },
      { id: 'bridge', min: 3.6, pad: 0.8, vo: 'Know your people. Understand your church.' },
      { id: 'dashboard', min: 8.0, pad: 0.7, sfx: [['riser', 0.3], ['chime', 1.2]], vo: 'Introducing Ekklesia. Church membership, attendance and follow-up management, built for Redemption Temple Assemblies of God.' },
      { id: 'outro', min: 5.5, pad: 1.6, vo: 'Ekklesia. Connecting people. Strengthening the church.' },
    ],
  },
  {
    id: 'reel2',
    file: 'Reel_02_Every_Member_Matters',
    title: 'Never Lose Track of a Member',
    theme: 'Because Every Member Matters',
    scenes: [
      { id: 'question', min: 4.5, pad: 0.9, vo: 'When a member stops attending, how long before someone notices?' },
      { id: 'calendar', min: 5.5, pad: 0.6, sfx: [['tick', 0.9], ['tick', 1.7], ['tick', 2.5], ['tick', 3.3]], vo: 'In most churches, the answer is months. Usually by accident.' },
      { id: 'alerts', min: 4.5, pad: 0.6, sfx: [['alert', 2.7]], vo: 'Ekklesia reviews attendance every night and notices absence automatically.' },
      { id: 'levels', min: 7.5, pad: 0.6, sfx: [['pop', 0.6], ['pop', 2.3], ['pop', 4.0]], vo: 'Two missed services: a reminder. Three: urgent. Four: a pastoral follow-up.' },
      { id: 'alertcard', min: 7.0, pad: 0.6, sfx: [['chime', 0.6], ['click', 4.1], ['pop', 4.45]], vo: 'Every alert shows who, how long, when they were last seen, and a phone number. One press starts a follow-up.' },
      { id: 'human', min: 7.0, pad: 2.6, vo: 'Ekklesia never decides that someone has left, and never contacts members itself. It alerts a church worker.' },
      { id: 'outro', min: 4.5, pad: 1.6, vo: 'Ekklesia. No member should go unnoticed.' },
    ],
  },
  {
    id: 'reel3',
    file: 'Reel_03_One_Dashboard',
    title: 'Everything Your Church Needs. One Dashboard.',
    theme: 'Church Management Made Simpler',
    scenes: [
      { id: 'reveal', min: 4.5, pad: 0.8, sfx: [['riser', 0.3], ['chime', 1.2]], vo: 'Everything your church needs. One dashboard.' },
      { id: 'membership', min: 3.2, pad: 0.5, vo: 'Membership at a glance.' },
      { id: 'attendance', min: 5.5, pad: 0.5, vo: 'Attendance today, this week, this month. And who needs follow-up, at the top.' },
      { id: 'profile', min: 4.5, pad: 0.5, vo: 'One complete record per member, with a photograph.' },
      { id: 'register', min: 4.0, pad: 0.5, sfx: [['click', 2.9], ['click', 5.1]], vo: 'Choose the service. Mark the register. Save.' },
      { id: 'birthdays', min: 3.4, pad: 0.5, vo: 'Birthday reminders, so nobody is forgotten.' },
      { id: 'departments', min: 3.8, pad: 0.5, vo: 'Departments and groups, each with a leader and a roster.' },
      { id: 'reports', min: 4.2, pad: 0.6, sfx: [['click', 3.8], ['pop', 2.9], ['pop', 3.1], ['pop', 3.3]], vo: 'Ten reports in seconds. Export to Excel or PDF.' },
      { id: 'outro', min: 5.0, pad: 1.6, vo: 'Ekklesia. Church management, made simpler.' },
    ],
  },
  {
    id: 'reel4',
    file: 'Reel_04_Smarter_Follow_Up',
    title: 'Smarter Follow-Up. Stronger Connections.',
    theme: 'Turning Information into Action',
    scenes: [
      { id: 'leader', min: 4.2, pad: 0.6, vo: 'Monday morning. A church leader opens the dashboard.' },
      { id: 'alert', min: 5.5, pad: 0.6, sfx: [['alert', 1.0], ['click', 3.1], ['whoosh', 3.7]], vo: 'Thirteen members are over an absence threshold. Six, for about a month.' },
      { id: 'profile', min: 5.5, pad: 0.6, vo: "She opens the member's record: the attendance history, and the follow-up case." },
      { id: 'statuses', min: 5.5, pad: 0.6, sfx: [['pop', 1.0], ['pop', 1.22], ['pop', 1.44], ['pop', 1.66], ['pop', 1.88], ['pop', 2.1]], vo: 'Six statuses keep every case honest, from Pending to Resolved.' },
      { id: 'note', min: 7.0, pad: 0.6, sfx: [['click', 5.2], ['pop', 5.55]], vo: 'Every conversation is written down, so the next person knows where things stand.' },
      { id: 'more', min: 3.6, pad: 0.5, vo: 'Birthdays, departments and groups, in one place.' },
      { id: 'close', min: 5.0, pad: 0.8, vo: "Ekklesia does not replace a pastor's visit. It makes sure the visit happens." },
      { id: 'outro', min: 4.5, pad: 1.6, vo: 'Ekklesia. Give every member the attention they deserve.' },
    ],
  },
  {
    id: 'reel5',
    file: 'Reel_05_Future_of_Church_Management',
    title: 'The Future of Church Management',
    theme: 'One Church. Better Information. Stronger Leadership.',
    scenes: [
      { id: 'cinematic', min: 4.5, pad: 0.8, vo: 'Leading a church means knowing its people.' },
      { id: 'devices', min: 5.5, pad: 0.6, sfx: [['pop', 0.4], ['pop', 1.2], ['pop', 2.0]], vo: 'Ekklesia runs in a browser: desktop, tablet or phone. Nothing to install.' },
      { id: 'roles', min: 8.0, pad: 0.6, sfx: [['pop', 0.6], ['pop', 2.9], ['pop', 3.9], ['pop', 4.9], ['pop', 6.0]], vo: 'Five roles, each seeing only what they should: Super Administrator, Pastor, Church Administrator, Department Leader, and Viewer.' },
      { id: 'privacy', min: 5.0, pad: 0.6, vo: 'Access is enforced by role, and every action is recorded.' },
      { id: 'reports', min: 3.6, pad: 0.6, vo: 'Better information, for better decisions.' },
      { id: 'close', min: 5.5, pad: 0.8, vo: "Organised membership. Meaningful follow-up. Technology serving the church's mission." },
      { id: 'outro', min: 6.0, pad: 1.8, vo: 'Ekklesia. Connecting people, strengthening the church. Developed for Redemption Temple Assemblies of God.' },
    ],
  },
  {
    id: 'reel6',
    file: 'Reel_06_Six_Roles_One_Church',
    title: 'Six Roles. One Church.',
    theme: 'Who Sees What',
    scenes: [
      { id: 'open', min: 4.5, pad: 0.8, vo: 'Not everyone in a church needs to see everything.' },
      { id: 'signin', min: 4.5, pad: 0.5, sfx: [['chime', 1.0]], vo: 'Each person signs in with their own account, and sees only what their role allows.' },
      { id: 'leaders', min: 6.5, pad: 0.4, sfx: [['pop', 0.6], ['pop', 2.0], ['pop', 3.5]], vo: 'Super Administrator, everything. Pastor, full access. Church Administrator, registration and attendance.' },
      { id: 'care', min: 6.5, pad: 0.4, sfx: [['pop', 0.6], ['pop', 2.7], ['pop', 5.2]], vo: 'Department Leader, their own department only. Tele Pastor, care by phone and visitation. Viewer, read-only.' },
      { id: 'telepastor', min: 6.0, pad: 0.4, sfx: [['pop', 1.2], ['pop', 1.8], ['pop', 2.4], ['pop', 3.0]], vo: "The Tele Pastor is the pastor's extended hands. Alerts, birthdays, records, every call written down." },
      { id: 'enforced', min: 4.5, pad: 0.7, vo: 'Enforced by the system, not by trust. Every action recorded.' },
      { id: 'outro', min: 5.0, pad: 1.6, vo: 'Ekklesia. Six roles. One church.' },
    ],
  },
];
