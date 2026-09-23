/**
 * Demo data seeder.
 *
 * Produces a church that looks and behaves like a real one on day two of using
 * the system: 62 members across 11 departments and 6 groups, 12 weeks of
 * Sunday registers plus midweek services, and - importantly - deliberately
 * shaped absence patterns so every follow-up level has real examples to show.
 *
 * ALL NAMES AND CONTACT DETAILS ARE FICTIONAL. The names are common Ghanaian
 * given names and surnames combined arbitrarily; the phone numbers use the
 * +233 24 000 xxxx block and the email addresses use example.com, neither of
 * which routes anywhere. No real person's information is present.
 *
 * The generator is seeded with a fixed value, so running it twice on a fresh
 * database produces byte-identical data - useful when demonstrating the system
 * or writing tests against it.
 *
 *   npm run seed          seed (refuses if members already exist)
 *   npm run seed -- --force   wipe demo tables and reseed
 */
import { pool, closePool } from '../config/db.js';
import { env } from '../config/env.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import { DEFAULT_ROLES, ROLE_NAMES } from '../config/permissions.js';
import { SETTING_DEFAULTS } from '../services/settings.service.js';
import { toIsoDate, addDays, today } from '../utils/dates.js';

// ---------------------------------------------------------------------------
// Deterministic pseudo-random generator (mulberry32)
// ---------------------------------------------------------------------------
function makeRandom(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = makeRandom(20260810);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!;
const between = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));

// ---------------------------------------------------------------------------
// Fictional name pools
// ---------------------------------------------------------------------------
const MALE_FIRST = [
  'Kwame', 'Kofi', 'Yaw', 'Kwabena', 'Kwaku', 'Kojo', 'Kwasi', 'Emmanuel', 'Samuel', 'Daniel',
  'Isaac', 'Michael', 'Joseph', 'Nana', 'Prince', 'Ebenezer', 'Richmond', 'Bright', 'Selorm', 'Elikem',
  'Fiifi', 'Paa', 'Nii', 'Godwin', 'Bernard',
];
const FEMALE_FIRST = [
  'Ama', 'Akosua', 'Abena', 'Afua', 'Adwoa', 'Yaa', 'Esi', 'Grace', 'Mary', 'Comfort',
  'Gifty', 'Priscilla', 'Sandra', 'Vida', 'Naa', 'Adjoa', 'Efua', 'Dora', 'Belinda', 'Mavis',
  'Perpetual', 'Linda', 'Josephine', 'Rebecca', 'Hannah',
];
const MIDDLE = ['Kojo', 'Yaw', 'Nana', 'Kwabena', 'Adjoa', 'Akua', 'Kwesi', 'Efua', null, null, null, null];
const SURNAMES = [
  'Mensah', 'Owusu', 'Boateng', 'Asante', 'Appiah', 'Osei', 'Adjei', 'Agyeman', 'Darko', 'Frimpong',
  'Ansah', 'Bediako', 'Amoah', 'Danso', 'Sarpong', 'Antwi', 'Nyarko', 'Baidoo', 'Quartey', 'Tetteh',
  'Lartey', 'Aidoo', 'Ofori', 'Addo', 'Gyamfi', 'Nkrumah', 'Acheampong', 'Yeboah', 'Bonsu', 'Amponsah',
];

const DEPARTMENTS = [
  { name: 'Choir', description: 'Leads the congregation in worship at all services.', day: 'Thursday', time: '18:30' },
  { name: 'Media', description: 'Sound, projection, livestream and photography.', day: 'Saturday', time: '10:00' },
  { name: "Men's Ministry", description: 'Discipleship and fellowship for the men of the church.', day: 'Saturday', time: '06:00' },
  { name: "Women's Ministry", description: "Discipleship and fellowship for the women of the church.", day: 'Wednesday', time: '16:00' },
  { name: 'Youth', description: 'Ministry to teenagers and young adults.', day: 'Friday', time: '17:30' },
  { name: "Children's Ministry", description: 'Sunday school and children’s church.', day: 'Sunday', time: '08:30' },
  { name: 'Evangelism', description: 'Outreach, follow-up of new converts and community mission.', day: 'Saturday', time: '07:00' },
  { name: 'Welfare', description: 'Practical care for members in need.', day: 'Tuesday', time: '17:00' },
  { name: 'Ushering', description: 'Welcomes and seats the congregation; takes the count.', day: 'Sunday', time: '07:30' },
  { name: 'Protocol', description: 'Care of guests, ministers and visiting speakers.', day: 'Sunday', time: '07:30' },
  { name: 'Technical Team', description: 'Electrical, instruments and facility maintenance.', day: 'Saturday', time: '09:00' },
];

