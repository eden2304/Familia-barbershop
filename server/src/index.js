// server/src/index.js
// Minimal API with Postgres; tolerant migrations for existing DBs (camelCase/snake_case + missing cols).

require('dotenv').config();
const crypto = require('crypto');

const http = require('http');
const { Pool } = require('pg');
const { URL } = require('url');
const fs = require('fs');
const fsp = fs.promises;
const pathLib = require('path');
const Busboy = require('busboy');

const UPLOAD_DIR = pathLib.resolve(__dirname, '..', 'uploads');

const ADMIN_PANEL_CODE = process.env.ADMIN_PANEL_CODE || '12345';
const AUTH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ימים
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 שעות (אפשר לשנות)
const adminSessions = new Map(); // token -> expiresAt

function issueAdminToken() {
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
    return token;
}

function isValidAdminToken(token) {
    if (!token) return false;
    const exp = adminSessions.get(token);
    if (!exp) return false;
    if (Date.now() > exp) {
        adminSessions.delete(token);
        return false;
    }
    return true;
}

function getBearerToken(req) {
    const h = String(req.headers['authorization'] || '');
    if (!h.toLowerCase().startsWith('bearer ')) return '';
    return h.slice(7).trim();
}

function normalizePhone(raw = "") {
    const d = String(raw).replace(/\D/g, "");
    // תמיכה בשני פורמטים נפוצים בארץ: 05… או 9725…
    if (d.startsWith("972") && d.length >= 11) return "0" + d.slice(3);
    if (d.startsWith("0")) return d;
    return d; // fallback
}
let adminPhonesCache = { phones: [], expiresAt: 0 };

async function getAdminPhones() {
    const now = Date.now();
    if (adminPhonesCache.expiresAt > now) return adminPhonesCache.phones;
    try {
        const q = await pool.query(`select phone from admin_phones`);
        const phones = (q.rows || [])
            .map((row) => normalizePhone(row?.phone || ''))
            .filter(Boolean);
        adminPhonesCache = { phones, expiresAt: now + 60_000 };
        return phones;
    } catch (error) {
        console.error('Failed loading admin phones from DB', error);
        adminPhonesCache = { phones: [], expiresAt: now + 10_000 };
        return [];
    }
}

async function isAdminPhone(phone) {
    const adminPhones = await getAdminPhones();
    return adminPhones.includes(normalizePhone(phone));
}

function encodeBase64Url(value) {
    return Buffer.from(String(value) || '', 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function issueDevToken(payload) {
    try {
        const data = JSON.stringify(payload || {});
        return `familia-dev.${encodeBase64Url(data)}`;
    } catch {
        return 'familia-dev-token';
    }
}

async function buildClientAuthPayload(row) {
    const client = {
        id: row.id,
        phone: row.phone,
        firstName: row.first_name || row.firstName || '',
        lastName: row.last_name || row.lastName || '',
        first_name: row.first_name || row.firstName || '',
        last_name: row.last_name || row.lastName || '',
        isAdmin: await isAdminPhone(row.phone),
    };
    const roles = client.isAdmin ? ['client', 'admin'] : ['client'];
    const tokenPayload = {
        sub: client.id,
        phone: normalizePhone(client.phone),
        roles,
        isAdmin: client.isAdmin,
        iat: Math.floor(Date.now() / 1000),
    };
    const token = issueDevToken(tokenPayload);
    const expiresAt = new Date(Date.now() + AUTH_TOKEN_TTL_MS).toISOString();
    return {
        ok: true,
        client,
        user: client,
        roles,
        token,
        expiresAt,
    };
}

function getHeaderPhone(req) {
    return req.headers['x-client-phone'] || req.headers['x-clientphone'] || req.headers['x-client'] || '';
}

async function ensureUploadsDir() {
    try { await fsp.mkdir(UPLOAD_DIR, { recursive: true }); } catch {}
}

/* ---------- ENV ---------- */
const PORT = Number(process.env.PORT || 3001);

// Prefer single DATABASE_URL; fallback to PG* vars
const DATABASE_URL =
    process.env.DATABASE_URL ||
    `postgres://${process.env.PGUSER || ''}${process.env.PGPASSWORD ? ':' + process.env.PGPASSWORD : ''}${process.env.PGUSER ? '@' : ''}${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'familia'}`;

const pool = new Pool({ connectionString: DATABASE_URL, keepAlive: true });

/* ---------- Helpers (DB) ---------- */
async function tableHasColumn(table, column) {
    const q = await pool.query(
        `select exists(
            select 1 from information_schema.columns
            where table_schema = current_schema()
              and table_name = $1
              and column_name = $2
        ) as exists`,
        [table, column]
    );
    return !!q.rows[0]?.exists;
}

async function ensureColumn(table, column, pgType) {
    const has = await tableHasColumn(table, column);
    if (has) return;
    await pool.query(`alter table ${table} add column ${column} ${pgType}`);
}

async function ensureSnakeFromCamel(table, snake, camel, pgType) {
    const hasSnake = await tableHasColumn(table, snake);
    if (hasSnake) return true;

    const hasCamel = await tableHasColumn(table, camel);

    // אם יש camel: נוסיף snake ונעתיק ממנו
    if (hasCamel) {
        await pool.query(`alter table ${table} add column ${snake} ${pgType}`);
        await pool.query(`update ${table} set ${snake} = ${camel} where ${snake} is null`);
        return true;
    }

    // אם אין camel: רק נוסיף snake
    await pool.query(`alter table ${table} add column ${snake} ${pgType}`);
    return true;
}

async function createIndexIfColumnExists(table, column, indexName) {
    const has = await tableHasColumn(table, column);
    if (!has) return;
    await pool.query(`create index if not exists ${indexName} on ${table} (${column})`);
}

async function getColumnUdtName(table, column) {
    const q = await pool.query(
        `select udt_name
         from information_schema.columns
         where table_schema = current_schema()
           and table_name = $1
           and column_name = $2
         limit 1`,
        [table, column]
    );
    return q.rows[0]?.udt_name || null; // e.g. 'uuid', 'int4', 'int8'
}

function udtToDDL(udt) {
    if (!udt) return 'int';
    if (udt === 'uuid') return 'uuid';
    if (udt === 'int8') return 'bigint';
    return 'int';
}

/* ---------- Migrate (idempotent & forgiving) ---------- */
async function migrate() {
    // --- טבלאות בסיס ---
    await pool.query(`
        create table if not exists services (
                                                id serial primary key,
                                                name text not null,
                                                duration_minutes int not null default 30,
                                                price numeric,
                                                order_index int default 0,
                                                is_active boolean not null default true
        );

        create table if not exists clients (
                                               id serial primary key,
                                               first_name text not null default '',
                                               last_name  text not null default '',
                                               phone      text not null unique
        );

        create table if not exists appointments (
                                                    id serial primary key,
                                                    service_id int references services(id) on delete set null,
            client_id  int references clients(id)  on delete cascade,
            starts_at  timestamptz not null,
            ends_at    timestamptz not null,
            status     text not null default 'booked',
            note       text
            );

        create table if not exists blocked_times (
                                                     id serial primary key,
                                                     start_at timestamptz,
                                                     end_at   timestamptz,
                                                     reason   text
        );

        create table if not exists products (
                                                id serial primary key,
                                                name text not null,
                                                price numeric,
                                                image_url text,
                                                order_index int default 0,
                                                is_active boolean not null default true
        );

        create table if not exists testimonials (
                                                    id serial primary key,
                                                    author text not null,
                                                    rating int,
                                                    content text,
                                                    order_index int default 0,
                                                    is_active boolean not null default true
        );

        create table if not exists gallery_videos (
                                                      id serial primary key,
                                                      video_url text,
                                                      image_url text,
                                                      url text,
                                                      order_index int default 0,
                                                      is_active boolean not null default true
        );

        create table if not exists background_videos (
                                                         id serial primary key,
                                                         video_url text,
                                                         image_url text,
                                                         url text,
                                                         order_index int default 0,
                                                         is_active boolean not null default true
        );

        create table if not exists settings (
                                                id serial primary key,
                                                key text unique not null,
                                                value text
        );

        create table if not exists admin_phones (
                                                    id serial primary key,
                                                    phone text not null unique
        );

        create table if not exists waiting_list (
                                                    id serial primary key,
                                                    client_id integer references clients(id) on delete set null,
            client_name text not null,
            phone text not null,
            service_id integer references services(id) on delete set null,
            desired_starts_at timestamptz not null,
            status text not null default 'waiting',
            created_at timestamptz not null default now()
            );

    `);

// ---- detect id types of clients/services and recreate waiting_list accordingly ----
    const clientsIdUdt  = await getColumnUdtName('clients',  'id');   // uuid / int4 / int8
    const servicesIdUdt = await getColumnUdtName('services', 'id');   // uuid / int4 / int8

    const clientIdTypeDDL  = udtToDDL(clientsIdUdt  || 'int4');
    const serviceIdTypeDDL = udtToDDL(servicesIdUdt || 'int4');

// אם קיימת waiting_list עם טיפוסים לא מתאימים — נמחק וניצור מחדש (פשוט ובטוח)
  await pool.query(`drop table if exists waiting_list cascade`);

  await pool.query(`
  create table waiting_list (
    id serial primary key,
    client_id ${clientIdTypeDDL} references clients(id) on delete set null,
    client_name text not null default '',
    phone text not null,
    service_id ${serviceIdTypeDDL} references services(id) on delete set null,
    desired_starts_at timestamptz not null,
    status text not null default 'waiting', -- waiting | notified | booked | canceled
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists idx_waiting_list_status          on waiting_list (status);
  create index if not exists idx_waiting_list_desired_starts  on waiting_list (desired_starts_at);
  create index if not exists idx_waiting_list_service         on waiting_list (service_id);

  create or replace function touch_updated_at()
  returns trigger as $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$ language plpgsql;

  create or replace trigger trg_waiting_list_touch
  before update on waiting_list
  for each row execute procedure touch_updated_at();
`);

  await pool.query(`
    create table if not exists business_hours (
      id serial primary key,
      weekday int not null unique,
      open varchar(5),
      close varchar(5),
      slot_interval_minutes int not null default 30
    );
  `);

  await pool.query(`
    drop table if exists recurring_appointments cascade;

    create table recurring_appointments (
      id serial primary key,
      client_id ${clientIdTypeDDL} not null references clients(id) on delete cascade,
      service_id ${serviceIdTypeDDL} not null references services(id) on delete cascade,
      weekday int not null,
      start_time varchar(8) not null,
      interval_weeks int not null default 1,
      created_at timestamptz not null default now()
    );
    create unique index if not exists ux_recurring_unique on recurring_appointments (client_id, service_id, weekday, start_time);
  `);


    // ----- שמירה על תאימות קיימת בשאר הטבלאות -----
    await ensureColumn('clients', 'is_member', 'boolean default false');
    await pool.query(`update clients set is_member = coalesce(is_member, false)`);
    await pool.query(`alter table clients alter column is_member set default false`);
    await pool.query(`alter table clients alter column is_member set not null`);

    await ensureColumn('appointments', 'recurring_id', 'int');

    await ensureSnakeFromCamel('products', 'image_url', 'imageUrl', 'text');
    await ensureSnakeFromCamel('gallery_videos', 'image_url', 'imageUrl', 'text');
    await ensureSnakeFromCamel('gallery_videos', 'video_url', 'videoUrl', 'text');
    await ensureColumn('gallery_videos', 'url', 'text');
    await ensureSnakeFromCamel('background_videos', 'image_url', 'imageUrl', 'text');
    await ensureSnakeFromCamel('background_videos', 'video_url', 'videoUrl', 'text');
    await ensureColumn('background_videos', 'url', 'text');

    // services: duration_minutes from legacy "duration"
    const hasDurMin = await tableHasColumn('services', 'duration_minutes');
    if (!hasDurMin) {
        await pool.query(`alter table services add column duration_minutes int`);
        const hasDuration = await tableHasColumn('services', 'duration');
        if (hasDuration) {
            await pool.query(`update services set duration_minutes = duration where duration_minutes is null`);
        }
        await pool.query(`alter table services alter column duration_minutes set default 30`);
    }

    // ----- unify blocked_times → start_at / end_at בלבד -----
    const hasStartSingular = await tableHasColumn('blocked_times', 'start_at');
    const hasEndSingular   = await tableHasColumn('blocked_times', 'end_at');
    const hasStartPlural   = await tableHasColumn('blocked_times', 'starts_at');
    const hasEndPlural     = await tableHasColumn('blocked_times', 'ends_at');

    if (!hasStartSingular) await pool.query(`alter table blocked_times add column start_at timestamptz`);
    if (!hasEndSingular)   await pool.query(`alter table blocked_times add column end_at   timestamptz`);

    if (hasStartPlural) await pool.query(`update blocked_times set start_at = coalesce(start_at, starts_at) where starts_at is not null`);
    if (hasEndPlural)   await pool.query(`update blocked_times set end_at   = coalesce(end_at,   ends_at)   where ends_at   is not null`);

    await pool.query(`delete from blocked_times where start_at is null or end_at is null`);
    await pool.query(`alter table blocked_times alter column start_at set not null`);
    await pool.query(`alter table blocked_times alter column end_at   set not null`);

    if (hasStartPlural) await pool.query(`alter table blocked_times drop column if exists starts_at`);
    if (hasEndPlural)   await pool.query(`alter table blocked_times drop column if exists ends_at`);

  await ensureColumn('blocked_times', 'members_only', 'boolean default false');
  await pool.query(`update blocked_times set members_only = coalesce(members_only, false)`);
  await pool.query(`alter table blocked_times alter column members_only set default false`);
  await pool.query(`alter table blocked_times alter column members_only set not null`);

  await ensureColumn('business_hours', 'slot_interval_minutes', 'int default 30');
  await pool.query(`alter table business_hours alter column slot_interval_minutes set default 30`);
  try { await pool.query(`alter table business_hours alter column open drop not null`); } catch {}
  try { await pool.query(`alter table business_hours alter column close drop not null`); } catch {}

  await pool.query(`create unique index if not exists ux_business_hours_weekday on business_hours (weekday)`);
  await ensureRecurringTable();
  await ensureBusinessHoursDefaults();

  // אינדקסים
  await createIndexIfColumnExists('appointments', 'starts_at', 'idx_appointments_starts_at');
  await createIndexIfColumnExists('appointments', 'client_id',  'idx_appointments_client');
  await createIndexIfColumnExists('blocked_times', 'start_at',  'idx_blocked_times_start_at');
}

/* ---------- HTTP helpers ---------- */
function json(res, code, data) {
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        // 👇 חשוב: להתיר את ההידרים שהדפדפן מבקש בפרה-פלייט
        'Access-Control-Allow-Headers': 'Content-Type, X-Client-Phone, x-client-phone, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
    });
    res.end(JSON.stringify(data ?? null));
}


