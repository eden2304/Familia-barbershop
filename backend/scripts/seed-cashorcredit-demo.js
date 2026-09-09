/* eslint-disable */
/**
 * Demo seed for the `cashOrCredit` branch.
 *
 * Adds a batch of clients, appointments (cash / credit / no payment method),
 * a recurring schedule, a blocked slot and waiting-list rows so the new
 * payment-method behaviour can be exercised end to end.
 *
 * Safe to re-run: demo clients are upserted by phone and their appointments in
 * the demo window are wiped and recreated every run.
 *
 * Usage:
 *   DATABASE_URL=postgres://familia:familia@localhost:5432/familia \
 *   JWT_SECRET=<same as backend/.env> \
 *   node backend/scripts/seed-cashorcredit-demo.js
 */

const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://familia:familia@localhost:5432/familia';
const JWT_SECRET = process.env.JWT_SECRET || '';
const DEMO_OTP = '1111';
const TZ_OFFSET = '+03'; // Asia/Jerusalem (IDT) for the seeded September dates

// Anchor everything around "today" so the weekly calendar (Sun–Fri) is populated.
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

const dow = now.getDay(); // 0=Sun
const sunday = addDays(now, -dow);
const D = {
  sun: ymd(sunday),
  mon: ymd(addDays(sunday, 1)),
  tue: ymd(addDays(sunday, 2)),
  wed: ymd(addDays(sunday, 3)),
  thu: ymd(addDays(sunday, 4)),
  fri: ymd(addDays(sunday, 5)),
  yesterday: ymd(addDays(now, -1)),
  thuPlus1w: ymd(addDays(sunday, 11)),
  thuPlus2w: ymd(addDays(sunday, 18)),
  thuPlus3w: ymd(addDays(sunday, 25)),
};

const ts = (date, hhmm) => `${date} ${hhmm}:00${TZ_OFFSET}`;

const CLIENTS = [
  { first: 'יוסי', last: 'כהן', phone: '0501234567', member: false, admin: false, blocked: false },
  { first: 'דנה', last: 'לוי', phone: '0507654321', member: true, admin: false, blocked: false },
  { first: 'אבי', last: 'ישראלי', phone: '0508887777', member: false, admin: false, blocked: false },
  { first: 'רון', last: 'ברק', phone: '0509998888', member: true, admin: false, blocked: false },
  { first: 'מאיה', last: 'שרון', phone: '0504445555', member: false, admin: false, blocked: false },
  { first: 'גיא', last: 'חסום', phone: '0506667777', member: false, admin: false, blocked: true },
];