const GROUPS = [
  { name: 'Bethel Cell', type: 'cell', location: 'Adenta, House No. 12 Blk C', day: 'Wednesday', time: '18:00' },
  { name: 'Zion Cell', type: 'cell', location: 'Madina Estates', day: 'Wednesday', time: '18:00' },
  { name: 'Gilead Prayer Group', type: 'prayer', location: 'Church auditorium', day: 'Tuesday', time: '05:30' },
  { name: 'Berea Bible Study', type: 'bible_study', location: 'Church annex hall', day: 'Thursday', time: '18:30' },
  { name: 'East Zone', type: 'zone', location: 'Teshie / Nungua', day: 'Saturday', time: '16:00' },
  { name: 'Grace Fellowship', type: 'fellowship', location: 'Dansoman', day: 'Friday', time: '18:00' },
];

const MINISTRIES = ['Worship', 'Intercession', 'Hospitality', 'Teaching', 'Outreach', null, null];
const SUBURBS = [
  'Adenta', 'Madina', 'Teshie', 'Dansoman', 'East Legon', 'Achimota', 'Kasoa', 'Tema Community 5',
  'Spintex', 'Weija', 'Lapaz', 'Ashaiman',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The most recent Sunday on or before `from`. */
function lastSunday(from = today()): string {
  const [y, m, d] = from.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  date.setDate(date.getDate() - date.getDay()); // getDay() 0 = Sunday
  return toIsoDate(date);
}

function randomBirthDate(minAge: number, maxAge: number): string {
  const year = new Date().getFullYear() - between(minAge, maxAge);
  const month = between(1, 12);
  const day = between(1, 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function phone(index: number): string {
  return `+233 24 000 ${String(1000 + index).slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  const force = process.argv.includes('--force');
  const client = await pool.connect();

  try {
    const existing = await client.query('SELECT COUNT(*)::int AS n FROM members');
    if (existing.rows[0].n > 0 && !force) {
      console.log(
        `\nDatabase already contains ${existing.rows[0].n} member(s).\n` +
          'Run  npm run seed -- --force  to wipe the demo data and reseed.\n',
      );
      return;
    }

    await client.query('BEGIN');

    if (force) {
      console.log('  clearing existing data ...');
      await client.query(`
        TRUNCATE follow_up_notes, follow_ups, attendance, attendance_services,
                 birthday_reminders, notification_reads, notifications, audit_logs,
                 member_photos, refresh_tokens, password_resets, members,
                 departments, groups, users, roles, system_settings
        RESTART IDENTITY CASCADE
      `);
    }

    // --- roles ------------------------------------------------------------
    console.log('  roles ...');
    const roleIds = new Map<string, number>();
    for (const role of DEFAULT_ROLES) {
      const { rows } = await client.query(
        `INSERT INTO roles (name, label, description, permissions, is_system)
         VALUES ($1,$2,$3,$4::jsonb,TRUE)
         ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label, permissions = EXCLUDED.permissions
         RETURNING id`,
        [role.name, role.label, role.description, JSON.stringify(role.permissions)],
      );
      roleIds.set(role.name, rows[0].id);
    }

    // --- settings ---------------------------------------------------------
    console.log('  system settings ...');
    const SETTING_META: Record<string, { category: string; label: string; description: string }> = {
      church_name: { category: 'church', label: 'Church name', description: 'Shown on the login page, reports and exports.' },
      church_tagline: { category: 'church', label: 'Tagline', description: 'Short motto shown under the church name.' },
      church_address: { category: 'church', label: 'Postal address', description: 'Printed on report headers.' },
      church_phone: { category: 'church', label: 'Telephone', description: 'Church office contact number.' },
      church_email: { category: 'church', label: 'Email address', description: 'Church office email address.' },
      church_logo_url: { category: 'church', label: 'Logo URL', description: 'Optional logo shown in the sidebar and on reports.' },
      birthday_reminder_days: { category: 'birthdays', label: 'Reminder days before birthday', description: 'How many days ahead reminders are generated.' },
      birthday_notifications_enabled: { category: 'birthdays', label: 'Raise birthday notifications', description: 'When off, birthdays appear on screen but raise no notifications.' },
      absence_level_1_services: { category: 'absence', label: 'Level 1 threshold (services missed)', description: 'Consecutive misses that trigger a Follow-Up Reminder.' },
      absence_level_2_services: { category: 'absence', label: 'Level 2 threshold (services missed)', description: 'Consecutive misses that trigger an Urgent Follow-Up.' },
      absence_level_3_services: { category: 'absence', label: 'Level 3 threshold (services missed)', description: 'Consecutive misses that trigger a Pastoral Follow-Up.' },
      absence_excused_counts: { category: 'absence', label: 'Count excused absences', description: 'When off, an excused absence resets the streak.' },
      absence_tracked_service_types: { category: 'absence', label: 'Services tracked for absence', description: 'Only these service types feed absence monitoring.' },
      absence_auto_create_followups: { category: 'absence', label: 'Open follow-ups automatically', description: 'When off, alerts are raised but cases are opened by hand.' },
      followup_overdue_days: { category: 'followups', label: 'Days before a follow-up is overdue', description: 'Used to flag neglected cases.' },
    };

    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      const meta = SETTING_META[key] ?? { category: 'general', label: key, description: '' };
      await client.query(
        `INSERT INTO system_settings (key, value, category, label, description)
         VALUES ($1,$2::jsonb,$3,$4,$5)
         ON CONFLICT (key) DO NOTHING`,
        [key, JSON.stringify(value), meta.category, meta.label, meta.description],
      );
    }
    await client.query(
      `UPDATE system_settings SET value = $1::jsonb WHERE key = 'church_name'`,
      [JSON.stringify('Grace Covenant Assembly')],
    );

    // --- departments & groups --------------------------------------------
    console.log('  departments and groups ...');
    const departmentIds: number[] = [];
    for (const d of DEPARTMENTS) {
      const { rows } = await client.query(
        `INSERT INTO departments (name, description, meeting_day, meeting_time) VALUES ($1,$2,$3,$4) RETURNING id`,
        [d.name, d.description, d.day, d.time],
      );
      departmentIds.push(rows[0].id);
    }

    const groupIds: number[] = [];
    for (const g of GROUPS) {
      const { rows } = await client.query(
        `INSERT INTO groups (name, group_type, meeting_day, meeting_time, meeting_location)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [g.name, g.type, g.day, g.time, g.location],
      );
      groupIds.push(rows[0].id);
    }

    // --- members ----------------------------------------------------------
    console.log('  members ...');
    const MEMBER_COUNT = 62;
    const year = new Date().getFullYear();
    const memberIds: number[] = [];
    const memberNames: string[] = [];

    for (let i = 0; i < MEMBER_COUNT; i += 1) {
      const gender = rnd() < 0.46 ? 'male' : 'female';
      const firstName = gender === 'male' ? pick(MALE_FIRST) : pick(FEMALE_FIRST);
      const lastName = pick(SURNAMES);
      const middleName = pick(MIDDLE);

      // A realistic age spread: mostly adults, a tail of youth and elders.
      const roll = rnd();
      const dob =
        roll < 0.12 ? randomBirthDate(6, 12) :
        roll < 0.28 ? randomBirthDate(13, 19) :
        roll < 0.58 ? randomBirthDate(20, 30) :
        roll < 0.82 ? randomBirthDate(31, 45) :
        roll < 0.95 ? randomBirthDate(46, 60) :
        randomBirthDate(61, 78);

      const age = year - Number(dob.slice(0, 4));

      // Joined anywhere from eight years ago to last week.
      const joinedDaysAgo = between(5, 8 * 365);
      const dateJoined = addDays(today(), -joinedDaysAgo);

      const status = rnd() < 0.9 ? 'active' : 'inactive';
      const category =
        age < 13 ? 'child' :
        joinedDaysAgo < 120 ? 'new_convert' :
        rnd() < 0.9 ? 'full_member' : 'associate';

      const { rows } = await client.query(
        `INSERT INTO members (
           member_code, first_name, middle_name, last_name, gender, date_of_birth, marital_status,
           nationality, phone, alt_phone, email, address, date_joined, membership_status,
           baptism_status, communion_status, membership_category, ministry,
           department_id, group_id, emergency_name, emergency_relationship, emergency_phone
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING id`,
        [
          `CC-${year}-${String(i + 1).padStart(4, '0')}`,
          firstName,
          middleName,
          lastName,
          gender,
          dob,
          age < 18 ? 'single' : pick(['single', 'married', 'married', 'married', 'widowed', 'divorced']),
          'Ghanaian',
          age >= 16 ? phone(i) : null,
          rnd() < 0.25 ? phone(i + 500) : null,
          age >= 16 && rnd() < 0.6
            ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`
            : null,
          `${between(1, 90)} ${pick(['Ako Adjei', 'Liberation', 'Ring Road', 'Spintex', 'Oxford'])} Street, ${pick(SUBURBS)}, Accra`,
          dateJoined,
          status,
          rnd() < 0.72 ? 'baptised' : rnd() < 0.5 ? 'pending' : 'not_baptised',
          age >= 13 && rnd() < 0.68 ? 'communicant' : 'not_communicant',
          category,
          pick(MINISTRIES),
          age < 13 ? departmentIds[5] : pick(departmentIds),
          pick(groupIds),
          `${pick([...MALE_FIRST, ...FEMALE_FIRST])} ${lastName}`,
          pick(['Spouse', 'Parent', 'Sibling', 'Guardian', 'Child', 'Friend']),
          phone(i + 900),
        ],
      );

      memberIds.push(rows[0].id);
      memberNames.push([firstName, middleName, lastName].filter(Boolean).join(' '));
    }

    // Give every department and group a leader drawn from its own members.
    for (const deptId of departmentIds) {
      const { rows } = await client.query(
        `SELECT id FROM members WHERE department_id = $1 AND membership_status = 'active'
          ORDER BY date_joined LIMIT 1`,
        [deptId],
      );
      if (rows[0]) await client.query(`UPDATE departments SET leader_member_id = $1 WHERE id = $2`, [rows[0].id, deptId]);
    }
    for (const groupId of groupIds) {
      const { rows } = await client.query(
        `SELECT id FROM members WHERE group_id = $1 AND membership_status = 'active'
          ORDER BY date_joined LIMIT 1`,
        [groupId],
      );
      if (rows[0]) await client.query(`UPDATE groups SET leader_member_id = $1 WHERE id = $2`, [rows[0].id, groupId]);
    }

    // --- users ------------------------------------------------------------
    console.log('  user accounts ...');
    const password = await hashPassword(env.SEED_DEFAULT_PASSWORD);
    const DEMO_USERS = [
      { name: 'Super Administrator', email: 'admin@churchconnect.demo', role: ROLE_NAMES.SUPER_ADMIN, dept: null },
      { name: 'Rev. Samuel Ofori', email: 'pastor@churchconnect.demo', role: ROLE_NAMES.PASTOR, dept: null },
      { name: 'Grace Boateng', email: 'registry@churchconnect.demo', role: ROLE_NAMES.CHURCH_ADMIN, dept: null },
      { name: 'Kwame Asante', email: 'choir.lead@churchconnect.demo', role: ROLE_NAMES.DEPARTMENT_LEADER, dept: departmentIds[0] },
      { name: 'Abena Darko', email: 'viewer@churchconnect.demo', role: ROLE_NAMES.VIEWER, dept: null },
    ];

    const userIds: number[] = [];
    for (const u of DEMO_USERS) {
      const { rows } = await client.query(
        `INSERT INTO users (full_name, email, password_hash, role_id, department_id, phone, must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,FALSE) RETURNING id`,
        [u.name, u.email, password, roleIds.get(u.role), u.dept, phone(700 + userIds.length)],
      );
      userIds.push(rows[0].id);
    }
    const adminUserId = userIds[0]!;

    // --- attendance -------------------------------------------------------
    console.log('  attendance registers (12 weeks) ...');

    // Twelve Sundays, oldest first.
    const sundays: string[] = [];
    const mostRecentSunday = lastSunday();
    for (let w = 11; w >= 0; w -= 1) sundays.push(addDays(mostRecentSunday, -7 * w));

    /**
     * Absence patterns. Index into memberIds; `missLast` is how many of the
     * most recent Sundays the member misses in an unbroken run, which is
     * exactly what the absence engine counts.
     *
     *   2 misses -> Level 1     3 misses -> Level 2     4+ misses -> Level 3
     */
    const patterns = new Map<number, number>();
    const assign = (indices: number[], missLast: number) => {
      for (const i of indices) patterns.set(i, missLast);
    };
    assign([3, 8, 14, 21, 29, 37], 2);   // Level 1 - six members
    assign([5, 17, 26, 41], 3);          // Level 2 - four members
    assign([11, 33, 48], 4);             // Level 3 - three members
    assign([19, 55], 6);                 // Level 3 - long-term, ~6 weeks

    const activeIndices = memberIds
      .map((_, i) => i)
      .filter((i) => i < MEMBER_COUNT);

    let markCount = 0;

    for (let s = 0; s < sundays.length; s += 1) {
      const date = sundays[s]!;
      const weeksAgo = sundays.length - 1 - s; // 0 = most recent

      const { rows: svc } = await client.query(
        `INSERT INTO attendance_services (service_date, service_type, title, is_finalized, recorded_by)
         VALUES ($1,'sunday_service',$2,TRUE,$3) RETURNING id`,
        [date, 'Sunday Celebration Service', adminUserId],
      );
      const serviceId = svc[0].id;

      const values: unknown[] = [];
      const tuples: string[] = [];

      for (const i of activeIndices) {
        const memberId = memberIds[i]!;

        // Members who joined after this service are simply not on the register.
        const { rows: joined } = await client.query(
          `SELECT 1 FROM members WHERE id = $1 AND date_joined <= $2 AND membership_status = 'active'`,
          [memberId, date],
        );
        if (joined.length === 0) continue;

        const missLast = patterns.get(i) ?? 0;
        let status: 'present' | 'absent' | 'excused';

        if (missLast > 0 && weeksAgo < missLast) {
          // Inside the deliberate absence run. One member is excused rather
          // than absent, so the "excused breaks the streak" rule is visible.
          status = i === 37 && weeksAgo === 0 ? 'excused' : 'absent';
        } else {
          // Ordinary attendance: faithful most weeks, occasionally away.
          const roll = rnd();
          status = roll < 0.84 ? 'present' : roll < 0.94 ? 'absent' : 'excused';
        }

        const base = values.length;
        values.push(serviceId, memberId, status, adminUserId);
        tuples.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4})`);
        markCount += 1;
      }

      if (tuples.length > 0) {
        await client.query(
          `INSERT INTO attendance (service_id, member_id, status, recorded_by) VALUES ${tuples.join(',')}`,
          values,
        );
      }
    }

    // A few midweek services, marked for attendees only - realistic, and it
    // exercises the code path where a register is deliberately incomplete.
    for (let w = 3; w >= 0; w -= 1) {
      const date = addDays(mostRecentSunday, -7 * w + 3); // Wednesday
      if (date > today()) continue;
      const { rows: svc } = await client.query(
        `INSERT INTO attendance_services (service_date, service_type, title, is_finalized, recorded_by)
         VALUES ($1,'midweek_service','Midweek Service',TRUE,$2) RETURNING id`,
        [date, adminUserId],
      );
      const serviceId = svc[0].id;

      const attendees = activeIndices.filter(() => rnd() < 0.42);
      if (attendees.length === 0) continue;

      const values: unknown[] = [];
      const tuples: string[] = [];
      for (const i of attendees) {
        const base = values.length;
        values.push(serviceId, memberIds[i], 'present', adminUserId);
        tuples.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4})`);
        markCount += 1;
      }
      await client.query(
        `INSERT INTO attendance (service_id, member_id, status, recorded_by) VALUES ${tuples.join(',')}
         ON CONFLICT (service_id, member_id) DO NOTHING`,
        values,
      );
    }

    // --- a few worked follow-up cases -------------------------------------
    console.log('  follow-up history ...');

    const workedCases = [
      {
        index: 8,
        status: 'contacted',
        level: 1,
        note: 'Called on Tuesday evening. He travelled to Kumasi for work and expects to be back next Sunday.',
        method: 'phone',
      },
      {
        index: 17,
        status: 'responded',
        level: 2,
        note: 'Spoke with her sister. She has been unwell with malaria but is recovering well and sends greetings.',
        method: 'phone',
      },
      {
        index: 33,
        status: 'needs_further_follow_up',
        level: 3,
        note: 'Visited the house on Saturday but nobody was home. A neighbour said the family may have relocated. Will try again next week.',
        method: 'visit',
      },
      {
        index: 5,
        status: 'resolved',
        level: 1,
        note: 'Met after service. She had been attending the early service instead. Now noted on her record.',
        method: 'in_person',
      },
    ];

    for (const c of workedCases) {
      const memberId = memberIds[c.index]!;
      const { rows: last } = await client.query(
        `SELECT MAX(s.service_date) AS d FROM attendance a
           JOIN attendance_services s ON s.id = a.service_id
          WHERE a.member_id = $1 AND a.status = 'present'`,
        [memberId],
      );

      const { rows: fu } = await client.query(
        `INSERT INTO follow_ups (member_id, level, weeks_absent, last_attendance_date, status, source,
                                 assigned_to, assigned_at, next_follow_up_date, last_contact_at, created_by,
                                 resolved_at, created_at)
         VALUES ($1,$2,$3,$4,$5,'auto',$6,NOW() - interval '5 days',$7,NOW() - interval '2 days',$8,$9,
                 NOW() - interval '6 days')
         RETURNING id`,
        [
          memberId,
          c.level,
          c.level + 1,
          last[0]?.d ?? null,
          c.status,
          userIds[2],
          addDays(today(), 4),
          adminUserId,
          c.status === 'resolved' ? new Date() : null,
        ],
      );

      await client.query(
        `INSERT INTO follow_up_notes (follow_up_id, author_user_id, note, contact_method, status_at_time, created_at)
         VALUES ($1,$2,$3,$4,$5, NOW() - interval '2 days')`,
        [fu[0].id, userIds[2], c.note, c.method, c.status],
      );
    }

    // --- a starter audit entry -------------------------------------------
    await client.query(
      `INSERT INTO audit_logs (user_email, user_role, action, entity_type, description, metadata)
       VALUES ('system@churchconnect','system','settings.update','settings',
               'Demo data seeded: ${MEMBER_COUNT} members, 12 weeks of attendance.', $1::jsonb)`,
      [JSON.stringify({ members: MEMBER_COUNT, marks: markCount })],
    );

    await client.query('COMMIT');

    // --- summary ----------------------------------------------------------
    console.log('\n  Seed complete.\n');
    console.log(`    members            ${MEMBER_COUNT}`);
    console.log(`    departments        ${DEPARTMENTS.length}`);
    console.log(`    groups             ${GROUPS.length}`);
    console.log(`    Sunday registers   ${sundays.length}`);
    console.log(`    attendance marks   ${markCount}`);
    console.log(`    follow-up cases    ${workedCases.length} worked + auto-generated on first scan`);
    console.log('\n  Demo sign-in (all accounts share the same password):\n');
    for (const u of DEMO_USERS) {
      console.log(`    ${u.email.padEnd(34)} ${u.name}`);
    }
    console.log(`\n    password: ${env.SEED_DEFAULT_PASSWORD}\n`);
    console.log('  Start the API, sign in, then open Follow-Up > Alerts and press');
    console.log('  "Run absence scan" to generate the graded alerts.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\nSeeding failed:', err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