function text(res, code, txt = '') {
    res.writeHead(code, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Client-Phone, x-client-phone, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
    });
    res.end(txt);
}


async function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => {
            const ct = (req.headers['content-type'] || '').toLowerCase();
            if (!data) return resolve({});
            try {
                if (ct.includes('application/json')) {
                    return resolve(JSON.parse(data));
                }
                if (ct.includes('application/x-www-form-urlencoded')) {
                    const out = {};
                    for (const [k, v] of new URLSearchParams(data)) out[k] = v;
                    return resolve(out);
                }
                // fallback: נסה JSON, ואם לא—החזר גלם
                try { return resolve(JSON.parse(data)); } catch {}
                resolve({ raw: data });
            } catch {
                resolve({});
            }
        });
    });
}

function toLocalDateTime(dateStr, timeStr) {
    return new Date(`${dateStr}T${timeStr}:00`);
}
function formatHHmm(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

function addMonthsSafe(date, months) {
    const base = new Date(date.getTime());
    const targetMonth = base.getMonth() + months;
    const targetDay = base.getDate();
    base.setDate(1);
    base.setMonth(targetMonth);
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    base.setDate(Math.min(targetDay, daysInMonth));
    return base;
}
const DEFAULT_HOURS = [
    { weekday: 0, open: '10:00', close: '19:00', slot: 30, slotIntervalMinutes: 30, isOpen: true },
    { weekday: 1, open: '10:00', close: '19:00', slot: 30, slotIntervalMinutes: 30, isOpen: true },
    { weekday: 2, open: '10:00', close: '19:00', slot: 30, slotIntervalMinutes: 30, isOpen: true },
    { weekday: 3, open: '10:00', close: '19:00', slot: 30, slotIntervalMinutes: 30, isOpen: true },
    { weekday: 4, open: '10:00', close: '19:00', slot: 30, slotIntervalMinutes: 30, isOpen: true },
    { weekday: 5, open: '08:00', close: '15:00', slot: 30, slotIntervalMinutes: 30, isOpen: true },
    { weekday: 6, open: null,     close: null,    slot: 30, slotIntervalMinutes: 30, isOpen: false },
];
const WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const MAX_RECURRING_OCCURRENCES = 60;

const BOOKING_RULE_DEFAULTS = {
    publicMaxAdvanceDays: 7,
    memberMaxAdvanceDays: 14,
    memberOnlyServiceIds: [],
    memberOnlyWindows: [],
};

function clampAdvanceDays(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const intVal = Math.floor(num);
    if (intVal < 0) return 0;
    if (intVal > 365) return 365;
    return intVal;
}

function normalizeRuleTime(value) {
    if (value === undefined || value === null) return null;
    const str = String(value).trim();
    const match = str.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    let h = Number(match[1]);
    let m = Number(match[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0) h = 0;
    if (h > 23) h = 23;
    if (m < 0) m = 0;
    if (m > 59) m = 59;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeMemberWindowsValue(candidate) {
    const windows = [];

    const pushWindow = (weekday, start, end) => {
        if (weekday === undefined || weekday === null) return;
        const day = Number(weekday);
        if (!Number.isInteger(day) || day < 0 || day > 6) return;
        const startNorm = normalizeRuleTime(start);
        const endNorm = normalizeRuleTime(end);
        if (!startNorm || !endNorm) return;
        const startMinutes = Number(startNorm.slice(0, 2)) * 60 + Number(startNorm.slice(3));
        const endMinutes = Number(endNorm.slice(0, 2)) * 60 + Number(endNorm.slice(3));
        if (endMinutes <= startMinutes) return;
        const key = `${day}|${startNorm}|${endNorm}`;
        if (windows.some((w) => w.key === key)) return;
        windows.push({ weekday: day, start: startNorm, end: endNorm, key });
    };

    const explore = (value, fallbackDay) => {
        if (!value) return;
        if (Array.isArray(value)) {
            value.forEach((entry) => explore(entry, fallbackDay));
            return;
        }
        if (typeof value === 'object') {
            const day = value.weekday ?? value.day ?? value.day_of_week ?? fallbackDay;
            const start = value.start ?? value.from ?? value.open ?? value.start_time ?? value.startTime;
            const end = value.end ?? value.to ?? value.close ?? value.end_time ?? value.endTime;
            if (day !== undefined || (start !== undefined && end !== undefined)) {
                pushWindow(day, start, end);
                return;
            }
            Object.entries(value).forEach(([maybeDay, nested]) => {
                const parsedDay = Number.isNaN(Number(maybeDay)) ? fallbackDay : Number(maybeDay);
                explore(nested, parsedDay);
            });
        }
    };

    explore(candidate, undefined);

    windows.sort((a, b) => {
        if (a.weekday !== b.weekday) return a.weekday - b.weekday;
        return a.start.localeCompare(b.start);
    });

    return windows.map((win) => ({ weekday: win.weekday, start: win.start, end: win.end }));
}

const sanitizeBusinessTime = (value) => normalizeRuleTime(value);

const timeToMinutes = (value) => {
    const norm = sanitizeBusinessTime(value);
    if (!norm) return null;
    const [h, m] = norm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

async function ensureBusinessHoursDefaults() {
    await pool.query(`create unique index if not exists ux_business_hours_weekday on business_hours (weekday)`);
    for (const row of DEFAULT_HOURS) {
        const slot = Number(row.slotIntervalMinutes ?? row.slot ?? 30) || 30;
        const openVal = row.isOpen ? row.open : null;
        const closeVal = row.isOpen ? row.close : null;
        await pool.query(
            `insert into business_hours (weekday, open, close, slot_interval_minutes)
             values ($1,$2,$3,$4)
             on conflict (weekday) do nothing`,
            [row.weekday, openVal, closeVal, slot]
        );
    }
    await pool.query(`update business_hours set slot_interval_minutes = 30 where slot_interval_minutes is null`);
}

async function getBusinessHours() {
    await ensureBusinessHoursDefaults();
    const q = await pool.query('select weekday, open, close, slot_interval_minutes from business_hours order by weekday');
    const byDay = new Map();
    for (const row of q.rows) {
        const weekday = Number(row.weekday);
        if (!Number.isInteger(weekday)) continue;
        const slot = Number(row.slot_interval_minutes ?? row.slot ?? 30) || 30;
        const open = sanitizeBusinessTime(row.open);
        const close = sanitizeBusinessTime(row.close);
        const isOpen = Boolean(open && close && open !== close);
        byDay.set(weekday, { weekday, open: open ?? null, close: close ?? null, slotIntervalMinutes: slot, isOpen });
    }
    const hours = [];
    for (let day = 0; day < 7; day += 1) {
        const fallback = DEFAULT_HOURS.find((h) => h.weekday === day) || { weekday: day, open: null, close: null, slotIntervalMinutes: 30, isOpen: false };
        const current = byDay.get(day) || fallback;
        const slot = Number(current.slotIntervalMinutes ?? current.slot ?? fallback.slotIntervalMinutes ?? fallback.slot ?? 30) || 30;
        const open = current.isOpen ? sanitizeBusinessTime(current.open ?? fallback.open) : null;
        const close = current.isOpen ? sanitizeBusinessTime(current.close ?? fallback.close) : null;
        const isOpen = current.isOpen ?? Boolean(open && close && open !== close);
        hours.push({
            weekday: day,
            open: isOpen ? open : null,
            close: isOpen ? close : null,
            slotIntervalMinutes: slot,
            isOpen,
        });
    }
    return hours;
}

function presentBusinessHours(hours) {
    return hours.map((row) => ({
        weekday: row.weekday,
        open: row.isOpen ? row.open : null,
        close: row.isOpen ? row.close : null,
        slotIntervalMinutes: row.slotIntervalMinutes,
        slot_interval_minutes: row.slotIntervalMinutes,
        slot: row.slotIntervalMinutes,
        isOpen: row.isOpen,
        is_open: row.isOpen,
        isClosed: !row.isOpen,
        is_closed: !row.isOpen,
        open_time: row.isOpen ? row.open : null,
        close_time: row.isOpen ? row.close : null,
    }));
}

let recurringTableEnsured = false;
async function ensureRecurringTable() {
    if (recurringTableEnsured) return;

    const clientsIdUdt = (await getColumnUdtName('clients', 'id')) || 'int4';
    const servicesIdUdt = (await getColumnUdtName('services', 'id')) || 'int4';
    const clientIdDDL = udtToDDL(clientsIdUdt);
    const serviceIdDDL = udtToDDL(servicesIdUdt);

    const columnsInfo = await pool.query(
        `select column_name, udt_name
         from information_schema.columns
         where table_schema = current_schema()
           and table_name = 'recurring_appointments'`
    );

    let needsRecreate = columnsInfo.rowCount === 0;
    if (!needsRecreate) {
        const clientCol = columnsInfo.rows.find((row) => row.column_name === 'client_id');
        const serviceCol = columnsInfo.rows.find((row) => row.column_name === 'service_id');
        if (!clientCol || clientCol.udt_name !== clientsIdUdt) needsRecreate = true;
        if (!serviceCol || serviceCol.udt_name !== servicesIdUdt) needsRecreate = true;
    }

    if (needsRecreate) {
        await pool.query(`drop table if exists recurring_appointments cascade`);
        await pool.query(`
            create table recurring_appointments (
                id serial primary key,
                client_id ${clientIdDDL} not null references clients(id) on delete cascade,
                service_id ${serviceIdDDL} not null references services(id) on delete cascade,
                weekday int not null,
                start_time varchar(8) not null,
                interval_weeks int not null default 1,
                interval_months int,
                day_of_month int,
                created_at timestamptz not null default now()
            )
        `);
    }

    await ensureColumn('recurring_appointments', 'interval_months', 'int');
    await ensureColumn('recurring_appointments', 'day_of_month', 'int');
    await pool.query(`drop index if exists ux_recurring_unique`);
    await pool.query(`
        create unique index if not exists ux_recurring_unique
            on recurring_appointments (client_id, service_id, coalesce(interval_months, 0), coalesce(day_of_month, weekday), start_time)
    `);
    recurringTableEnsured = true;
}

function normalizeBookingRulesValue(raw) {
    let source = raw;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); }
        catch { source = null; }
    }
    if (!source || typeof source !== 'object') {
        return { ...BOOKING_RULE_DEFAULTS };
    }

    const publicCandidate =
        source.publicMaxAdvanceDays ??
        source.public ??
        source.publicDays ??
        source.public_days ??
        source.regular ??
        source.nonMember ??
        source.non_member;
    const memberCandidate =
        source.memberMaxAdvanceDays ??
        source.member ??
        source.members ??
        source.memberDays ??
        source.member_days ??
        source.vip ??
        source.memberAdvanceDays ??
        source.member_advance_days;
    const listCandidate =
        source.memberOnlyServiceIds ??
        source.membersOnlyServiceIds ??
        source.memberServices ??
        source.member_services ??
        source.member_only_services ??
        source.members_only_services ??
        [];
    const windowCandidate =
        source.memberOnlyWindows ??
        source.member_only_windows ??
        source.memberWindows ??
        source.member_windows ??
        [];

    const publicMaxAdvanceDays = clampAdvanceDays(publicCandidate, BOOKING_RULE_DEFAULTS.publicMaxAdvanceDays);
    const memberMaxAdvanceDays = clampAdvanceDays(memberCandidate, BOOKING_RULE_DEFAULTS.memberMaxAdvanceDays);
    const ids = Array.isArray(listCandidate)
        ? Array.from(
            new Set(
                listCandidate
                    .map((value) => {
                        if (value === undefined || value === null) return null;
                        const str = String(value).trim();
                        return str.length > 0 ? str : null;
                    })
                    .filter(Boolean)
            )
        )
        : [];
    const windows = normalizeMemberWindowsValue(windowCandidate);

    return {
        publicMaxAdvanceDays,
        memberMaxAdvanceDays,
        memberOnlyServiceIds: ids,
        memberOnlyWindows: windows,
    };
}

async function loadBookingRules() {
    try {
        const q = await pool.query(`select value from settings where key=$1 limit 1`, ['booking.rules']);
        const raw = q.rows[0]?.value;
        return normalizeBookingRulesValue(raw);
    } catch (e) {
        console.warn('[booking.rules] load failed, using defaults', e);
        return { ...BOOKING_RULE_DEFAULTS };
    }
}

function dayBounds(dStr) {
    const d = new Date(dStr + 'T00:00:00');
    const start = new Date(d);
    const end = new Date(d);
    end.setDate(end.getDate() + 1);
    return { start, end };
}

function phoneDigitsPair(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (!d) return { p0: '', p972: '' };
    if (d.startsWith('972')) return { p0: '0' + d.slice(3), p972: d };
    if (d.startsWith('0'))   return { p0: d,                p972: '972' + d.slice(1) };
    if (d.startsWith('5'))   return { p0: '0' + d,          p972: '972' + d };
    return { p0: d, p972: d };
}

/* ---- ID helpers: handle numeric and string IDs safely ---- */
function parseId(raw) {
    const s = String(raw || '');
    const n = Number(s);
    return { raw: s, isNum: Number.isFinite(n), num: n };
}

// Where clause builder: returns { sql, param } for id column
function idWhere(tableAlias, idParsed) {
    if (idParsed.isNum) {
        return { sql: `${tableAlias}.id = $1`, param: idParsed.num };
    }
    // אם העמודה היא int (serial), cast לטקסט עדיין יעבוד להשוואה רק אם מגיע מספר כמחרוזת.
    // אבל אם מגיע UUID ואין כזה בטבלה — זה יחזיר 0 שורות (תקין).
    return { sql: `CAST(${tableAlias}.id AS text) = $1`, param: idParsed.raw };
}

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const norm = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(norm)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(norm)) return false;
    return fallback;
}

