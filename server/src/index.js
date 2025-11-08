// server/src/index.js
// Minimal API with Postgres; tolerant migrations for existing DBs (camelCase/snake_case + missing cols).

require('dotenv').config();

const http = require('http');
const { Pool } = require('pg');
const { URL } = require('url');
const fs = require('fs');
const fsp = fs.promises;
const pathLib = require('path');
const Busboy = require('busboy');

const UPLOAD_DIR = pathLib.resolve(__dirname, '..', 'uploads');

const ADMIN_PANEL_CODE = process.env.ADMIN_PANEL_CODE || '12345';

function normalizePhone(raw = "") {
    const d = String(raw).replace(/\D/g, "");
    // תמיכה בשני פורמטים נפוצים בארץ: 05… או 9725…
    if (d.startsWith("972") && d.length >= 11) return "0" + d.slice(3);
    if (d.startsWith("0")) return d;
    return d; // fallback
}
const ADMIN_PHONES = ["0537002171", "0523767851"].map(normalizePhone);

function isAdminPhone(phone) {
    return ADMIN_PHONES.includes(normalizePhone(phone));
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

    // --- helper to read a column type from information_schema ---
    async function getColumnUdtName(table, column) {
        const q = await pool.query(`
            select udt_name
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = $1
              and column_name = $2
                limit 1
        `, [table, column]);
        return q.rows[0]?.udt_name || null; // e.g. 'uuid', 'int4', 'int8'
    }
    function udtToDDL(udt) {
        return udt === 'uuid' ? 'uuid' : udt === 'int8' ? 'bigint' : 'int';
    }

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


    // ----- שמירה על תאימות קיימת בשאר הטבלאות -----
    await ensureColumn('clients', 'is_member', 'boolean default false');
    await pool.query(`update clients set is_member = coalesce(is_member, false)`);
    await pool.query(`alter table clients alter column is_member set default false`);
    await pool.query(`alter table clients alter column is_member set not null`);

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
const DEFAULT_HOURS = [
    { weekday: 0, open: '10:00', close: '19:00', slot: 30, isOpen: true },
    { weekday: 1, open: '10:00', close: '19:00', slot: 30, isOpen: true },
    { weekday: 2, open: '10:00', close: '19:00', slot: 30, isOpen: true },
    { weekday: 3, open: '10:00', close: '19:00', slot: 30, isOpen: true },
    { weekday: 4, open: '10:00', close: '19:00', slot: 30, isOpen: true },
    { weekday: 5, open: '08:00', close: '15:00', slot: 30, isOpen: true },
    { weekday: 6, open: null,     close: null,    slot: 30, isOpen: false },
];
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

    // --- Admin Guard: מחייב אדמין לכל /admin/* ---
    if (pathname.startsWith('/admin/')) {
        // בלי JWT כרגע: נסתמך על כותרת (header) או על query param
        const phoneHeader = req.headers['x-client-phone'];
        const phoneQuery  = url.searchParams.get('phone');
        const phone = phoneHeader || phoneQuery;

        if (!phone || !isAdminPhone(phone)) {
            return json(res, 403, { error: 'Unauthorized (admin only)' });
        }
        // אם עברנו, מותר להמשיך ל-handlers של /admin/...
    }

    // POST /admin/verify-code  (דורש אדמין לפי ה-Guard + קוד נכון)
    if (pathname === '/admin/verify-code' && req.method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const code = (body && (body.code || body.adminCode || body.pin)) || '';
        if (String(code) === String(ADMIN_PANEL_CODE)) {
            return json(res, 200, { ok: true });
        }
        return json(res, 401, { ok: false, error: 'INVALID_ADMIN_CODE' });
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

    // GET /clients – כל הלקוחות + תאריך תור אחרון
    if (req.method === 'GET' && pathname === '/clients') {
        const q = await pool.query(`
          select c.id, c.first_name, c.last_name, c.phone, coalesce(c.is_member,false) as is_member,
                 (select max(a.starts_at) from appointments a where a.client_id = c.id) as last_appointment_at
          from clients c
          order by c.id desc
           `);
        const rows = q.rows.map(r => ({
            id: r.id,
            first_name: r.first_name || '',
            last_name:  r.last_name  || '',
            phone:      r.phone      || '',
            firstName:  r.first_name || '',
            lastName:   r.last_name  || '',
            is_member:  !!r.is_member,
            isMember:   !!r.is_member,
            lastAppointmentAt: r.last_appointment_at || null,
        }));
        return json(res, 200, rows);
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

        const where = idWhere('clients', parsed);
        const currentQ = await pool.query(
            `select id, first_name, last_name, phone, coalesce(is_member,false) as is_member from clients where ${where.sql}`,
            [where.param]
        );
        const current = currentQ.rows[0];
        if (!current) return json(res, 404, { error: 'CLIENT_NOT_FOUND' });

        const body = await readBody(req) || {};

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
        const val = body?.value ?? null;
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

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((start.getTime() - today.getTime()) / 86400000);
        const maxAdvance = clientIsMember ? 14 : 7;
        if (diffDays > maxAdvance) {
            return json(res, 400, { error: 'ADVANCE_LIMIT_EXCEEDED', maxDays: maxAdvance });
        }

        const ins = await pool.query(
            `insert into appointments (service_id, client_id, starts_at, ends_at, status, note)
             values ($1,$2,$3,$4,$5,$6) returning id`,
            [serviceId, clientId, start, end, 'booked', note]
        );
        return json(res, 200, { id: ins.rows[0].id });
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
          select a.id, a.starts_at, a.ends_at, a.status, a.note,
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

        const d = new Date(date + 'T00:00:00');
        if (Number.isNaN(d.getTime())) return json(res, 200, []);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((d.getTime() - today.getTime()) / 86400000);
        const maxAdvance = isMember ? 14 : 7;
        if (diffDays > maxAdvance) return json(res, 200, []);

        let duration = 30;
        const s = await pool.query(`select duration_minutes from services where id=$1`, [serviceId]);
        if (s.rows[0]?.duration_minutes) duration = Number(s.rows[0].duration_minutes) || 30;

        const weekday = d.getDay();
        const bh = DEFAULT_HOURS.find(x => x.weekday === weekday);
        if (!bh?.isOpen) return json(res, 200, []);

        const open = toLocalDateTime(date, bh.open);
        const close = toLocalDateTime(date, bh.close);

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

        const slots = [];
        for (let t = new Date(open); t.getTime() + duration * 60000 <= close.getTime(); t = new Date(t.getTime() + bh.slot * 60000)) {
            const slotStart = new Date(t);
            const slotEnd = new Date(t.getTime() + duration * 60000);
            const overlaps = busy.some(b => b.start < slotEnd && b.end > slotStart);
            if (!overlaps) slots.push(formatHHmm(slotStart));
        }
        return json(res, 200, slots);
    }


    /* ---- BLOCKS ---- */
    if (req.method === 'GET' && pathname === '/admin/blocked-times') {
        const q = await pool.query(`
            select id, start_at, end_at, reason, coalesce(members_only,false) as members_only
            from blocked_times
            order by start_at desc
        `);
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
        const overlap = await pool.query(`
    select a.id, a.starts_at, a.ends_at,
           coalesce(nullif(trim(c.first_name || ' ' || c.last_name), ''), 'לקוח') as client_name
    from appointments a
    left join clients c on c.id = a.client_id
    where coalesce(a.status,'booked') <> 'canceled'
      and a.starts_at < $2
      and a.ends_at   > $1
    order by a.starts_at
    limit 20
  `, [s, e]);

        if (overlap.rowCount > 0) {
            return json(res, 409, {
                error: 'יש תורים קיימים בתוך הטווח – בטל/י אותם לפני חסימה.',
                conflicts: overlap.rows.map(r => ({
                    id: r.id,
                    starts_at: r.starts_at,
                    ends_at: r.ends_at,
                    client_name: r.client_name || ''
                }))
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

        return json(res, 200, {
            ok: true,
            client: {
                id: c.id,
                phone: c.phone,
                firstName: c.first_name || '',
                lastName:  c.last_name  || '',
                first_name: c.first_name || '',
                last_name:  c.last_name  || '',
                isAdmin: isAdminPhone(c.phone)
            }
        });

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
        return json(res, 200, {
            ok: true,
            client: {
                id: newId,
                phone: phone0,
                firstName,
                lastName,
                first_name: firstName,
                last_name: lastName,
                isAdmin: isAdminPhone(phone0)
            },
            token: 'dev-token'
        });

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

        // שדות חדשים ונוחים לשימוש ב-UI
        service,
        client,

        starts_at: r.starts_at,
        ends_at: r.ends_at,
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

async function pruneOldAppointments() {
    try {
        await pool.query(`delete from appointments where ends_at < now() - interval '7 days'`);
    } catch (e) {
        console.error('[pruneOldAppointments]', e);
    }
}


/* ---------- Start ---------- */
async function start() {
    try {
        await migrate();
        await ensureUploadsDir();
        await pruneOldAppointments();
        const server = http.createServer((req, res) =>
            router(req, res).catch((err) => {
                console.error('[router error]', err);
                json(res, 500, { error: 'Server Error', message: String(err?.message || err) });
            })
        );
        server.listen(PORT, () => {
            setInterval(pruneOldAppointments, 6 * 60 * 60 * 1000); // כל 6 שעות
            console.log(`API running on http://localhost:${PORT}`);
        });
    } catch (e) {
        console.error('Failed to bootstrap DB', e);
        process.exit(1);
    }
}

start();