async function main() {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('Missing/short JWT_SECRET env – copy it from backend/.env');
    process.exit(1);
  }

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  try {
    await db.query('BEGIN');

    // ---- services (make sure the 3 core services exist, grab their ids) ----
    const svc = {};
    const svcRows = await db.query('select id, name from services order by order_index');
    for (const r of svcRows.rows) svc[r.name] = r.id;
    const classic = svc['תספורת קלאסית'];
    const soldiers = svc['תספורת קלאסית חיילים בלבד'];
    const memberSvc = svc['תספורת קלאסית חברי מועדון'];
    if (!classic || !soldiers || !memberSvc) {
      throw new Error('Expected the 3 default services to already exist: ' + JSON.stringify(Object.keys(svc)));
    }

    // ---- clients (upsert by phone) ----
    const clientId = {};
    for (const c of CLIENTS) {
      const res = await db.query(
        `insert into clients (first_name, last_name, phone, is_member, is_admin, is_blocked)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (phone) do update
           set first_name = excluded.first_name,
               last_name  = excluded.last_name,
               is_member  = excluded.is_member,
               is_admin   = excluded.is_admin,
               is_blocked = excluded.is_blocked
         returning id`,
        [c.first, c.last, c.phone, c.member, c.admin, c.blocked],
      );
      clientId[c.phone] = res.rows[0].id;
    }

    // existing demo client "מוטי" (regular) + admin "בדיקה בדיקה"
    const motiRow = await db.query(`select id from clients where phone = '0500000000' limit 1`);
    const moti = motiRow.rows[0] && motiRow.rows[0].id;
    const adminRow = await db.query(`select id, first_name, last_name from clients where phone = '0537002171' limit 1`);
    const admin = adminRow.rows[0];

    const demoClientIds = Object.values(clientId).concat(moti ? [moti] : []);

    // ---- wipe previous demo appointments (demo clients, from Sunday onward) ----
    await db.query(
      `delete from appointments
       where client_id = any($1::uuid[])
         and starts_at >= $2::timestamptz`,
      [demoClientIds, ts(D.sun, '00:00')],
    );
    await db.query(
      `delete from recurring_appointments where client_id = any($1::uuid[])`,
      [demoClientIds],
    );
    await db.query(
      `delete from blocked_times where reason = 'הפסקת צהריים (דמו)'`,
    );
    await db.query(
      `delete from waiting_list where phone = any($1::text[])`,
      [CLIENTS.map((c) => c.phone)],
    );

    // ---- appointments: [date, hhmm, clientPhone|moti, serviceId, paymentMethod] ----
    // NOTE: the backend's CashCleanupScheduler purges cash appointments whose
    // day already ended, so "past cash" demo rows live on *today* (they survive
    // until midnight); credit / null rows are used for earlier days.
    const A = [
      // earlier days this week – render GREY, keep their payment icon
      [D.sun, '11:00', '0501234567', classic, 'credit'],
      [D.mon, '15:00', '0507654321', classic, 'credit'],
      [D.tue, '18:00', '0508887777', classic, 'credit'],
      [D.tue, '18:30', '0504445555', classic, null],
      // yesterday – a CASH appt purely to show auto-cleanup (gone after a
      // backend restart or at midnight)
      [D.yesterday, '19:00', 'moti', classic, 'cash'],
      // today – earlier slots already passed (grey), later slots upcoming (black)
      [D.wed, '09:00', '0501234567', classic, 'cash'],   // passed today: grey + cash icon
      [D.wed, '09:30', '0507654321', classic, 'credit'], // passed today: grey + credit icon
      [D.wed, '10:00', '0504445555', classic, null],     // passed today: grey, no icon
      [D.wed, '12:00', '0509998888', memberSvc, 'credit'],
      [D.wed, '16:00', '0507654321', classic, 'cash'],   // upcoming: black + cash icon
      [D.wed, '16:30', '0508887777', classic, 'credit'], // upcoming: black + credit icon
      [D.wed, '17:00', '0504445555', soldiers, null],    // upcoming: black, no icon, never auto-deleted
      [D.wed, '17:30', 'moti', classic, 'cash'],
      // rest of the week
      [D.thu, '12:00', '0501234567', classic, 'cash'],
      [D.thu, '12:30', '0507654321', classic, 'credit'], // also the recurring anchor
      [D.thu, '20:00', '0509998888', memberSvc, 'credit'],
      [D.fri, '09:00', '0508887777', classic, 'cash'],
      [D.fri, '09:30', '0504445555', classic, null],
    ];

    for (const [date, hhmm, who, serviceId, pay] of A) {
      const cid = who === 'moti' ? moti : clientId[who];
      if (!cid) continue;
      await db.query(
        `insert into appointments (client_id, service_id, starts_at, ends_at, status, payment_method, note)
         values ($1,$2,$3::timestamptz, $3::timestamptz + interval '30 minutes', 'booked', $4, $5)`,
        [cid, serviceId, ts(date, hhmm), pay, 'דמו cashOrCredit'],
      );
    }

    // ---- recurring schedule for דנה לוי: every week, Thursday 12:30, classic ----
    const rec = await db.query(
      `insert into recurring_appointments (client_id, service_id, weekday, start_time, interval_weeks)
       values ($1,$2,4,'12:30',1)
       returning id`,
      [clientId['0507654321'], classic],
    );
    const recurringId = rec.rows[0].id;
    await db.query(
      `update appointments set recurring_id = $1
       where client_id = $2 and starts_at = $3::timestamptz`,
      [recurringId, clientId['0507654321'], ts(D.thu, '12:30')],
    );
    for (const d of [D.thuPlus1w, D.thuPlus2w, D.thuPlus3w]) {
      await db.query(
        `insert into appointments (client_id, service_id, starts_at, ends_at, status, payment_method, recurring_id, note)
         values ($1,$2,$3::timestamptz, $3::timestamptz + interval '30 minutes', 'booked', 'credit', $4, $5)`,
        [clientId['0507654321'], classic, ts(d, '12:30'), recurringId, 'דמו cashOrCredit (קבוע)'],
      );
    }

    // ---- persist each demo client's "last appointment" date (deterministic on re-run) ----
    const lastApptClientIds = demoClientIds.concat(admin ? [admin.id] : []);
    await db.query(
      `update clients c
       set last_appointment_at = (
         select max(a.starts_at) from appointments a where a.client_id = c.id
       )
       where c.id = any($1::uuid[])`,
      [lastApptClientIds],
    );

    // ---- a blocked slot today 14:00–15:00 ----
    await db.query(
      `insert into blocked_times (starts_at, ends_at, reason, members_only)
       values ($1::timestamptz, $2::timestamptz, 'הפסקת צהריים (דמו)', false)`,
      [ts(D.wed, '14:00'), ts(D.wed, '15:00')],
    );

    // ---- waiting list rows for a full day ----
    await db.query(
      `insert into waiting_list (client_id, client_name, phone, service_id, desired_date, desired_time, status, is_club_member)
       values
        ($1,'רון ברק','0509998888',$3,$5,'11:00','waiting',true),
        ($2,'מאיה שרון','0504445555',$4,$5,'13:00','waiting',false)`,
      [clientId['0509998888'], clientId['0504445555'], classic, soldiers, D.thu],
    );

    // ---- OTP: allow logging in from the UI with code 1111 for every demo phone ----
    const hashOtp = (code) => crypto.createHmac('sha256', JWT_SECRET).update(code).digest('hex');
    const otpValue = JSON.stringify({
      hashed: hashOtp(DEMO_OTP),
      expiresAt: '2099-01-01T00:00:00.000Z',
      attempts: 0,
    });
    const otpPhones = CLIENTS.map((c) => c.phone).concat(['0537002171', '0500000000']);
    for (const p of otpPhones) {
      await db.query(
        `insert into settings (key, value) values ($1, $2::jsonb)
         on conflict (key) do update set value = excluded.value`,
        [`otp:${p}`, otpValue],
      );
    }

    await db.query('COMMIT');

    // ---- mint ready-to-use JWTs (30d) ----
    const mkToken = (row, phone, roles) =>
      jwt.sign(
        {
          sub: row.id,
          phone,
          firstName: row.first_name,
          lastName: row.last_name,
          roles,
          isAdmin: roles.includes('admin'),
        },
        JWT_SECRET,
        { expiresIn: '30d' },
      );

    const mkClientBlob = (row, phone, isAdmin, isMember) =>
      JSON.stringify({
        phone,
        firstName: row.first_name,
        lastName: row.last_name,
        first_name: row.first_name,
        last_name: row.last_name,
        isMember: !!isMember,
        is_member: !!isMember,
        isAdmin: !!isAdmin,
        is_admin: !!isAdmin,
        client_name: `${row.first_name} ${row.last_name}`.trim(),
        name: `${row.first_name} ${row.last_name}`.trim(),
      });

    const yossi = { id: clientId['0501234567'], first_name: 'יוסי', last_name: 'כהן' };
    const dana = { id: clientId['0507654321'], first_name: 'דנה', last_name: 'לוי' };

    const sessions = {
      admin: {
        label: `אדמין – ${admin.first_name} ${admin.last_name} (0537002171)`,
        token: mkToken(admin, '0537002171', ['admin', 'client']),
        client: mkClientBlob(admin, '0537002171', true, true),
      },
      'לקוח רגיל': {
        label: 'לקוח רגיל – יוסי כהן (0501234567)',
        token: mkToken(yossi, '0501234567', ['client']),
        client: mkClientBlob(yossi, '0501234567', false, false),
      },
      'חבר מועדון': {
        label: 'חבר מועדון – דנה לוי (0507654321)',
        token: mkToken(dana, '0507654321', ['client']),
        client: mkClientBlob(dana, '0507654321', false, true),
      },
    };

    console.log('\n✅ Demo data seeded around week', D.sun, '→', D.fri, '\n');
    console.log('Login option A – code 1111 in the login modal for any of these phones:');
    console.log('   0501234567 יוסי כהן (רגיל) | 0507654321 דנה לוי (חבר מועדון) | 0508887777 אבי ישראלי');
    console.log('   0509998888 רון ברק (חבר מועדון) | 0504445555 מאיה שרון | 0506667777 גיא חסום (חסום!) ');
    console.log('   0537002171 אדמין');
    console.log('   (note: requesting a *new* code from the UI overrides 1111 — re-run this script to restore it)\n');
    console.log('Login option B – paste one of these snippets in the browser DevTools console at http://localhost:5173 :\n');
    for (const key of Object.keys(sessions)) {
      const s = sessions[key];
      console.log(`/* ${s.label} */`);
      console.log(
        `localStorage.setItem('familiaAuthToken', ${JSON.stringify(s.token)});\n` +
          `localStorage.setItem('familiaClient', ${JSON.stringify(s.client)});\n` +
          `localStorage.setItem('familia_client', ${JSON.stringify(s.client)});\n` +
          `location.href='/';`,
      );
      console.log('');
    }
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