// helper: מקבל מחרוזת תאריך ושעה בכמה פורמטים אפשריים
function parseAnyDate(x) {
    if (!x) return new Date('invalid');
    const s = String(x).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([.+-]\d{2}:\d{2}|Z)?$/.test(s)) {
        return new Date(s);
    }
    const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
    if (m) {
        const d = new Date(m[1] + 'T00:00:00');
        d.setHours(Number(m[2]), Number(m[3]), 0, 0);
        return d;
    }
    return new Date(s);
}


/* ---------- Router ---------- */
async function router(req, res) {
    if (req.method === 'OPTIONS') return text(res, 204, '');

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

// --- Admin Guard: מחייב accessToken לכל /admin/* (חוץ מ-verify-code) ---
    if (pathname.startsWith('/admin/') && pathname !== '/admin/verify-code') {
        const token = getBearerToken(req);
        if (!isValidAdminToken(token)) {
            return json(res, 403, { error: 'Unauthorized (admin only)' });
        }
        // אם עברנו, מותר להמשיך ל-handlers של /admin/...
    }


    // POST /admin/verify-code  (דורש אדמין לפי ה-Guard + קוד נכון)
    if (pathname === '/admin/verify-code' && req.method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const code = (body && (body.code || body.adminCode || body.pin)) || '';

        if (String(code) === String(ADMIN_PANEL_CODE)) {
            const accessToken = issueAdminToken();
            return json(res, 200, { ok: true, accessToken });
        }

        return json(res, 401, { ok: false, error: 'INVALID_ADMIN_CODE' });
    }

    if (req.method === 'GET' && pathname === '/admin/admin-phones') {
        const phones = await getAdminPhones();
        return json(res, 200, phones.map((phone) => ({ phone })));
    }



    if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
        const rel = pathname.replace(/^\/uploads\//, '');
        const abs = pathLib.resolve(UPLOAD_DIR, rel);

        if (!abs.startsWith(UPLOAD_DIR + pathLib.sep)) return json(res, 403, { error: 'Forbidden' });

        try {
            const stat = await fsp.stat(abs);
            if (!stat.isFile()) return json(res, 404, { error: 'Not Found' });

            const ext = (rel.split('.').pop() || '').toLowerCase();
            const mime =
                ext === 'mp4'  ? 'video/mp4' :
                    ext === 'webm' ? 'video/webm' :
                        ext === 'png'  ? 'image/png' :
                            ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                                ext === 'gif'  ? 'image/gif' :
                                    'application/octet-stream';

            res.writeHead(200, {
                'Content-Type': mime,
                'Content-Length': stat.size,
                'Access-Control-Allow-Origin': '*',
            });
            fs.createReadStream(abs).pipe(res);
        } catch {
            return json(res, 404, { error: 'Not Found' });
        }
        return;
    }

    if (req.method === 'POST' && pathname === '/admin/upload') {
        const ct = req.headers['content-type'] || '';
        if (!ct.includes('multipart/form-data')) {
            return json(res, 400, { error: 'Expected multipart/form-data' });
        }

        // שים לב: בלי "new"
        const bb = Busboy({ headers: req.headers, limits: { fileSize: 1024 * 1024 * 1024 } });

        let hadFile = false;
        let savedFile = null;
        let savedSize = 0;
        let savedMime = '';

        bb.on('file', (fieldname, file, info = {}) => {
            hadFile = true;
            const { filename = '', mimeType = 'application/octet-stream' } = info;
            savedMime = mimeType;

            const ext =
                filename && filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
                    : mimeType === 'video/mp4'  ? 'mp4'
                        : mimeType === 'video/webm' ? 'webm'
                            : mimeType === 'image/png'  ? 'png'
                                : mimeType === 'image/jpeg' ? 'jpg'
                                    : 'bin';

            const base = Date.now() + '_' + Math.random().toString(36).slice(2);
            const safeName = `${base}.${ext}`;
            const destPath = pathLib.join(UPLOAD_DIR, safeName);

            console.log('[upload] field:', fieldname, 'filename:', filename, 'mime:', mimeType, '->', safeName);

            const ws = fs.createWriteStream(destPath);

            file.on('data', (d) => { savedSize += d.length; });
            file.on('end', () => { savedFile = safeName; });
            file.on('limit', () => {
                console.error('[upload] file size limit reached');
                ws.destroy();
                try { fs.unlinkSync(destPath); } catch {}
            });
            file.on('error', (e) => {
                console.error('[upload file stream error]', e);
                ws.destroy();
                try { fs.unlinkSync(destPath); } catch {}
            });

            ws.on('error', (e) => {
                console.error('[upload write error]', e);
                try { fs.unlinkSync(destPath); } catch {}
            });

            file.pipe(ws);
        });

        bb.on('field', (name, val) => {
            // לא חובה, אבל נחמד לדיבוג
            console.log('[upload] field only:', name, val?.toString?.().slice(0,64));
        });

        bb.on('close', () => {
            console.log('[upload] close. hadFile=', hadFile, 'savedFile=', savedFile, 'size=', savedSize);
            if (!hadFile || !savedFile) return json(res, 400, { error: 'No file uploaded' });
            return json(res, 200, { ok: true, url: `/uploads/${savedFile}`, size: savedSize, mime: savedMime });
        });

        bb.on('error', (e) => {
            console.error('[busboy error]', e);
            return json(res, 500, { error: 'Upload parse failed' });
        });

        req.pipe(bb);
        return;
    }


// === GLOBAL DELETE for admin entities (runs first!) ===
    if (req.method === 'DELETE') {
        const m = pathname.match(/^\/admin\/(products|testimonials|gallery-videos|background-videos|services)\/([^\/]+)$/);
        if (m) {
            const entity = m[1];
            const idStr = m[2];
            const parsed = parseId(idStr);
            if (!parsed.raw) return json(res, 400, { error: 'Missing id' });

            const table =
                entity === 'products'           ? 'products' :
                    entity === 'testimonials'       ? 'testimonials' :
                        entity === 'gallery-videos'     ? 'gallery_videos' :
                            entity === 'background-videos'  ? 'background_videos' :
                                entity === 'services'           ? 'services' : null;

            if (!table) return json(res, 400, { error: 'Invalid entity' });

            const where = idWhere(table, parsed);
            await pool.query(`delete from ${table} where ${where.sql}`, [where.param]);

            return json(res, 200, { ok: true });
        }
    }

    // === GLOBAL PUT CATCH-ALL for admin entities (optional safety) ===
    if (req.method === 'PUT') {
        const m = pathname.match(/^\/admin\/(products|testimonials|gallery-videos|background-videos|services)\/([^\/]+)$/);
        if (m) {
            const entity = m[1];
            const idStr = m[2];
            const parsed = parseId(idStr);
            if (!parsed.raw) return json(res, 400, { error: 'Missing id' });

            const table =
                entity === 'products' ? 'products' :
                    entity === 'testimonials' ? 'testimonials' :
                        entity === 'gallery-videos' ? 'gallery_videos' :
                            entity === 'background-videos' ? 'background_videos' :
                                entity === 'services' ? 'services' : null;

            if (!table) return json(res, 400, { error: 'Invalid entity' });

            const body = await readBody(req) || {};
            // מיפוי ערכים לפי טבלה
            let sql = `update ${table} set `;
            const vals = [null]; // מקום ל-param של WHERE (נמלא אחרי שנבנה WHERE)
            const sets = [];

            function set(col, val) {
                sets.push(`${col} = coalesce($${vals.length + 1}, ${col})`);
                vals.push(val);
            }
            function n(v, d=null) { const num = Number(v); return Number.isFinite(num) ? num : d; }
            function b(v) { return (v===undefined||v===null) ? null : !!v; }
            function s(v) { return (v===undefined||v===null) ? null : String(v); }

            if (table === 'products') {
                set('name', s(body.name));
                set('price', n(body.price, null));
                set('image_url', s(body.imageUrl ?? body.image_url));
                set('order_index', n(body.orderIndex ?? body.order_index, 0));
                set('is_active', b(body.isActive ?? body.is_active));
            } else if (table === 'testimonials') {
                set('author', s(body.author));
                set('rating', n(body.rating, null));
                set('content', s(body.content));
                set('order_index', n(body.orderIndex ?? body.order_index, 0));
                set('is_active', b(body.isActive ?? body.is_active));
            } else if (table === 'gallery_videos') {
                set('image_url', s(body.imageUrl ?? body.image_url));
                set('video_url', s(body.videoUrl ?? body.video_url ?? body.url));
                set('url',       s(body.url ?? body.videoUrl ?? body.video_url));
                set('order_index', n(body.orderIndex ?? body.order_index, 0));
                set('is_active', b(body.isActive ?? body.is_active));
            } else if (table === 'background_videos') {
                set('image_url', s(body.imageUrl ?? body.image_url));
                set('video_url', s(body.videoUrl ?? body.video_url ?? body.url));
                set('url',       s(body.url ?? body.videoUrl ?? body.video_url));
                set('order_index', n(body.orderIndex ?? body.order_index, 0));
                set('is_active', b(body.isActive ?? body.is_active));
            } else if (table === 'services') {
                set('name', s(body.name));
                set('duration_minutes', n(body.durationMinutes ?? body.duration, 30));
                set('price', n(body.price, null));
                set('order_index', n(body.orderIndex ?? body.order_index, 0));
                set('is_active', b(body.isActive ?? body.is_active));
            }

            sql += sets.join(', ') + ' where ';
            const where = idWhere(table, parsed);
            sql += where.sql;
            vals[0] = where.param;

            await pool.query(sql, vals);

            const q = await pool.query(`select * from ${table} where ${where.sql}`, [where.param]);
            return json(res, 200, q.rows[0] || null);
        }
    }

    // Health
    if (req.method === 'GET' && pathname === '/') {
        return json(res, 200, { ok: true, name: 'familia-api', now: new Date().toISOString() });
    }

    /* ---- PUBLIC LISTS ---- */
    if (req.method === 'GET' && pathname === '/products') {
        const q = await pool.query(`select id, name, price, image_url, order_index, is_active from products where coalesce(is_active,true)=true order by order_index, id`);
        return json(res, 200, q.rows);
    }
    if (req.method === 'GET' && pathname === '/testimonials') {
        const q = await pool.query(`select id, author, rating, content, order_index, is_active from testimonials where coalesce(is_active,true)=true order by order_index, id`);
        const rows = q.rows.map(r => ({ ...r, text: r.content })); // ← alias
        return json(res, 200, rows);
    }

    if (req.method === 'GET' && pathname === '/gallery-videos') {
        const q = await pool.query(`select id,
                                           coalesce(image_url, video_url) as image_url,
                                           video_url,
                                           url,
                                           order_index, is_active
                                    from gallery_videos
                                    where coalesce(is_active,true)=true
                                    order by order_index, id`);
        return json(res, 200, q.rows);
    }
    if (req.method === 'GET' && pathname === '/background-videos') {
        const q = await pool.query(`select id,
                                           coalesce(image_url, video_url) as image_url,
                                           video_url,
                                           url,
                                           order_index, is_active
                                    from background_videos
                                    where coalesce(is_active,true)=true
                                    order by order_index, id`);
        return json(res, 200, q.rows);
    }
    if (req.method === 'GET' && pathname === '/services') {
        const q = await pool.query(`select id, name, duration_minutes as "durationMinutes", price, order_index as "orderIndex", is_active as "isActive" from services where coalesce(is_active,true)=true order by order_index, id`);
        const rows = q.rows.map(r => ({ ...r,
            duration: r.durationMinutes,
            duration_minutes: r.durationMinutes,
            order_index: r.orderIndex,
            is_active: r.isActive,
        }));
        return json(res, 200, rows);
    }

    if (req.method === 'GET' && (pathname === '/business-hours' || pathname === '/admin/business-hours')) {
        try {
            const hours = await getBusinessHours();
            return json(res, 200, presentBusinessHours(hours));
        } catch (error) {
            console.error('Failed to load business hours', error);
            return json(res, 500, { error: 'FAILED_TO_LOAD_BUSINESS_HOURS' });
        }
    }

    if (req.method === 'PUT' && pathname === '/admin/business-hours') {
        const body = await readBody(req).catch(() => ({}));
        const candidate = Array.isArray(body?.hours)
            ? body.hours
            : Array.isArray(body)
                ? body
                : Array.isArray(body?.data)
                    ? body.data
                    : [];

        const normalizedByDay = new Map();
        for (const row of candidate) {
            if (!row) continue;
            const weekdayRaw = row.weekday ?? row.day ?? row.day_of_week ?? row.dayOfWeek;
            const weekday = Number(weekdayRaw);
            if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
            const slot = Number(row.slotIntervalMinutes ?? row.slot_interval_minutes ?? row.slot ?? row.slotMinutes ?? row.interval ?? 30) || 30;
            const openCandidate = sanitizeBusinessTime(row.open ?? row.open_time ?? row.openTime);
            const closeCandidate = sanitizeBusinessTime(row.close ?? row.close_time ?? row.closeTime);
            const isOpenFlag = row.isOpen ?? row.is_open ?? (row.isClosed !== undefined ? !row.isClosed : undefined);
            const entry = {
                weekday,
                open: openCandidate,
                close: closeCandidate,
                slotIntervalMinutes: slot,
                explicitIsOpen: isOpenFlag,
            };
            normalizedByDay.set(weekday, entry);
        }

        const rowsToPersist = [];
        for (let day = 0; day < 7; day += 1) {
            const candidateRow = normalizedByDay.get(day) || null;
            const fallback = DEFAULT_HOURS.find((h) => h.weekday === day) || { open: null, close: null, slotIntervalMinutes: 30, isOpen: false };
            const slot = Number(candidateRow?.slotIntervalMinutes ?? fallback.slotIntervalMinutes ?? fallback.slot ?? 30) || 30;
            const resolvedIsOpen = candidateRow?.explicitIsOpen !== undefined
                ? Boolean(candidateRow.explicitIsOpen)
                : Boolean(candidateRow?.open && candidateRow?.close && candidateRow.open !== candidateRow.close);
            const open = resolvedIsOpen ? sanitizeBusinessTime(candidateRow?.open ?? fallback.open) : null;
            const close = resolvedIsOpen ? sanitizeBusinessTime(candidateRow?.close ?? fallback.close) : null;

            if (resolvedIsOpen) {
                const openMin = timeToMinutes(open);
                const closeMin = timeToMinutes(close);
                if (openMin == null || closeMin == null) {
                    return json(res, 400, { error: 'INVALID_HOUR_VALUE', message: `אנא הזינו שעות תקינות עבור ${WEEKDAY_LABELS[day]}.` });
                }
                if (closeMin <= openMin) {
                    return json(res, 400, { error: 'INVALID_HOUR_RANGE', message: `שעת הסגירה חייבת להיות מאוחרת משעת הפתיחה עבור ${WEEKDAY_LABELS[day]}.` });
                }
            }

            rowsToPersist.push({
                weekday: day,
                open: resolvedIsOpen ? open : null,
                close: resolvedIsOpen ? close : null,
                slotIntervalMinutes: slot,
                isOpen: resolvedIsOpen,
            });
        }

        await ensureBusinessHoursDefaults();
        await pool.query('begin');
        try {
            for (const row of rowsToPersist) {
                await pool.query(
                    `insert into business_hours (weekday, open, close, slot_interval_minutes)
                     values ($1,$2,$3,$4)
                     on conflict (weekday) do update set
                        open = excluded.open,
                        close = excluded.close,
                        slot_interval_minutes = excluded.slot_interval_minutes`,
                    [row.weekday, row.open, row.close, row.slotIntervalMinutes]
                );
            }
            await pool.query('commit');
        } catch (error) {
            await pool.query('rollback');
            console.error('Failed to save business hours', error);
            return json(res, 500, { error: 'FAILED_TO_SAVE_BUSINESS_HOURS' });
        }

        const fresh = await getBusinessHours();
        return json(res, 200, presentBusinessHours(fresh));
    }

    // GET /clients – כל הלקוחות + תאריך תור אחרון
    if (req.method === 'GET' && pathname === '/clients') {
        await ensureRecurringTable();
        const q = await pool.query(`
          select c.id,
                 c.first_name,
                 c.last_name,
                 c.phone,
                 coalesce(c.is_member,false) as is_member,
                 (select max(a.starts_at) from appointments a where a.client_id = c.id) as last_appointment_at,
                 coalesce(json_agg(
                     json_build_object(
                       'id', r.id,
                       'weekday', r.weekday,
                       'start_time', r.start_time,
                       'interval_weeks', r.interval_weeks,
                       'interval_months', r.interval_months,
                       'day_of_month', r.day_of_month,
                       'service_id', r.service_id,
                       'service_name', s.name
                     )
                 ) filter (where r.id is not null), '[]') as recurring
          from clients c
          left join recurring_appointments r on r.client_id = c.id
          left join services s on s.id = r.service_id
          group by c.id
          order by c.id desc
           `);
        const adminPhoneSet = new Set((await getAdminPhones()).map(normalizePhone));
        const rows = q.rows.map(r => {
            const adminFlag = adminPhoneSet.has(normalizePhone(r.phone || ''));
            return {
                id: r.id,
                first_name: r.first_name || '',
                last_name:  r.last_name  || '',
                phone:      r.phone      || '',
                firstName:  r.first_name || '',
                lastName:   r.last_name  || '',
                is_member:  !!r.is_member,
                isMember:   !!r.is_member,
                is_admin: adminFlag,
                isAdmin: adminFlag,
                lastAppointmentAt: r.last_appointment_at || null,
                recurringAppointments: Array.isArray(r.recurring) ? r.recurring : [],
                recurring_appointments: Array.isArray(r.recurring) ? r.recurring : [],
            };
        });
        return json(res, 200, rows);
    }

    if (req.method === 'GET' && pathname === '/clients/lookup') {
        const rawPhone = url.searchParams.get('phone') ?? url.searchParams.get('q') ?? '';
        const { p0, p972 } = phoneDigitsPair(rawPhone);
        if (!p0 && !p972) return json(res, 200, null);
        const q = await pool.query(`
            select id, first_name, last_name, phone, coalesce(is_member,false) as is_member
            from clients
            where regexp_replace(phone, '\\D', '', 'g') in ($1, $2)
            limit 1
        `, [p0 || '', p972 || p0 || '']);
        const row = q.rows[0];
        if (!row) return json(res, 200, null);
        return json(res, 200, {
            id: row.id,
            first_name: row.first_name || '',
            last_name: row.last_name || '',
            phone: row.phone || '',
            firstName: row.first_name || '',
            lastName: row.last_name || '',
            is_member: !!row.is_member,
            isMember: !!row.is_member,
        });
    }

    if (req.method === 'POST' && pathname === '/clients') {
        const body = await readBody(req) || {};
        const firstName = body.first_name ?? body.firstName ?? '';
        const lastName  = body.last_name  ?? body.lastName  ?? '';
        const rawPhone  = body.phone ?? body.client_phone ?? '';
        const phone = normalizePhone(rawPhone);
        if (!phone) return json(res, 400, { error: 'PHONE_REQUIRED' });

        const exists = await pool.query(`select id from clients where phone = $1 limit 1`, [phone]);
        if (exists.rows[0]?.id) {
            return json(res, 409, { error: 'PHONE_EXISTS' });
        }

        const isMember = parseBoolean(body.is_member ?? body.isMember, false);
        const ins = await pool.query(
            `insert into clients (first_name, last_name, phone, is_member) values ($1,$2,$3,$4)
             returning id, first_name, last_name, phone, coalesce(is_member,false) as is_member`,
            [String(firstName || ''), String(lastName || ''), phone, isMember]
        );
        const r = ins.rows[0];
        return json(res, 200, {
            id: r.id,
            first_name: r.first_name || '',
            last_name: r.last_name || '',
            phone: r.phone || '',
            firstName: r.first_name || '',
            lastName: r.last_name || '',
            is_member: !!r.is_member,
            isMember: !!r.is_member,
        });
    }

    if (req.method === 'PUT' && pathname.startsWith('/clients/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });

        const body = await readBody(req) || {};

        let where = idWhere('clients', parsed);
        let currentQ = await pool.query(
            `select id, first_name, last_name, phone, coalesce(is_member,false) as is_member from clients where ${where.sql}`,
            [where.param]
        );
        let current = currentQ.rows[0];

        if (!current) {
            const fallbackIdRaw = body.id ?? body.client_id ?? body.clientId ?? null;
            if (fallbackIdRaw) {
                const altParsed = parseId(fallbackIdRaw);
                if (altParsed.raw) {
                    const altWhere = idWhere('clients', altParsed);
                    const altQ = await pool.query(
                        `select id, first_name, last_name, phone, coalesce(is_member,false) as is_member from clients where ${altWhere.sql}`,
                        [altWhere.param]
                    );
                    current = altQ.rows[0];
                    if (current) {
                        where = idWhere('clients', parseId(current.id));
                    }
                }
            }
        }

        if (!current) {
            const rawPhone = body.phone ?? body.client_phone ?? body.clientPhone ?? null;
            if (rawPhone) {
                const { p0, p972 } = phoneDigitsPair(rawPhone);
                if (p0 || p972) {
                    const byPhone = await pool.query(
                        `select id, first_name, last_name, phone, coalesce(is_member,false) as is_member
                           from clients
                          where regexp_replace(phone, '\\D', '', 'g') in ($1,$2)
                          limit 1`,
                        [p0 || '', p972 || p0 || '']
                    );
                    current = byPhone.rows[0];
                    if (current) {
                        where = idWhere('clients', parseId(current.id));
                    }
                }
            }
        }

        if (!current) return json(res, 404, { error: 'CLIENT_NOT_FOUND' });

        const hasFirst = Object.prototype.hasOwnProperty.call(body, 'first_name') || Object.prototype.hasOwnProperty.call(body, 'firstName');
        const hasLast = Object.prototype.hasOwnProperty.call(body, 'last_name') || Object.prototype.hasOwnProperty.call(body, 'lastName');
        const hasPhone = Object.prototype.hasOwnProperty.call(body, 'phone') || Object.prototype.hasOwnProperty.call(body, 'client_phone');
        const hasMember = Object.prototype.hasOwnProperty.call(body, 'is_member') || Object.prototype.hasOwnProperty.call(body, 'isMember');

        const nextFirst = hasFirst ? String(body.first_name ?? body.firstName ?? '') : current.first_name;
        const nextLast  = hasLast  ? String(body.last_name  ?? body.lastName  ?? '') : current.last_name;

        let nextPhone = current.phone;
        if (hasPhone) {
            const candidate = normalizePhone(body.phone ?? body.client_phone ?? '');
            if (!candidate) return json(res, 400, { error: 'PHONE_REQUIRED' });
            nextPhone = candidate;
        }

        if (nextPhone !== current.phone) {
            const clash = await pool.query(`select id from clients where phone = $1 and id <> $2 limit 1`, [nextPhone, current.id]);
            if (clash.rows[0]?.id) {
                return json(res, 409, { error: 'PHONE_EXISTS' });
            }
        }

        const nextIsMember = hasMember ? parseBoolean(body.is_member ?? body.isMember, current.is_member) : current.is_member;

        await pool.query(
            `update clients set first_name=$2, last_name=$3, phone=$4, is_member=$5 where ${where.sql}`,
            [where.param, nextFirst, nextLast, nextPhone, nextIsMember]
        );

        const refreshed = await pool.query(
            `select id, first_name, last_name, phone, coalesce(is_member,false) as is_member from clients where ${where.sql}`,
            [where.param]
        );
        const r = refreshed.rows[0];
        return json(res, 200, {
            id: r.id,
            first_name: r.first_name || '',
            last_name: r.last_name || '',
            phone: r.phone || '',
            firstName: r.first_name || '',
            lastName: r.last_name || '',
            is_member: !!r.is_member,
            isMember: !!r.is_member,
        });
    }


    /* ---- SETTINGS ---- */
    if (req.method === 'GET' && pathname.startsWith('/settings/')) {
        const key = decodeURIComponent(pathname.split('/').pop());
        const q = await pool.query(`select key, value from settings where key=$1`, [key]);
        if (q.rows.length === 0) return json(res, 200, null);
        return json(res, 200, q.rows[0]);
    }
    if (req.method === 'POST' && pathname.startsWith('/admin/settings/')) {
        const key = decodeURIComponent(pathname.split('/').pop());
        const body = await readBody(req);
        const rawVal = body?.value ?? null;
        const val = (rawVal && typeof rawVal === 'object' && !Buffer.isBuffer(rawVal))
            ? JSON.stringify(rawVal)
            : rawVal;
        const q = await pool.query(
            `insert into settings(key, value) values ($1,$2)
                on conflict (key) do update set value=excluded.value
                                         returning key, value`,
            [key, val]
        );
        return json(res, 200, q.rows[0]);
    }

    /* ---- APPOINTMENTS ---- */
    if (req.method === 'GET' && pathname === '/appointments') {
        const date = url.searchParams.get('date');
        let rows;
        if (date) {
            const { start, end } = dayBounds(date);
            const q = await pool.query(`
                select a.id, a.starts_at, a.ends_at, a.status, a.note,
                       s.id as service_id, s.name as service_name, s.duration_minutes,
                       c.id as client_id, c.first_name, c.last_name, c.phone
                from appointments a
                         left join services s on s.id=a.service_id
                         left join clients c  on c.id=a.client_id
                where a.starts_at >= $1 and a.starts_at < $2
                order by a.starts_at asc
            `, [start, end]);
            rows = q.rows;
        } else {
            const q = await pool.query(`
                select a.id, a.starts_at, a.ends_at, a.status, a.note,
                       s.id as service_id, s.name as service_name, s.duration_minutes,
                       c.id as client_id, c.first_name, c.last_name, c.phone
                from appointments a
                         left join services s on s.id=a.service_id
                         left join clients c  on c.id=a.client_id
                order by a.starts_at desc
            `);
            rows = q.rows;
        }
        return json(res, 200, rows.map(compatAppointmentRow));
    }

    if (req.method === 'GET' && pathname === '/admin/appointments') {
        const date = url.searchParams.get('date');
        let rows;
        if (date) {
            const { start, end } = dayBounds(date);
            const q = await pool.query(`
                select a.id, a.starts_at, a.ends_at, a.status, a.note,
                       s.id as service_id, s.name as service_name, s.duration_minutes,
                       c.id as client_id, c.first_name, c.last_name, c.phone
                from appointments a
                         left join services s on s.id=a.service_id
                         left join clients c  on c.id=a.client_id
                where a.starts_at >= $1 and a.starts_at < $2
                order by a.starts_at asc
            `, [start, end]);
            rows = q.rows;
        } else {
            const q = await pool.query(`
                select a.id, a.starts_at, a.ends_at, a.status, a.note,
                       s.id as service_id, s.name as service_name, s.duration_minutes,
                       c.id as client_id, c.first_name, c.last_name, c.phone
                from appointments a
                         left join services s on s.id=a.service_id
                         left join clients c  on c.id=a.client_id
                order by a.starts_at desc
            `);
            rows = q.rows;
        }
        return json(res, 200, rows.map(compatAppointmentRow));
    }

    if (req.method === 'GET' && pathname.startsWith('/admin/clients/') && pathname.endsWith('/appointments')) {
        const parts = pathname.split('/').filter(Boolean);
        const clientId = parts[2];
        if (!clientId) return json(res, 400, { error: 'MISSING_CLIENT_ID' });

        const parsed = parseId(clientId);
        const { sql, param } = idWhere('c', parsed);
        const futureOnly = parseBoolean(url.searchParams.get('future'), true);
        const now = new Date();

        const q = await pool.query(`
            select a.id, a.starts_at, a.ends_at, a.status, a.note,
                   s.id as service_id, s.name as service_name, s.duration_minutes,
                   c.id as client_id, c.first_name, c.last_name, c.phone
            from appointments a
                     left join services s on s.id=a.service_id
                     left join clients c  on c.id=a.client_id
            where ${sql}
              ${futureOnly ? "and a.starts_at > $2 and coalesce(a.status,'') <> 'canceled'" : ""}
            order by a.starts_at asc
        `, futureOnly ? [param, now] : [param]);

        return json(res, 200, q.rows.map(compatAppointmentRow));
    }

    if (req.method === 'POST' && pathname === '/appointments') {
        const body = await readBody(req);

        // Legacy admin-style payload
        if (body?.starts_at || body?.ends_at) {
            const { starts_at, ends_at, service_id, status = 'booked', note = '' } = body;
            const { client_first_name = '', client_last_name = '', client_phone = '' } = body;
            if (!starts_at || !ends_at || !client_phone) return json(res, 400, { error: 'Missing required fields' });
            // --- Block past times (legacy payload) ---
            const nowLegacy = new Date();
            const sLegacy = new Date(starts_at);
            const eLegacy = new Date(ends_at);
            if (!isFinite(sLegacy.getTime()) || !isFinite(eLegacy.getTime())) {
                return json(res, 400, { error: 'INVALID_DATETIME' });
            }
// מרווח בטיחות של 60 שניות כדי לכסות סטיות שעון קלות
            if (sLegacy.getTime() <= nowLegacy.getTime() + 60_000) {
                return json(res, 400, { error: 'PAST_TIME_NOT_ALLOWED' });
            }
            if (eLegacy.getTime() <= sLegacy.getTime()) {
                return json(res, 400, { error: 'INVALID_RANGE' });
            }

            const clientRec = await upsertClient(client_first_name, client_last_name, client_phone);
            const clientId = clientRec.id;
            const q = await pool.query(
                `insert into appointments (service_id, client_id, starts_at, ends_at, status, note)
                 values ($1,$2,$3,$4,$5,$6)
                     returning id`,
                [service_id ?? null, clientId, sLegacy, eLegacy, status, note]            );
            return json(res, 200, { id: q.rows[0].id });
        }

        // Public site payload
        const serviceId = body?.serviceId ?? body?.service?.id ?? null;
        const date = body?.date;
        const time = body?.time;
        const note = body?.note ?? '';
        const client = body?.client ?? {};
        const firstName = client?.firstName ?? body?.firstName ?? '';
        const lastName  = client?.lastName  ?? body?.lastName  ?? '';
        const phone     = client?.phone     ?? body?.phone     ?? '';

        if (!date || !time || !phone) return json(res, 400, { error: 'Missing required fields (date, time, phone)' });

        const start = toLocalDateTime(date, time);
        let duration = 30;
        if (serviceId) {
            const s = await pool.query(`select duration_minutes from services where id=$1`, [serviceId]);
            if (s.rows[0]?.duration_minutes) duration = Number(s.rows[0].duration_minutes) || 30;
        }
        const end = new Date(start.getTime() + duration * 60000);

        // --- Block past times (public payload) ---
        const nowPublic = new Date();
// מרווח בטיחות של 60 שניות כדי למנוע מרוץ זמנים
        if (!isFinite(start.getTime()) || !isFinite(end.getTime())) {
            return json(res, 400, { error: 'INVALID_DATETIME' });
        }
        if (start.getTime() <= nowPublic.getTime() + 60_000) {
            return json(res, 400, { error: 'PAST_TIME_NOT_ALLOWED' });
        }
        if (end.getTime() <= start.getTime()) {
            return json(res, 400, { error: 'INVALID_RANGE' });
        }


        const clientRec = await upsertClient(firstName, lastName, phone);
        const clientId = clientRec.id;
        const clientIsMember = !!clientRec.is_member;

        const rules = await loadBookingRules();
        const serviceIdStr = serviceId != null ? String(serviceId) : null;
        if (!clientIsMember && serviceIdStr && (rules.memberOnlyServiceIds || []).includes(serviceIdStr)) {
            return json(res, 400, { error: 'MEMBERS_ONLY_SERVICE' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((start.getTime() - today.getTime()) / 86400000);
        const maxAdvance = clientIsMember ? rules.memberMaxAdvanceDays : rules.publicMaxAdvanceDays;
        if (diffDays > maxAdvance) {
            return json(res, 400, { error: 'ADVANCE_LIMIT_EXCEEDED', maxDays: maxAdvance });
        }

        const weekday = start.getDay();
        const hoursList = await getBusinessHours();
        const dayConfig = hoursList.find((row) => Number(row.weekday) === weekday) || null;
        const fallbackConfig = DEFAULT_HOURS.find((row) => row.weekday === weekday) || { open: null, close: null, isOpen: false, slotIntervalMinutes: 30 };
        const isOpenForPublic = dayConfig ? Boolean(dayConfig.isOpen) : Boolean(fallbackConfig.isOpen);
        const openStr = isOpenForPublic ? (dayConfig?.open ?? fallbackConfig.open) : null;
        const closeStr = isOpenForPublic ? (dayConfig?.close ?? fallbackConfig.close) : null;
        const hasBaseWindow = Boolean(isOpenForPublic && openStr && closeStr && openStr !== closeStr);
        const baseOpen = hasBaseWindow && openStr ? toLocalDateTime(date, openStr) : null;
        const baseClose = hasBaseWindow && closeStr ? toLocalDateTime(date, closeStr) : null;
        const memberWindowsForDay = (rules.memberOnlyWindows || [])
            .filter((win) => Number(win.weekday) === weekday)
            .map((win) => ({ start: toLocalDateTime(date, win.start), end: toLocalDateTime(date, win.end) }))
            .filter((win) => win.start instanceof Date && win.end instanceof Date && !Number.isNaN(win.start.getTime()) && !Number.isNaN(win.end.getTime()) && win.end > win.start);

        const isInMemberWindow = memberWindowsForDay.some((win) => win.start <= start && win.end > start);

        if (!hasBaseWindow && (!clientIsMember || memberWindowsForDay.length === 0)) {
            return json(res, 400, { error: 'DAY_CLOSED' });
        }

        if (!clientIsMember && isInMemberWindow) {
            return json(res, 400, { error: 'MEMBERS_ONLY_WINDOW' });
        }

        if (!hasBaseWindow && clientIsMember && !isInMemberWindow) {
            return json(res, 400, { error: 'MEMBERS_ONLY_WINDOW' });
        }

        if (hasBaseWindow && baseOpen && baseClose) {
            if (start < baseOpen || start >= baseClose) {
                if (!(clientIsMember && isInMemberWindow)) {
                    return json(res, 400, { error: 'OUTSIDE_BUSINESS_HOURS' });
                }
            }
        }

        const ins = await pool.query(
            `insert into appointments (service_id, client_id, starts_at, ends_at, status, note)
             values ($1,$2,$3,$4,$5,$6) returning id`,
            [serviceId, clientId, start, end, 'booked', note]
        );
        return json(res, 200, { id: ins.rows[0].id });
    }

    if (req.method === 'POST' && /^\/admin\/appointments\/.+\/recurring$/.test(pathname)) {
        const parts = pathname.split('/').filter(Boolean);
        const idRaw = parts.length >= 3 ? parts[2] : null;
        const parsed = parseId(idRaw);
        if (!parsed.raw) {
            return json(res, 400, { error: 'MISSING_APPOINTMENT_ID' });
        }

        const body = await readBody(req).catch(() => ({}));
        const intervalUnitRaw = body?.intervalUnit ?? body?.interval_unit ?? body?.unit;
        const intervalCandidate = body?.intervalWeeks ?? body?.interval ?? body?.every ?? body?.frequency;
        const intervalMonthsCandidate = body?.intervalMonths ?? body?.interval_months ?? body?.months;
        const intervalUnit = typeof intervalUnitRaw === 'string' ? intervalUnitRaw.toLowerCase() : null;
        const hasMonthlyUnit = intervalUnit && ['month', 'months', 'monthly'].includes(intervalUnit);
        let intervalWeeks = Number(intervalCandidate);
        let intervalMonths = Number(intervalMonthsCandidate);
        const useMonths = hasMonthlyUnit || Number.isFinite(intervalMonths);

        if (useMonths) {
            intervalMonths = Number.isFinite(intervalMonths) ? intervalMonths : 1;
            if (!Number.isFinite(intervalMonths) || intervalMonths !== 1) {
                return json(res, 400, { error: 'INVALID_INTERVAL', message: 'ניתן לבחור חזרה חודשית בלבד.' });
            }
        } else {
            if (!Number.isFinite(intervalWeeks) || ![1, 2, 3].includes(Number(intervalWeeks))) {
                return json(res, 400, { error: 'INVALID_INTERVAL', message: 'ניתן לבחור כל שבוע, כל שבועיים או כל שלושה שבועות.' });
            }
        }

        await ensureRecurringTable();
        const { sql, param } = idWhere('appointments', parsed);
        const baseRes = await pool.query(
            `select id, client_id, service_id, starts_at, ends_at, status, note from appointments where ${sql} limit 1`,
            [param]
        );
        const base = baseRes.rows[0];
        if (!base) {
            return json(res, 404, { error: 'APPOINTMENT_NOT_FOUND' });
        }

        const start = new Date(base.starts_at);
        const end = new Date(base.ends_at);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
            return json(res, 400, { error: 'INVALID_APPOINTMENT_TIME', message: 'לא ניתן ליצור תור קבוע עבור תור עם שעה שגויה.' });
        }

        const durationMs = Math.max(end.getTime() - start.getTime(), 15 * 60 * 1000);
        const clientId = base.client_id;
        if (clientId == null) {
            return json(res, 400, { error: 'APPOINTMENT_HAS_NO_CLIENT', message: 'לא ניתן ליצור תור קבוע ללא לקוח משויך.' });
        }
        const scheduleWeekday = start.getDay();
        const scheduleDayOfMonth = start.getDate();
        const scheduleTime = formatHHmm(start);
        let clientIsMember = false;
        const clientRes = await pool.query('select coalesce(is_member, false) as is_member from clients where id=$1 limit 1', [clientId]);
        clientIsMember = Boolean(clientRes.rows[0]?.is_member);

        const recurrenceEndDate = addMonthsSafe(start, 6);
        const occurrences = [];
        for (let occurrence = 1; occurrence <= MAX_RECURRING_OCCURRENCES; occurrence += 1) {
            const candidateStart = useMonths
                ? addMonthsSafe(start, occurrence * intervalMonths)
                : new Date(start.getTime() + occurrence * intervalWeeks * 7 * 24 * 60 * 60 * 1000);
            if (candidateStart >= recurrenceEndDate) {
                break;
            }
            const candidateEnd = new Date(candidateStart.getTime() + durationMs);
            occurrences.push({ start: candidateStart, end: candidateEnd });
        }

        const conflicts = [];
        const conflictKeys = new Set();
        let hasMoreConflicts = false;
        const pushConflict = (key, payload) => {
            if (conflictKeys.has(key)) return;
            conflictKeys.add(key);
            if (conflicts.length < 3) {
                conflicts.push(payload);
            } else {
                hasMoreConflicts = true;
            }
        };

        for (const occurrence of occurrences) {
            const conflictRes = await pool.query(
                `select a.id,
                        a.starts_at,
                        a.ends_at,
                        c.first_name,
                        c.last_name,
                        s.name as service_name
                 from appointments a
                 left join clients c on c.id = a.client_id
                 left join services s on s.id = a.service_id
                 where a.starts_at < $2
                   and a.ends_at > $1
                   and coalesce(a.status, 'booked') <> 'canceled'`,
                [occurrence.start, occurrence.end]
            );

            for (const row of conflictRes.rows) {
                const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
                pushConflict(`appointment-${row.id}`, {
                    type: 'appointment',
                    id: row.id,
                    starts_at: row.starts_at,
                    ends_at: row.ends_at,
                    client_name: name || null,
                    service_name: row.service_name || null,
                });
            }

            const blockRows = await pool.query(
                `select id, start_at, end_at, reason, coalesce(members_only,false) as members_only
                 from blocked_times
                 where start_at < $2
                   and end_at > $1`,
                [occurrence.start, occurrence.end]
            );
            const blocking = blockRows.rows.filter((row) => !(row.members_only && clientIsMember));
            for (const row of blocking) {
                pushConflict(`blocked-${row.id}`, {
                    type: 'blocked',
                    id: row.id,
                    starts_at: row.start_at,
                    ends_at: row.end_at,
                    reason: row.reason || null,
                });
            }

            if (hasMoreConflicts && conflicts.length >= 3) {
                break;
            }
        }

        if (conflicts.length > 0) {
            return json(res, 409, {
                error: 'RECURRING_CONFLICT',
                message: 'לא ניתן לקבוע תור קבוע כי קיימים תורים מתנגשים.',
                conflicts,
                hasMore: hasMoreConflicts,
            });
        }

        const scheduleLookup = useMonths
            ? await pool.query(
                `select id from recurring_appointments
                 where client_id = $1
                   and service_id = $2
                   and start_time = $3
                   and interval_months = $4
                   and day_of_month = $5
                 limit 1`,
                [clientId, base.service_id, scheduleTime, intervalMonths, scheduleDayOfMonth]
            )
            : await pool.query(
                `select id from recurring_appointments
                 where client_id = $1
                   and service_id = $2
                   and start_time = $3
                   and interval_months is null
                   and weekday = $4
                 limit 1`,
                [clientId, base.service_id, scheduleTime, scheduleWeekday]
            );
        let recurringScheduleId = scheduleLookup.rows[0]?.id ?? null;

        if (recurringScheduleId) {
            await pool.query(
                `update recurring_appointments
                 set interval_weeks = $1,
                     interval_months = $2,
                     day_of_month = $3,
                     weekday = $4
                 where id = $5`,
                [useMonths ? 1 : intervalWeeks, useMonths ? intervalMonths : null, useMonths ? scheduleDayOfMonth : null, scheduleWeekday, recurringScheduleId]
            );
        } else {
            const scheduleRes = await pool.query(
                `insert into recurring_appointments (client_id, service_id, weekday, start_time, interval_weeks, interval_months, day_of_month)
                 values ($1,$2,$3,$4,$5,$6,$7)
                 returning id`,
                [clientId, base.service_id, scheduleWeekday, scheduleTime, useMonths ? 1 : intervalWeeks, useMonths ? intervalMonths : null, useMonths ? scheduleDayOfMonth : null]
            );
            recurringScheduleId = scheduleRes.rows[0]?.id ?? null;
        }

        if (recurringScheduleId && base.id != null) {
            await pool.query(`update appointments set recurring_id = $1 where id = $2`, [recurringScheduleId, base.id]);
        }

        const createdIds = [];
        const skippedDates = [];
        const baseStatus = base.status || 'booked';
        const baseNote = base.note ?? null;

        for (const occurrence of occurrences) {
            const ins = await pool.query(
                `insert into appointments (service_id, client_id, starts_at, ends_at, status, note, recurring_id)
                 values ($1, $2, $3, $4, $5, $6, $7) returning id`,
                [base.service_id, clientId, occurrence.start, occurrence.end, baseStatus, baseNote, recurringScheduleId]
            );
            if (ins.rows[0]?.id != null) {
                createdIds.push(ins.rows[0].id);
            }
        }

        return json(res, 200, {
            createdCount: createdIds.length,
            skippedDates,
            createdAppointmentIds: createdIds,
            recurringScheduleId,
            schedule: {
                id: recurringScheduleId,
                client_id: clientId,
                service_id: base.service_id,
                weekday: scheduleWeekday,
                start_time: scheduleTime,
                interval_weeks: useMonths ? null : intervalWeeks,
                interval_months: useMonths ? intervalMonths : null,
                day_of_month: useMonths ? scheduleDayOfMonth : null,
            },
        });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/admin/recurring-appointments/')) {
        const idRaw = pathname.split('/').filter(Boolean).pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) {
            return json(res, 400, { error: 'INVALID_RECURRING_ID' });
        }

        await ensureRecurringTable();
        const { sql, param } = idWhere('recurring_appointments', parsed);
        const scheduleRes = await pool.query(
            `select id, client_id, service_id, weekday, start_time, interval_weeks, interval_months, day_of_month
             from recurring_appointments where ${sql} limit 1`,
            [param]
        );
        const schedule = scheduleRes.rows[0];
        if (!schedule) {
            return json(res, 404, { error: 'RECURRING_NOT_FOUND' });
        }

        await pool.query(`delete from recurring_appointments where ${sql}`, [param]);

        const scheduleTime = sanitizeBusinessTime(schedule.start_time ?? schedule.startTime ?? schedule.start ?? '');
        const usesMonthly = Number(schedule.interval_months) > 0;
        let idsToCancel = [];

        if (schedule.id != null) {
            const linked = await pool.query(
                `select id from appointments where recurring_id = $1 and coalesce(status,'booked') <> 'canceled'`,
                [schedule.id]
            );
            idsToCancel = linked.rows
                .map((row) => (row.id == null ? null : String(row.id)))
                .filter(Boolean);
        }

        if (idsToCancel.length === 0) {
            const fallback = usesMonthly
                ? await pool.query(
                    `select id from appointments
                     where client_id=$1
                       and service_id=$2
                       and starts_at >= now()
                       and extract(day from starts_at at time zone 'Asia/Jerusalem') = $3
                       and to_char(starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') = $4
                       and coalesce(status,'booked') <> 'canceled'`,
                    [schedule.client_id, schedule.service_id, schedule.day_of_month, scheduleTime]
                )
                : await pool.query(
                    `select id from appointments
                     where client_id=$1
                       and service_id=$2
                       and starts_at >= now()
                       and extract(dow from starts_at at time zone 'Asia/Jerusalem') = $3
                       and to_char(starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') = $4
                       and coalesce(status,'booked') <> 'canceled'`,
                    [schedule.client_id, schedule.service_id, schedule.weekday, scheduleTime]
                );
            idsToCancel = fallback.rows
                .map((row) => (row.id == null ? null : String(row.id)))
                .filter(Boolean);

            if (idsToCancel.length > 0 && schedule.id != null) {
                await pool.query(
                    `update appointments set recurring_id = $1 where CAST(id AS text) = any($2::text[])`,
                    [schedule.id, idsToCancel]
                );
            }
        }

        if (idsToCancel.length > 0) {
            await pool.query(
                `update appointments set status='canceled' where CAST(id AS text) = any($1::text[])`,
                [idsToCancel]
            );
            await pool.query(
                `delete from appointments where CAST(id AS text) = any($1::text[])`,
                [idsToCancel]
            );
        }

        return json(res, 200, { ok: true, canceledCount: idsToCancel.length });
    }

    if (req.method === 'POST' && pathname === '/admin/appointments/reschedule') {
        const body = await readBody(req);
        const { id, newStartAt, newEndAt } = body || {};
        if (!id || !newStartAt || !newEndAt) return json(res, 400, { error: 'Missing id/newStartAt/newEndAt' });
        await pool.query(`update appointments set starts_at=$2, ends_at=$3 where id=$1`, [id, new Date(newStartAt), new Date(newEndAt)]);
        return json(res, 200, { ok: true });
    }

    if (req.method === 'PUT' && pathname.startsWith('/admin/appointments/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const body = await readBody(req);
        const { status, note } = body || {};
        const where = idWhere('appointments', parsed);
        await pool.query(
            `update appointments set status = coalesce($2, status), note = coalesce($3, note) where ${where.sql}`,
            [where.param, status ?? null, note ?? null]
        );
        return json(res, 200, { ok: true });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/admin/appointments/')) {
        const id = pathname.split('/').pop();
        if (!id) return json(res, 400, { error: 'MISSING_ID' });

        const del = await pool.query(`DELETE FROM appointments WHERE id = $1 RETURNING id`, [id]);
        if (del.rowCount === 0) {
            return json(res, 404, { error: 'NOT_FOUND' });
        }
        return json(res, 200, { ok: true, id });
    }

    if (req.method === 'GET' && pathname === '/clients/me/appointments') {
        const raw = (url.searchParams.get('phone') || '');
        const { p0, p972 } = phoneDigitsPair(raw);

        if (!p0 && !p972) return json(res, 200, []);

        const q = await pool.query(`
          select a.id, a.starts_at, a.ends_at, a.status, a.note, a.recurring_id,
                 s.id as service_id, s.name as service_name, s.duration_minutes,
                 c.id as client_id, c.first_name, c.last_name, c.phone
          from appointments a
               left join services s on s.id=a.service_id
               left join clients  c on c.id=a.client_id
          where regexp_replace(c.phone, '\\D', '', 'g') in ($1, $2)
          order by a.starts_at desc
        `, [p0, p972]);

        return json(res, 200, q.rows.map(compatAppointmentRow));

    }

    if (req.method === 'GET' && pathname === '/appointments/available') {
        const serviceId = url.searchParams.get('serviceId');
        const date = url.searchParams.get('date'); // yyyy-MM-dd
        if (!serviceId || !date) return json(res, 200, []);

        const isMemberQuery = url.searchParams.get('isMember') ?? url.searchParams.get('member') ?? url.searchParams.get('members');
        const isMember = parseBoolean(isMemberQuery, false);

        const rules = await loadBookingRules();
        const serviceIdStr = String(serviceId);
        if (!isMember && (rules.memberOnlyServiceIds || []).includes(serviceIdStr)) {
            return json(res, 200, []);
        }

        const d = new Date(date + 'T00:00:00');
        if (Number.isNaN(d.getTime())) return json(res, 200, []);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((d.getTime() - today.getTime()) / 86400000);
        const maxAdvance = isMember ? rules.memberMaxAdvanceDays : rules.publicMaxAdvanceDays;
        if (diffDays > maxAdvance) return json(res, 200, []);

        let duration = 30;
        const s = await pool.query(`select duration_minutes from services where id=$1`, [serviceId]);
        if (s.rows[0]?.duration_minutes) duration = Number(s.rows[0].duration_minutes) || 30;

        const hoursList = await getBusinessHours();
        const weekday = d.getDay();
        const dayConfig = hoursList.find((row) => Number(row.weekday) === weekday) || null;
        const fallbackConfig = DEFAULT_HOURS.find((row) => row.weekday === weekday) || { open: null, close: null, isOpen: false, slotIntervalMinutes: 30 };
        const isOpenForPublic = dayConfig ? Boolean(dayConfig.isOpen) : Boolean(fallbackConfig.isOpen);
        const openStr = isOpenForPublic ? (dayConfig?.open ?? fallbackConfig.open) : null;
        const closeStr = isOpenForPublic ? (dayConfig?.close ?? fallbackConfig.close) : null;
        const hasBaseWindow = Boolean(isOpenForPublic && openStr && closeStr && openStr !== closeStr);
        const open = hasBaseWindow && openStr ? toLocalDateTime(date, openStr) : null;
        const close = hasBaseWindow && closeStr ? toLocalDateTime(date, closeStr) : null;
        const memberWindowsForDay = (rules.memberOnlyWindows || [])
            .filter((win) => Number(win.weekday) === weekday)
            .map((win) => ({ start: toLocalDateTime(date, win.start), end: toLocalDateTime(date, win.end) }))
            .filter((win) => win.start instanceof Date && win.end instanceof Date && !Number.isNaN(win.start.getTime()) && !Number.isNaN(win.end.getTime()) && win.end > win.start);

        if (!hasBaseWindow && (!isMember || memberWindowsForDay.length === 0)) {
            return json(res, 200, []);
        }

        const { start, end } = dayBounds(date);
        const ap = await pool.query(`
            select starts_at, ends_at
            from appointments
            where starts_at >= $1 and starts_at < $2
              and coalesce(status, 'booked') <> 'canceled'
        `, [start, end]);
        const bl = await pool.query(`
            select start_at as starts_at, end_at as ends_at, coalesce(members_only,false) as members_only
            from blocked_times
            where start_at < $2 and end_at > $1
        `, [start, end]);

        const blockBusy = bl.rows
            .filter(r => !(r.members_only && isMember))
            .map(r => ({ start: new Date(r.starts_at), end: new Date(r.ends_at) }));
        const apBusy = ap.rows.map(r => ({ start: new Date(r.starts_at), end: new Date(r.ends_at) }));
        const busy = [...apBusy, ...blockBusy];

        const stepMinutes = Number(dayConfig?.slotIntervalMinutes ?? dayConfig?.slot ?? fallbackConfig.slotIntervalMinutes ?? fallbackConfig.slot ?? 30) || 30;
        const durationMs = duration * 60000;
        const baseWindows = hasBaseWindow && open && close ? [{ start: open, end: close }] : [];
        const candidateWindows = isMember
            ? [...baseWindows, ...memberWindowsForDay]
            : baseWindows;

        if (candidateWindows.length === 0) {
            return json(res, 200, []);
        }

        const slotsSet = new Set();
        const isInMemberWindow = (slotStart) => memberWindowsForDay.some((win) => win.start <= slotStart && win.end > slotStart);

        for (const window of candidateWindows) {
            for (let t = new Date(window.start); t.getTime() + durationMs <= window.end.getTime(); t = new Date(t.getTime() + stepMinutes * 60000)) {
                const slotStart = new Date(t);
                if (Number.isNaN(slotStart.getTime())) continue;
                const slotEnd = new Date(slotStart.getTime() + durationMs);
                const overlaps = busy.some(b => b.start < slotEnd && b.end > slotStart);
                if (overlaps) continue;
                if (!isMember && isInMemberWindow(slotStart)) continue;
                slotsSet.add(formatHHmm(slotStart));
            }
        }

        const slots = Array.from(slotsSet).sort();
        return json(res, 200, slots);
    }


    /* ---- BLOCKS ---- */
    if (req.method === 'GET' && pathname === '/admin/blocked-times') {
        const date = url.searchParams.get('date');
        const params = [];
        let where = '';
        if (date) {
            const { start, end } = dayBounds(date);
            params.push(start, end);
            where = 'where start_at < $2 and end_at > $1';
        }
        const q = await pool.query(`
            select id, start_at, end_at, reason, coalesce(members_only,false) as members_only
            from blocked_times
            ${where}
            order by start_at desc
        `, params);
        const rows = q.rows.map(r => ({
            id: r.id,
            startAt: r.start_at,
            endAt:   r.end_at,
            reason:  r.reason,
            start_at: r.start_at,
            end_at:   r.end_at,
            members_only: !!r.members_only,
            membersOnly: !!r.members_only,
        }));
        return json(res, 200, rows);
    }



    const loadAppointmentConflicts = async (startAt, endAt) => {
        return await pool.query(`
    select a.id, a.starts_at, a.ends_at,
           coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), 'לקוח') as client_name
    from appointments a
    left join clients c on c.id = a.client_id
    where coalesce(a.status,'booked') <> 'canceled'
      and a.starts_at < $2
      and a.ends_at   > $1
    order by a.starts_at
    limit 20
  `, [startAt, endAt]);
    };

    const serializeConflicts = (rows = []) => rows.map(r => ({
        id: r.id,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        client_name: r.client_name || ''
    }));

    // POST /admin/blocked-times — מונע חסימה אם יש תורים חופפים; מחזיר 409 עם פירוט
    if (req.method === 'POST' && pathname === '/admin/blocked-times') {
        const body = await readBody(req) || {};

        // קבלה בכל שם אפשרי מהקליינט
        const startsAtRaw = body.starts_at || body.startAt || body.start || body.from;
        const endsAtRaw   = body.ends_at   || body.endAt   || body.end   || body.to;
        const reason      = body.reason    || body.desc    || '';
        const membersOnly = parseBoolean(body.members_only ?? body.membersOnly ?? body.members, false);

        if (!startsAtRaw || !endsAtRaw) {
            return json(res, 400, { error: 'Missing starts_at/ends_at' });
        }

        // parseAnyDate היא פונקציה שעוזרת לפרסר ISO/לוקאלי — ודאי שהוספת אותה למעלה (כמו שנתתי קודם)
        const s = parseAnyDate(startsAtRaw);
        const e = parseAnyDate(endsAtRaw);

        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
            return json(res, 400, { error: 'Invalid datetime format' });
        }
        if (e <= s) {
            return json(res, 400, { error: 'Invalid time range: end <= start' });
        }

        // ✳️ בדיקת חפיפה לתורים לא מבוטלים
        const overlap = await loadAppointmentConflicts(s, e);

        if (overlap.rowCount > 0) {
            return json(res, 409, {
                error: 'יש תורים קיימים בתוך הטווח – בטל/י אותם לפני חסימה.',
                conflicts: serializeConflicts(overlap.rows)
            });
        }

        // אין חפיפה — מוסיפים חסימה
        const q = await pool.query(
            `insert into blocked_times (start_at, end_at, reason, members_only)
             values ($1,$2,$3,$4)
                 returning id, start_at, end_at, reason, coalesce(members_only,false) as members_only`,
            [s, e, String(reason), membersOnly]
        );

        const row = q.rows[0];
        return json(res, 200, {
            id: row.id,
            starts_at: row.start_at,
            ends_at:   row.end_at,
            reason: row.reason,
            members_only: !!row.members_only,
            membersOnly: !!row.members_only,
        });
    }


    if (req.method === 'PUT' && pathname.startsWith('/admin/blocked-times/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });

        const body = await readBody(req) || {};
        const where = idWhere('blocked_times', parsed);
        const existing = await pool.query(
            `select id, start_at, end_at, reason, coalesce(members_only,false) as members_only
             from blocked_times where ${where.sql} limit 1`,
            [where.param]
        );
        const row = existing.rows[0];
        if (!row) return json(res, 404, { error: 'Blocked time not found' });

        const startsAtRaw = body.starts_at || body.startAt || body.start || body.from || row.start_at;
        const endsAtRaw   = body.ends_at   || body.endAt   || body.end   || body.to   || row.end_at;
        const reason      = body.reason    ?? body.desc    ?? row.reason ?? '';
        const membersOnly = parseBoolean(body.members_only ?? body.membersOnly ?? body.members, row.members_only ?? false);

        const s = parseAnyDate(startsAtRaw);
        const e = parseAnyDate(endsAtRaw);

        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
            return json(res, 400, { error: 'Invalid datetime format' });
        }
        if (e <= s) {
            return json(res, 400, { error: 'Invalid time range: end <= start' });
        }

        const overlap = await loadAppointmentConflicts(s, e);
        if (overlap.rowCount > 0) {
            return json(res, 409, {
                error: 'יש תורים קיימים בתוך הטווח – בטל/י אותם לפני חסימה.',
                conflicts: serializeConflicts(overlap.rows)
            });
        }

        const updated = await pool.query(
            `update blocked_times
             set start_at=$2, end_at=$3, reason=$4, members_only=$5
             where ${where.sql}
             returning id, start_at, end_at, reason, coalesce(members_only,false) as members_only`,
            [where.param, s, e, String(reason ?? ''), membersOnly]
        );
        const updatedRow = updated.rows[0];
        return json(res, 200, {
            id: updatedRow.id,
            starts_at: updatedRow.start_at,
            ends_at:   updatedRow.end_at,
            reason: updatedRow.reason,
            members_only: !!updatedRow.members_only,
            membersOnly: !!updatedRow.members_only,
        });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/admin/blocked-times/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const where = idWhere('blocked_times', parsed);
        await pool.query(`delete from blocked_times where ${where.sql}`, [where.param]);
        return json(res, 200, { ok: true });
    }

    /* ---- ADMIN: products / testimonials / gallery-videos / background-videos / services + reorder ---- */


// helpers להמרת גוף בקשה snake/camel → snake בטבלה
    function bool(v, def=true){ return (v===undefined||v===null) ? def : !!v; }
    function num(v, def=0){ const n = Number(v); return Number.isFinite(n) ? n : def; }
    function str(v){ return (v===undefined || v===null) ? null : String(v); }

    // POST /waiting-list – לקוח מצטרף לרשימת המתנה
    if (req.method === 'POST' && pathname === '/waiting-list') {
        const b = await readBody(req) || {};
        const serviceId = Number(b.service_id ?? b.serviceId ?? null);
        const desired = new Date(b.desired_starts_at ?? b.desiredStartsAt);
        const name = String(b.client_name ?? '').trim();
        const phone = normalizePhone(b.phone);

        if (!serviceId || !desired || Number.isNaN(desired.getTime()) || !phone)
            return json(res, 400, { ok:false, error:'MISSING_FIELDS' });

        // קישור לקוח קיים/יצירה (אופציונלי)
        let clientId = null;
        try {
            const ensured = await upsertClient(
                name.split(' ')[0] || '',
                name.split(' ').slice(1).join(' ') || '',
                phone
            );
            clientId = ensured.id;
        } catch {}

        const q = await pool.query(
            `insert into waiting_list (client_id, client_name, phone, service_id, desired_starts_at, status)
     values ($1,$2,$3,$4,$5,'waiting')
     returning *`,
            [clientId, name, phone, serviceId, desired]
        );
        return json(res, 200, { ok:true, entry:q.rows[0] });
    }

// GET /admin/waiting-list – רשימת המתנה לניהול
    if (req.method === 'GET' && pathname === '/admin/waiting-list') {
        const q = await pool.query(`
    select w.*, s.name as service_name, s.duration_minutes
    from waiting_list w
    left join services s on s.id = w.service_id
    where w.status in ('waiting','notified')
    order by w.created_at desc
  `);
        return json(res, 200, q.rows);
    }

// PUT /admin/waiting-list/:id – עדכון סטטוס/שעה
    if (req.method === 'PUT' && pathname.startsWith('/admin/waiting-list/')) {
        const id = pathname.split('/').pop();
        const b = await readBody(req) || {};
        const status = b.status ?? null;
        const desired = b.desired_starts_at ?? b.desiredStartsAt ?? null;

        await pool.query(
            `update waiting_list
             set status = coalesce($2,status),
                 desired_starts_at = coalesce($3,desired_starts_at)
             where id = $1`,
            [id, status, desired ? new Date(desired) : null]
        );
        const q = await pool.query(`select * from waiting_list where id=$1`, [id]);
        return json(res, 200, q.rows[0] || null);
    }

// DELETE /admin/waiting-list/:id – מחיקה (לא חובה)
    if (req.method === 'DELETE' && pathname.startsWith('/admin/waiting-list/')) {
        const id = pathname.split('/').pop();
        await pool.query(`delete from waiting_list where id=$1`, [id]);
        return json(res, 200, { ok:true });
    }


// ---------- PRODUCTS ----------
    if (req.method === 'GET' && pathname === '/admin/products') {
        const q = await pool.query(`select id, name, price, image_url, order_index, is_active from products order by order_index, id`);
        return json(res, 200, q.rows);
    }
    if (req.method === 'POST' && pathname === '/admin/products') {
        const b = await readBody(req) || {};
        const q = await pool.query(
            `insert into products (name, price, image_url, order_index, is_active)
     values ($1,$2,$3,$4,$5) returning id, name, price, image_url, order_index, is_active`,
            [str(b.name), num(b.price, null), str(b.imageUrl ?? b.image_url), num(b.orderIndex ?? b.order_index, 0), bool(b.isActive ?? b.is_active, true)]
        );
        return json(res, 200, q.rows[0]);
    }
    if (req.method === 'PUT' && pathname.startsWith('/admin/products/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });

        const b = await readBody(req) || {};
        const where = idWhere('products', parsed);
        await pool.query(
            `update products set
                                 name = coalesce($2, name),
                                 price = coalesce($3, price),
                                 image_url = coalesce($4, image_url),
                                 order_index = coalesce($5, order_index),
                                 is_active = coalesce($6, is_active)
             where ${where.sql}`,
            [where.param, str(b.name),
                (b.price===undefined? null : num(b.price, null)),
                str(b.imageUrl ?? b.image_url),
                (b.orderIndex===undefined && b.order_index===undefined ? null : num(b.orderIndex ?? b.order_index, 0)),
                (b.isActive===undefined && b.is_active===undefined ? null : bool(b.isActive ?? b.is_active))]
        );
        const q = await pool.query(
            `select id, name, price, image_url, order_index, is_active from products where ${where.sql}`,
            [where.param]
        );
        return json(res, 200, q.rows[0]);
    }
    if (req.method === 'DELETE' && pathname.startsWith('/admin/products/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const where = idWhere('products', parsed);
        await pool.query(`delete from products where ${where.sql}`, [where.param]);
        return json(res, 200, { ok: true });
    }

// ---------- TESTIMONIALS ----------
    if (req.method === 'GET' && pathname === '/admin/testimonials') {
        const q = await pool.query(`select id, author, rating, content, order_index, is_active from testimonials order by order_index, id`);
        const rows = q.rows.map(r => ({ ...r, text: r.content })); // ← alias
        return json(res, 200, rows);
    }

    if (req.method === 'POST' && pathname === '/admin/testimonials') {
        const b = await readBody(req) || {};

        // קבל גם text וגם content, ודא שלעולם לא נשלח null לטבלה
        const rawContent = (b.content ?? b.text ?? b.body ?? b.comment ?? '');
        const contentVal = String(rawContent);

        const q = await pool.query(
            `insert into testimonials (author, rating, content, order_index, is_active)
         values ($1,$2,$3,$4,$5)
         returning id, author, rating, content, order_index, is_active`,
            [str(b.author), (b.rating===undefined? null : num(b.rating, null)), contentVal, num(b.orderIndex ?? b.order_index, 0), bool(b.isActive ?? b.is_active, true)]
        );
        const r = q.rows[0];
        return json(res, 200, { ...r, text: r.content }); // alias נוח ל־UI
    }


    if (req.method === 'PUT' && pathname.startsWith('/admin/testimonials/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const b = await readBody(req) || {};
        const where = idWhere('testimonials', parsed);
        const contentVal =
            (b.content===undefined && b.text===undefined)
                ? null // לא נוגעים בשדה הזה בעדכון
                : String(b.content ?? b.text ?? '');
        await pool.query(
            `update testimonials set
                                     author = coalesce($2, author),
                                     rating = coalesce($3, rating),
                                     content = coalesce($4, content),
                                     order_index = coalesce($5, order_index),
                                     is_active = coalesce($6, is_active)
             where ${where.sql}`,
            [where.param, str(b.author),
                (b.rating===undefined? null : num(b.rating, null)),
                contentVal,
                (b.orderIndex===undefined && b.order_index===undefined ? null : num(b.orderIndex ?? b.order_index, 0)),
                (b.isActive===undefined && b.is_active===undefined ? null : bool(b.isActive ?? b.is_active))]
        );
        const q = await pool.query(
            `select id, author, rating, content, order_index, is_active from testimonials where ${where.sql}`,
            [where.param]
        );
        const r = q.rows[0];
        return json(res, 200, r ? { ...r, text: r.content } : null);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/admin/testimonials/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const where = idWhere('testimonials', parsed);
        await pool.query(`delete from testimonials where ${where.sql}`, [where.param]);
        return json(res, 200, { ok: true });
    }

// ---------- GALLERY VIDEOS (Stories) ----------
    if (req.method === 'GET' && pathname === '/admin/gallery-videos') {
        const q = await pool.query(`select id, image_url, video_url, url, order_index, is_active from gallery_videos order by order_index, id`);
        return json(res, 200, q.rows);
    }
    if (req.method === 'POST' && pathname === '/admin/gallery-videos') {
        const b = await readBody(req) || {};
        const q = await pool.query(
            `insert into gallery_videos (image_url, video_url, url, order_index, is_active)
     values ($1,$2,$3,$4,$5) returning id, image_url, video_url, url, order_index, is_active`,
            [str(b.imageUrl ?? b.image_url), str(b.videoUrl ?? b.video_url ?? b.url), str(b.url ?? b.videoUrl ?? b.video_url),
                num(b.orderIndex ?? b.order_index, 0), bool(b.isActive ?? b.is_active, true)]
        );
        return json(res, 200, q.rows[0]);
    }
    if (req.method === 'PUT' && pathname.startsWith('/admin/gallery-videos/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const b = await readBody(req) || {};
        const where = idWhere('gallery_videos', parsed);
        await pool.query(
            `update gallery_videos set
                                       image_url = coalesce($2, image_url),
                                       video_url = coalesce($3, video_url),
                                       url       = coalesce($4, url),
                                       order_index = coalesce($5, order_index),
                                       is_active   = coalesce($6, is_active)
             where ${where.sql}`,
            [where.param,
                str(b.imageUrl ?? b.image_url),
                (b.videoUrl===undefined && b.video_url===undefined && b.url===undefined ? null : str(b.videoUrl ?? b.video_url ?? b.url)),
                (b.url===undefined && b.videoUrl===undefined && b.video_url===undefined ? null : str(b.url ?? b.videoUrl ?? b.video_url)),
                (b.orderIndex===undefined && b.order_index===undefined ? null : num(b.orderIndex ?? b.order_index, 0)),
                (b.isActive===undefined && b.is_active===undefined ? null : bool(b.isActive ?? b.is_active))]
        );
        const q = await pool.query(
            `select id, image_url, video_url, url, order_index, is_active from gallery_videos where ${where.sql}`,
            [where.param]
        );
        return json(res, 200, q.rows[0]);
    }
    if (req.method === 'DELETE' && pathname.startsWith('/admin/gallery-videos/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const where = idWhere('gallery_videos', parsed);
        await pool.query(`delete from gallery_videos where ${where.sql}`, [where.param]);
        return json(res, 200, { ok: true });
    }

// ---------- BACKGROUND VIDEOS ----------
    if (req.method === 'GET' && pathname === '/admin/background-videos') {
        const q = await pool.query(`select id, image_url, video_url, url, order_index, is_active from background_videos order by order_index, id`);
        return json(res, 200, q.rows);
    }
    if (req.method === 'POST' && pathname === '/admin/background-videos') {
        const b = await readBody(req) || {};
        const ins = await pool.query(
            `insert into background_videos (image_url, video_url, url, order_index, is_active)
     values ($1,$2,$3,$4,$5) returning id`,
            [str(b.imageUrl ?? b.image_url), str(b.videoUrl ?? b.video_url ?? b.url), str(b.url ?? b.videoUrl ?? b.video_url),
                num(b.orderIndex ?? b.order_index, 0), bool(b.isActive ?? b.is_active, false)]
        );
        const id = ins.rows[0].id;
        if (bool(b.isActive ?? b.is_active, false)) {
            await pool.query(`update background_videos set is_active=false where id<>$1`, [id]);
            await pool.query(`update background_videos set is_active=true where id=$1`, [id]);
        }
        const q = await pool.query(`select id, image_url, video_url, url, order_index, is_active from background_videos where id=$1`, [id]);
        return json(res, 200, q.rows[0]);
    }
    if (req.method === 'PUT' && pathname.startsWith('/admin/background-videos/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const b = await readBody(req) || {};
        const where = idWhere('background_videos', parsed);
        await pool.query(
            `update background_videos set
                                          image_url = coalesce($2, image_url),
                                          video_url = coalesce($3, video_url),
                                          url       = coalesce($4, url),
                                          order_index = coalesce($5, order_index),
                                          is_active   = coalesce($6, is_active)
             where ${where.sql}`,
            [where.param,
                str(b.imageUrl ?? b.image_url),
                (b.videoUrl===undefined && b.video_url===undefined && b.url===undefined ? null : str(b.videoUrl ?? b.video_url ?? b.url)),
                (b.url===undefined && b.videoUrl===undefined && b.video_url===undefined ? null : str(b.url ?? b.videoUrl ?? b.video_url)),
                (b.orderIndex===undefined && b.order_index===undefined ? null : num(b.orderIndex ?? b.order_index, 0)),
                (b.isActive===undefined && b.is_active===undefined ? null : bool(b.isActive ?? b.is_active))]
        );
        const q = await pool.query(
            `select id, image_url, video_url, url, order_index, is_active from background_videos where ${where.sql}`,
            [where.param]
        );
        return json(res, 200, q.rows[0]);
    }
    if (req.method === 'DELETE' && pathname.startsWith('/admin/background-videos/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const where = idWhere('background_videos', parsed);
        await pool.query(`delete from background_videos where ${where.sql}`, [where.param]);
        return json(res, 200, { ok: true });
    }

// ---------- SERVICES (Admin list + CRUD) ----------
    if (req.method === 'GET' && pathname === '/admin/services') {
        const q = await pool.query(`select id, name, duration_minutes, price, order_index, is_active from services order by order_index, id`);
        // נשמור התאמות camel לצורך UI קיים
        return json(res, 200, q.rows.map(r => ({
            ...r,
            durationMinutes: r.duration_minutes,
            orderIndex: r.order_index,
            isActive: r.is_active,
        })));
    }
    if (req.method === 'POST' && pathname === '/admin/services') {
        const b = await readBody(req) || {};
        const q = await pool.query(
            `insert into services (name, duration_minutes, price, order_index, is_active)
     values ($1,$2,$3,$4,$5) returning id, name, duration_minutes, price, order_index, is_active`,
            [str(b.name), num(b.durationMinutes ?? b.duration ?? 30, 30), (b.price===undefined? null : num(b.price, null)),
                num(b.orderIndex ?? b.order_index, 0), bool(b.isActive ?? b.is_active, true)]
        );
        const r = q.rows[0];
        return json(res, 200, { ...r, durationMinutes: r.duration_minutes, orderIndex: r.order_index, isActive: r.is_active });
    }
    if (req.method === 'PUT' && pathname.startsWith('/admin/services/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const b = await readBody(req) || {};
        const where = idWhere('services', parsed);
        await pool.query(
            `update services set
                                 name = coalesce($2, name),
                                 duration_minutes = coalesce($3, duration_minutes),
                                 price = coalesce($4, price),
                                 order_index = coalesce($5, order_index),
                                 is_active = coalesce($6, is_active)
             where ${where.sql}`,
            [where.param, str(b.name),
                (b.durationMinutes===undefined && b.duration===undefined ? null : num(b.durationMinutes ?? b.duration, 30)),
                (b.price===undefined? null : num(b.price, null)),
                (b.orderIndex===undefined && b.order_index===undefined ? null : num(b.orderIndex ?? b.order_index, 0)),
                (b.isActive===undefined && b.is_active===undefined ? null : bool(b.isActive ?? b.is_active))]
        );
        const q = await pool.query(
            `select id, name, duration_minutes, price, order_index, is_active from services where ${where.sql}`,
            [where.param]
        );
        const r = q.rows[0];
        return json(res, 200, { ...r, durationMinutes: r.duration_minutes, orderIndex: r.order_index, isActive: r.is_active });
    }
    if (req.method === 'DELETE' && pathname.startsWith('/admin/services/')) {
        const idRaw = pathname.split('/').pop();
        const parsed = parseId(idRaw);
        if (!parsed.raw) return json(res, 400, { error: 'Missing id' });
        const where = idWhere('services', parsed);
        await pool.query(`delete from services where ${where.sql}`, [where.param]);
        return json(res, 200, { ok: true });
    }

// ---------- REORDER (drag & drop) ----------
    if (req.method === 'POST' && pathname === '/admin/reorder') {
        const b = await readBody(req) || {};
        const table = String(b.table || '').toLowerCase();
        const whitelist = new Set(['products','testimonials','gallery_videos','background_videos','services']);
        if (!whitelist.has(table)) return json(res, 400, { error: 'Invalid table' });

        const ids = Array.isArray(b.ids) ? b.ids.map(x => String(x)) : [];
        if (ids.length === 0) return json(res, 400, { error: 'Missing ids' });

        const client = await pool.connect();
        try {
            await client.query('begin');
            for (let i = 0; i < ids.length; i++) {
                const parsed = parseId(ids[i]);
                const where = idWhere(table, parsed);
                await client.query(`update ${table} set order_index=$2 where ${where.sql}`, [where.param, i]);
            }
            await client.query('commit');
        } catch (e) {
            await client.query('rollback');
            throw e;
        } finally {
            client.release();
        }
        return json(res, 200, { ok: true });
    }

    /* ---- AUTH stubs ---- */
// ⚠️ מיועד להרשמה: לא בודק שהמספר קיים, רק מחזיר ok (אצלנו קוד דמו 1111)
    if (req.method === 'POST' && pathname === '/auth/request-code') {
        const body = await readBody(req);
        const phoneRaw = body?.phone;
        const { p0, p972 } = phoneDigitsPair(phoneRaw);
        if (!p0 && !p972) return json(res, 400, { ok: false, message: 'MISSING_PHONE' });
        return json(res, 200, { ok: true, channel: 'sms' });
    }

    // בדיקת קיום מספר בטבלת clients
    if (req.method === 'POST' && pathname === '/auth/check-phone') {
        const body = await readBody(req);
        const { p0, p972 } = phoneDigitsPair(body?.phone);
        if (!p0 && !p972) return json(res, 200, { ok: true, exists: false });

        const q = await pool.query(
            `select 1 from clients where regexp_replace(phone, '\\D', '', 'g') in ($1,$2) limit 1`,
            [p0, p972]
        );
        return json(res, 200, { ok: true, exists: !!q.rows[0] });
    }

    // מיועד להתחברות: מחייב שהמספר כבר קיים
    if (req.method === 'POST' && pathname === '/auth/request-code-login') {
        const body = await readBody(req);
        const { p0, p972 } = phoneDigitsPair(body?.phone);
        if (!p0 && !p972) return json(res, 400, { ok: false, message: 'MISSING_PHONE' });

        const q = await pool.query(
            `select 1 from clients where regexp_replace(phone, '\\D', '', 'g') in ($1,$2) limit 1`,
            [p0, p972]
        );
        if (!q.rows[0]) return json(res, 409, { ok: false, message: 'UNREGISTERED_CLIENT' });

        // שולחים קוד דמו (1111)
        return json(res, 200, { ok: true, channel: 'sms' });
    }




// אימות קוד: מאשר רק אם הלקוח קיים ומחזיר את פרטיו
    if (req.method === 'POST' && pathname === '/auth/verify-code') {
        const body = await readBody(req);
        const code = String(body?.code || '');
        const { p0, p972 } = phoneDigitsPair(body?.phone);

        if (!p0 && !p972) return json(res, 400, { ok: false, message: 'MISSING_PARAMS' });
        if (!/^\d{4}$/.test(code)) return json(res, 400, { ok: false, message: 'INVALID_CODE' });

// DEV: קוד דמו (התאם לצורך)
        if (code !== '1111') return json(res, 400, { ok: false, message: 'INVALID_CODE' });

        const q = await pool.query(
            `select id, first_name, last_name, phone
                 from clients
                where regexp_replace(phone, '\\D', '', 'g') in ($1, $2)
                limit 1`,
            [p0, p972]
        );

        if (!q.rows[0]) return json(res, 409, { ok: false, message: 'UNREGISTERED_CLIENT' });

        const c = q.rows[0];
        const authPayload = await buildClientAuthPayload(c);
        return json(res, 200, authPayload);

    }
// הרשמה: מאמת קוד 1111, בודק שאין לקוח קיים, ויוצר לקוח חדש
    if (req.method === 'POST' && pathname === '/auth/register') {
        const body = await readBody(req);
        const code = String(body?.code || '');
        const firstName = String(body?.firstName ?? body?.first_name ?? '').trim();
        const lastName  = String(body?.lastName  ?? body?.last_name  ?? '').trim();
        const rawPhone  = body?.phone;

        const { p0, p972 } = phoneDigitsPair(rawPhone);
        const phone0 = p0; // נשמור בפורמט מקומי "05..."

        if (!phone0) return json(res, 400, { ok: false, message: 'MISSING_PHONE' });
        if (!/^\d{4}$/.test(code)) return json(res, 400, { ok: false, message: 'INVALID_CODE' });
        if (code !== '1111') return json(res, 400, { ok: false, message: 'INVALID_CODE' });
        if (!firstName || !lastName) return json(res, 400, { ok: false, message: 'NAME_REQUIRED' });

        // האם כבר רשום?
        const exists = await pool.query(`select id from clients where phone=$1 limit 1`, [phone0]);
        if (exists.rows[0]) {
            return json(res, 409, { ok: false, message: 'ALREADY_REGISTERED' });
        }

        // יוצרים לקוח
        let newId;
        try {
            const ins = await pool.query(
                `insert into clients (first_name, last_name, phone) values ($1,$2,$3) returning id`,
                [firstName, lastName, phone0]
            );
            newId = ins.rows[0].id;
        } catch (e) {
            // 23505 = יוניק
            if (e?.code === '23505') return json(res, 409, { ok: false, message: 'ALREADY_REGISTERED' });
            throw e;
        }

        // מחזירים payload עקבי
        const authPayload = await buildClientAuthPayload({
            id: newId,
            phone: phone0,
            first_name: firstName,
            last_name: lastName,
        });
        return json(res, 200, authPayload);

    }


    json(res, 404, { error: 'Not Found', pathname });
}

/* ---------- Appointments shape mapper ---------- */
function compatAppointmentRow(r) {
    const service = {
        id: r.service_id || null,
        name: r.service_name || 'שירות',
        durationMinutes: r.duration_minutes || 30,
    };
    const client = {
        id: r.client_id || null,
        firstName: r.first_name || '',
        lastName: r.last_name || '',
        phone: r.phone || '',
    };

    return {
        id: r.id,

        // שדות “ישנים” לתאימות לאחור
        service_id: r.service_id,
        serviceId: r.service_id,
        service_name: r.service_name,
        serviceName: r.service_name,
        duration_minutes: r.duration_minutes,
        durationMinutes: r.duration_minutes,
        client_id: r.client_id,
        clientId: r.client_id,
        client_first_name: r.first_name,
        client_last_name: r.last_name,
        client_phone: r.phone,
        recurring_id: r.recurring_id ?? null,
        recurringId: r.recurring_id ?? null,

        // שדות חדשים ונוחים לשימוש ב-UI
        service,
        client,

        starts_at: r.starts_at,
        startsAt: r.starts_at,
        ends_at: r.ends_at,
        endsAt: r.ends_at,
        status: r.status,
        note: r.note || '',
    };
}

function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('972')) return '0' + digits.slice(3);
    if (digits.length === 9 && digits.startsWith('5')) return '0' + digits;
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    return digits.startsWith('0') ? digits : '0' + digits;
}


async function upsertClient(firstName, lastName, phone, options = {}) {
    const p0 = normalizePhone(phone);
    if (!p0) throw new Error('PHONE_REQUIRED');

    const existing = await pool.query(`
        select id, first_name, last_name, phone, coalesce(is_member,false) as is_member
        from clients
        where phone = $1
        limit 1
    `, [p0]);

    if (existing.rows[0]) {
        const row = existing.rows[0];
        const desiredFirst = firstName ? String(firstName) : row.first_name;
        const desiredLast  = lastName  ? String(lastName)  : row.last_name;
        if (desiredFirst !== row.first_name || desiredLast !== row.last_name) {
            await pool.query(`update clients set first_name=$2, last_name=$3 where id=$1`, [row.id, desiredFirst, desiredLast]);
            row.first_name = desiredFirst;
            row.last_name = desiredLast;
        }
        return { id: row.id, is_member: !!row.is_member };
    }

    const isMember = parseBoolean(options.is_member ?? options.isMember, false);
    const ins = await pool.query(
        `insert into clients (first_name, last_name, phone, is_member)
         values ($1,$2,$3,$4)
         returning id, coalesce(is_member,false) as is_member`,
        [String(firstName || ''), String(lastName || ''), p0, isMember]
    );
    return { id: ins.rows[0].id, is_member: !!ins.rows[0].is_member };
}

const RETENTION_DAYS = 7;

async function pruneOldRecords() {
    try {
        await pool.query(`delete from appointments where ends_at < now() - interval '${RETENTION_DAYS} days'`);
        await pool.query(
            `delete from waiting_list where desired_starts_at < now() - interval '${RETENTION_DAYS} days'`
        );
        await pool.query(
            `delete from blocked_times where coalesce(end_at, start_at) < now() - interval '${RETENTION_DAYS} days'`
        );
    } catch (e) {
        console.error('[pruneOldRecords]', e);
    }
}


/* ---------- Start ---------- */
async function start() {
    try {
        await migrate();
        await ensureUploadsDir();
        await pruneOldRecords();
        const server = http.createServer((req, res) =>
            router(req, res).catch((err) => {
                console.error('[router error]', err);
                json(res, 500, { error: 'Server Error', message: String(err?.message || err) });
            })
        );
        server.listen(PORT, () => {
            setInterval(pruneOldRecords, 6 * 60 * 60 * 1000); // כל 6 שעות
            console.log(`API running on http://localhost:${PORT}`);
        });
    } catch (e) {
        console.error('Failed to bootstrap DB', e);
        process.exit(1);
    }
}

start();
