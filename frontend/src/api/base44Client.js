// src/api/base44Client.js

import { setStoredAuthToken, getStoredAuthToken, clearStoredAuth } from '@/utils/authStorage';


const ENV_BASE =
    (import.meta?.env?.VITE_API_BASE) ||
    (import.meta?.env?.VITE_API_URL) ||
    (typeof window !== 'undefined' && (window.API_ROOT || window.BASE44_API_ROOT)) ||
    'http://localhost:3001';

const BASE_URL = ENV_BASE;

export const API_ROOT = ENV_BASE;


// האם יש ראוטי אדמין ל־appointments בשרת?
const HAS_ADMIN_APPOINTMENTS =
    ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_HAS_ADMIN_APPOINTMENTS) || 'false')
        .toString().toLowerCase() === 'true';

function getStoredClientPhone() {
  try {
    if (typeof localStorage === 'undefined') return '';
    const raw = localStorage.getItem('familiaClient');
    const parsed = raw ? JSON.parse(raw) : null;
    const phone = parsed?.phone || parsed?.client_phone || '';
    return normalizePhone(phone);
  } catch {
    return '';
  }
}

function authHeaders(base = {}) {
  const headers = { ...(base || {}) };
  const token = getStoredAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const phone = getStoredClientPhone();
  if (phone) {
    headers['X-Client-Phone'] = phone;
  }
  return headers;
}

function handleUnauthorized(status, path, payload) {
  if (status !== 401) return;

  // נקה רק כאשר זה auth endpoints (או מקרה שאתה באמת רוצה logout)
  if (String(path || '').startsWith('/auth/')) {
    clearStoredAuth();
    try { localStorage.removeItem('familiaClient'); } catch {}
  }
}



/* ---------------- low-level HTTP (GET tolerates 404) ---------------- */

// ---------------- Simple GET cache with TTL ----------------
const __getCache = new Map();
const __storagePrefix = 'familia_api_cache::';

function __cacheKey(path, headers) {
  // Base URL + path is enough; if you want, add auth header to avoid cross-user mixing
  const auth = (headers && (headers.Authorization || headers.authorization)) || '';
  return String(BASE_URL) + String(path) + '::' + String(auth);
}

export function invalidateCacheByPathPrefix(prefix) {
  const normalized = String(prefix || '');
  if (!normalized) return;
  const match = String(BASE_URL) + normalized;
  for (const key of __getCache.keys()) {
    if (key.startsWith(match)) {
      __getCache.delete(key);
    }
  }
}

function __defaultTtlMs(path) {
  const p = String(path || '');
  // זמינות משתנה מהר -> TTL קצר
  if (p.startsWith('/appointments/available')) return 15_000; // 15s
  // דברים יחסית סטטיים (30-120s)
  if (p.startsWith('/services')) return 60_000; // 60s
  if (p.startsWith('/products')) return 60_000; // 60s
  if (p.startsWith('/gallery-videos')) return 60_000; // 60s
  if (p.startsWith('/background-videos')) return 60_000; // 60s
  if (p.startsWith('/testimonials')) return 60_000; // 60s
  if (p.startsWith('/business-hours')) return 60_000; // 60s
  if (p.startsWith('/settings/')) return 60_000; // 60s
  return 0; // ברירת מחדל: בלי cache
}

function __shouldPersist(path) {
  const p = String(path || '');
  return (
    p.startsWith('/services') ||
    p.startsWith('/products') ||
    p.startsWith('/gallery-videos') ||
    p.startsWith('/background-videos') ||
    p.startsWith('/testimonials') ||
    p.startsWith('/business-hours') ||
    p.startsWith('/settings/')
  );
}

function __getCached(key, path) {
  const entry = __getCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    __getCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function __storageKey(key) {
  return __storagePrefix + key;
}

function __readStorageCache(key) {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const raw = localStorage.getItem(__storageKey(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(__storageKey(key));
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function __writeStorageCache(key, value, ttlMs) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(__storageKey(key), JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
  } catch {
    // ignore storage failures
  }
}

function __setCached(key, value, ttlMs, path) {
  if (!ttlMs || ttlMs <= 0) return;
  __getCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (__shouldPersist(path)) {
    __writeStorageCache(key, value, ttlMs);
  }
}


async function httpGet(path, options = {}) {
  const headers = authHeaders();
  const signal = options?.signal;

  const ttlMs =
      typeof options.cacheTtlMs === 'number'
          ? options.cacheTtlMs
          : __defaultTtlMs(path);

  const key = __cacheKey(path, headers);

  // TTL cache HIT
  if (ttlMs > 0) {
    const cached = __getCached(key, path);
    if (cached !== undefined) return cached;
    if (__shouldPersist(path)) {
      const stored = __readStorageCache(key);
      if (stored !== undefined) {
        __getCache.set(key, { value: stored.value, expiresAt: stored.expiresAt });
        return stored.value;
      }
    }
  }

  const res = await fetch(String(BASE_URL) + String(path), {
    method: 'GET',
    headers,
    signal,
    // ✅ מונע מצב שהדפדפן יחזיר 304 בלי body
    cache: 'no-store',
  });

  // ✅ אם בכל זאת הגיע 304 — נחזיר מה-cache שלנו
  if (res.status === 304) {
    const cached = __getCached(key, path);
    if (cached !== undefined) return cached;
    return null;
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (res.status === 404) return null;

  const isJson = ct.indexOf('application/json') !== -1;
  const payload = isJson ? await safeJson(res) : null;

  if (!res.ok) {
    handleUnauthorized(res.status, path, payload);
    const err = buildHttpError('GET', path, res.status, payload);
    console.error('[API GET ' + path + ']', err);
    throw err;
  }

  // TTL cache SET
  if (ttlMs > 0) __setCached(key, payload, ttlMs, path);

  return payload;
}


async function httpPost(path, body) {
  const headers = authHeaders({ 'Content-Type': 'application/json' });
  const res = await fetch(String(BASE_URL) + String(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = ct.indexOf('application/json') !== -1;
  const payload = isJson ? await safeJson(res) : null;

  if (!res.ok) {
    handleUnauthorized(res.status, path, payload);
    const err = buildHttpError('POST', path, res.status, payload);
    console.error('[API POST ' + path + ']', err);
    throw err;
  }
  return payload;
}

async function httpPut(path, body) {
  const headers = authHeaders({ 'Content-Type': 'application/json' });
  const res = await fetch(String(BASE_URL) + String(path), {
    method: 'PUT',
    headers,
    body: JSON.stringify(body || {}),
  });

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = ct.indexOf('application/json') !== -1;
  const payload = isJson ? await safeJson(res) : null;

  if (!res.ok) {
    handleUnauthorized(res.status, path, payload);
    const err = buildHttpError('PUT', path, res.status, payload);
    console.error('[API PUT ' + path + ']', err);
    throw err;
  }
  return payload;
}

async function httpDelete(path) {
  const headers = authHeaders();
  const res = await fetch(String(BASE_URL) + String(path), {
    method: 'DELETE',
    headers,
  });

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = ct.indexOf('application/json') !== -1;
  const payload = isJson ? await safeJson(res) : null;

  if (!res.ok) {
    handleUnauthorized(res.status, path, payload);
    const err = buildHttpError('DELETE', path, res.status, payload);
    console.error('[API DELETE ' + path + ']', err);
    throw err;
  }
  return payload;
}

async function httpPatch(path, body) {
  const headers = authHeaders({ 'Content-Type': 'application/json' });
  const res = await fetch(String(BASE_URL) + String(path), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body || {}),
  });

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = ct.indexOf('application/json') !== -1;
  const payload = isJson ? await safeJson(res) : null;

  if (!res.ok) {
    handleUnauthorized(res.status, path, payload);
    const err = buildHttpError('PATCH', path, res.status, payload);
    console.error('[API PATCH ' + path + ']', err);
    throw err;
  }
  return payload;
}



async function httpFormPost(path, data) {
  const params = new URLSearchParams();
  Object.entries(data || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) params.append(k, String(v));
  });

  const headers = authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' });

  const res = await fetch(String(BASE_URL) + String(path), {
    method: 'POST',
    headers,
    body: params.toString(),
  });

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = ct.includes('application/json');
  const payload = isJson ? await safeJson(res) : null;

  if (!res.ok) {
    handleUnauthorized(res.status);
    const err = buildHttpError('POST', path, res.status, payload);
    console.error('[API POST FORM ' + path + ']', err);
    throw err;
  }
  return payload;
}



/* ---- helpers: parse & error shape ---- */
async function safeJson(res) {
  try { return await res.json(); } catch (e) { return null; }
}

function pick(obj, key, alt, defVal) {
  // מקבילה בטוחה ל-obj?.key ?? obj?.alt ?? defVal
  if (obj && typeof obj === 'object') {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    if (alt && obj[alt] !== undefined && obj[alt] !== null) return obj[alt];
  }
  return defVal;
}

function buildHttpError(method, path, status, payload) {
  const codeFromPayload =
      (payload && (payload.code || (payload.error && payload.error.code))) ||
      (payload && typeof payload.message === 'string' ? payload.message : undefined);

  const err = new Error(codeFromPayload || ('HTTP ' + String(status)));
  err.status = status;
  err.payload = payload || null;

  if (status === 409 && (codeFromPayload === 'UNREGISTERED_CLIENT' || payload === 'UNREGISTERED_CLIENT' || (payload && payload.message === 'UNREGISTERED_CLIENT'))) {
    err.code = 'UNREGISTERED_CLIENT';
  } else if (status === 409 && (codeFromPayload === 'ALREADY_REGISTERED' || (payload && payload.message === 'ALREADY_REGISTERED'))) {
    err.code = 'ALREADY_REGISTERED';
  } else if (status === 400 && (codeFromPayload === 'NAME_REQUIRED' || (payload && payload.message === 'NAME_REQUIRED'))) {
    err.code = 'NAME_REQUIRED';
  } else if (status === 400 && (codeFromPayload === 'Invalid code' || (payload && payload.message === 'Invalid code'))) {
    err.code = 'INVALID_CODE';
  } else if (status === 401) {
    err.code = 'UNAUTHORIZED';
  } else {
    err.code = codeFromPayload || ('HTTP_' + String(status));
  }
  return err;
}

function normalizeDateForApi(date) {
  if (!date) return '';
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return String(date); // yyyy-MM-dd
  const m = String(date).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // dd/MM/yyyy
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('972')) return '0' + digits.slice(3);
  if (digits.length === 9 && digits.startsWith('5')) return '0' + digits;
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  return digits.startsWith('0') ? digits : '0' + digits;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; // YYYY-MM-DD בלוקאלי
}
function localTimeStr(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; // HH:mm בלוקאלי
}

const toLocalYmd = (date) => {
  if (!(date instanceof Date)) return String(date || '').slice(0, 10);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};



/* ---------------- helpers: dual snake/camel fields ---------------- */
function both(obj, snake, camel, def) {
  var a = (obj && obj[snake] !== undefined) ? obj[snake] : ((obj && obj[camel] !== undefined) ? obj[camel] : def);
  var b = (obj && obj[camel] !== undefined) ? obj[camel] : ((obj && obj[snake] !== undefined) ? obj[snake] : def);
  var r = {};
  r[snake] = a;
  r[camel] = b;
  return r;
}
function mapArr(arr, fn) { return Array.isArray(arr) ? arr.map(fn) : []; }

/* ---- normalizers ---- */
function normService(s) {
  s = s || {};
  return Object.assign({}, s,
      both(s, 'order_index', 'orderIndex', 0),
      both(s, 'is_active', 'isActive', true),
      {
        duration: (s.duration !== undefined ? s.duration : s.durationMinutes),
        durationMinutes: (s.durationMinutes !== undefined ? s.durationMinutes : s.duration),
      }
  );
}
var normServiceArr = function (a) { return mapArr(a, normService); };

function normOrdAct(x) {
  x = x || {};
  return Object.assign({}, x,
      both(x, 'order_index', 'orderIndex', 0),
      both(x, 'is_active', 'isActive', true)
  );
}
var normOrdActArr = function (a) { return mapArr(a, normOrdAct); };

function normTestimonialRow(x) {
  const base = normOrdAct(x);
  const content = (x?.content ?? x?.text ?? '').toString();
  const text = x?.text ?? content;
  const rating = Number.isFinite(Number(base.rating)) ? Number(base.rating) : 5;
  return { ...base, content, text, rating };
}
const normTestimonialArr = (a) => Array.isArray(a) ? a.map(normTestimonialRow) : [];

function normMedia(x) {
  x = x || {};
  var image = pick(x, 'image_url', 'imageUrl', undefined);
  var video = pick(x, 'video_url', 'videoUrl', undefined);
  if (video === undefined) video = x.url;

  var base = normOrdAct(x);
  var withImg = both({ image_url: image, imageUrl: image }, 'image_url', 'imageUrl', undefined);
  var withVid = both({ video_url: video, videoUrl: video }, 'video_url', 'videoUrl', undefined);

  var out = Object.assign({}, base, withImg, withVid);
  out.url = (video !== undefined && video !== null) ? video : x.url;
  return out;
}
var normMediaArr = function (a) { return mapArr(a, normMedia); };

function normSetting(s) {
  if (!s) return null;
  return Object.assign({}, s, {
    key: s.key || s.name || s.id || null,
    value: (s.value !== undefined ? s.value : (s.val !== undefined ? s.val : null)),
  });
}

// הוסף/עדכן את הנרמלר אם עדיין לא קיים
function normAppointment(x) {
  x = x || {};
  const nestedFirst = (x.client && (x.client.firstName || x.client.first_name)) || '';
  const nestedLast  = (x.client && (x.client.lastName  || x.client.last_name))  || '';
  const nestedName  = (x.client && (x.client.name || `${nestedFirst} ${nestedLast}`.trim())) || '';
  const nestedPhone = (x.client && (x.client.phone || x.client.client_phone)) || '';

  const out = Object.assign({}, x,
      both(x, 'starts_at', 'startsAt', x.starts_at),
      both(x, 'ends_at',   'endsAt',   x.ends_at),
      both({ client_name:  x.client_name  ?? x.clientName  ?? nestedName  }, 'client_name',  'clientName',  ''),
      both({ client_phone: x.client_phone ?? x.clientPhone ?? x.phone ?? nestedPhone }, 'client_phone', 'clientPhone', '')
  );

  if (!out.client) {
    out.client = { name: out.client_name, phone: out.client_phone };
  }
  return out;
}
const normAppointmentArr = (a) => Array.isArray(a) ? a.map(normAppointment) : [];

/* ---- input mappers (accept snake or camel) ---- */
function toServiceBody(b) {
  b = b || {};
  return {
    name: b.name,
    durationMinutes: (b.durationMinutes !== undefined ? b.durationMinutes : b.duration),
    price: b.price,
    orderIndex: (b.orderIndex !== undefined ? b.orderIndex : (b.order_index !== undefined ? b.order_index : 0)),
    isActive: (b.isActive !== undefined ? b.isActive : (b.is_active !== undefined ? b.is_active : true)),
  };
}
function toProductBody(b) {
  b = b || {};
  return {
    name: b.name,
    price: b.price,
    imageUrl: (b.imageUrl !== undefined ? b.imageUrl : b.image_url),
    orderIndex: (b.orderIndex !== undefined ? b.orderIndex : (b.order_index !== undefined ? b.order_index : 0)),
    isActive: (b.isActive !== undefined ? b.isActive : (b.is_active !== undefined ? b.is_active : true)),
  };
}
function toTestimonialBody(b) {
  b = b || {};
  const content = (b.content ?? b.text ?? '').toString();
  return {
    author: b.author,
    rating: b.rating,
    content,
    text: content,
    orderIndex: (b.orderIndex !== undefined ? b.orderIndex : (b.order_index !== undefined ? b.order_index : 0)),
    isActive: (b.isActive !== undefined ? b.isActive : (b.is_active !== undefined ? b.is_active : true)),
  };
}
function toGalleryBody(b) {
  b = b || {};
  return {
    videoUrl: (b.videoUrl !== undefined ? b.videoUrl : (b.video_url !== undefined ? b.video_url : b.url)),
    orderIndex: (b.orderIndex !== undefined ? b.orderIndex : (b.order_index !== undefined ? b.order_index : 0)),
    isActive: (b.isActive !== undefined ? b.isActive : (b.is_active !== undefined ? b.is_active : true)),
  };
}
function toBackgroundBody(b) {
  b = b || {};
  return {
    videoUrl: (b.videoUrl !== undefined ? b.videoUrl : (b.video_url !== undefined ? b.video_url : b.url)),
    orderIndex: (b.orderIndex !== undefined ? b.orderIndex : (b.order_index !== undefined ? b.order_index : 0)),
    isActive: (b.isActive !== undefined ? b.isActive : (b.is_active !== undefined ? b.is_active : false)),
  };
}

/* ---------------- API (with fallbacks) ---------------- */
const api = {
  Service: {
    list: async () => normServiceArr((await httpGet('/services')) || []),
    adminList: async () => normServiceArr((await httpGet('/admin/services')) || []),
    create: async (data) => {
      const res = normService(await httpPost('/admin/services', toServiceBody(data)));
      invalidateCacheByPathPrefix('/services');
      return res;
    },
    update: async (id, data) => {
      const res = normService(await httpPut('/admin/services/' + encodeURIComponent(id), toServiceBody(data)));
      invalidateCacheByPathPrefix('/services');
      return res;
    },
    remove: async (id) => {
      const res = await httpDelete('/admin/services/' + encodeURIComponent(id));
      invalidateCacheByPathPrefix('/services');
      return res;
    },
  },

  Appointment: {
    getAvailable: async (serviceOrId, date, options = {}) => {
      const sid =
          (typeof serviceOrId === 'string' || typeof serviceOrId === 'number')
              ? String(serviceOrId)
              : (serviceOrId && serviceOrId.id ? String(serviceOrId.id) : '');

      const day = normalizeDateForApi(date);
      if (!sid || !day) return [];

      const params = new URLSearchParams({
        serviceId: sid,
        date: day,
      });

      const memberFlag = options?.isMember ?? options?.member ?? options?.members ?? undefined;
      if (memberFlag !== undefined) {
        params.set('isMember', memberFlag ? 'true' : 'false');
      }

      return (await httpGet('/appointments/available?' + params.toString())) || [];
    },

    // list – קודם ציבורי, פולבק ל־admin
    list: async (sort) => {
      try {
        if (HAS_ADMIN_APPOINTMENTS) {
          const a = await httpGet('/admin/appointments');
          if (Array.isArray(a)) return a;
        }
        const b = await httpGet('/appointments');
        return Array.isArray(b) ? b : [];
      } catch (e) {
        const b = await httpGet('/appointments').catch(() => []);
        return Array.isArray(b) ? b : [];
      }
    },

    // >>> החלפה מלאה מכאן <<<
    create: async (payload) => {
      payload = payload || {};

      // --- בנייה למסלול הציבורי /appointments ---
      // תאריך/שעה: נקבל או מ-date/time או מ-starts_at
      const startInput = payload.starts_at || payload.date || null;
      const start = startInput ? new Date(startInput) : null;

      // אם אין date/time מפורשים — נחלץ מ-start (אם קיים)
      const date =
          (payload.date && normalizeDateForApi(payload.date)) ||
          (start && !Number.isNaN(start.getTime()) ? localDateStr(start) : '');

      const time =
          (payload.time && String(payload.time).slice(0, 5)) || // "HH:mm"
          (start && !Number.isNaN(start.getTime()) ? localTimeStr(start) : '');

      // שירות
      const serviceId =
          payload.service_id ??
          payload.serviceId ??
          (payload.service && payload.service.id) ??
          null;

      // --- שם הלקוח (fallback מה-localStorage אם ה-UI לא שלח) ---
      const typedName = String(payload.client_name || payload.clientName || '').trim();
      const shouldUseStoredClient = payload.createClient !== false;

      let storedName = '';
      let storedFirst = '';
      let storedLast = '';
      if (shouldUseStoredClient) {
        try {
          const raw = localStorage.getItem('familiaClient');
          if (raw) {
            const c = JSON.parse(raw);
            storedName = String(c.client_name || c.name || '').trim();
            storedFirst = String(c.firstName || c.first_name || '').trim();
            storedLast = String(c.lastName || c.last_name || '').trim();
          }
        } catch {}
      }

      const finalName = typedName || storedName;

      const parts = finalName ? finalName.split(/\s+/) : [];
      const firstName = String(
          payload.firstName ||
          payload.client_first_name ||
          (parts[0] || '') ||
          storedFirst
      ).trim();

      const lastName = String(
          payload.lastName ||
          payload.client_last_name ||
          (parts.slice(1).join(' ') || '') ||
          storedLast
      ).trim();

      // טלפון — נכסה את כל הווריאציות האפשריות וננרמל
      const rawPhone =
          (payload.client && (payload.client.phone || payload.client.client_phone)) ??
          payload.client_phone ??
          payload.clientPhone ??
          payload.phone ??
          '';

      const phone = normalizePhone(rawPhone);

      // ולידציה מקומית כדי לא לקבל 400 “חסרים שדות”
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('DATE_REQUIRED');
      }
      if (!time || !/^\d{2}:\d{2}$/.test(time)) {
        throw new Error('TIME_REQUIRED');
      }
      if (!phone || !/^\d{9,10}$/.test(phone)) {
        throw new Error('PHONE_REQUIRED');
      }
      if (!firstName || !lastName) {
        // אם אין שם מה-UI וגם אין מה-localStorage
        throw new Error('NAME_REQUIRED');
      }

      const publicBody = {
        serviceId,
        date, // YYYY-MM-DD
        time, // HH:mm
        note: payload.note,
        client: { firstName, lastName, phone },
        client_name: finalName,
        is_guest: true,
        // גיבוי כפול (לא חובה, אבל עוזר לשרתים שמצפים לשדות שטוחים):
        phone,
      };

      const res = await httpPost('/appointments', publicBody);
      return normAppointment(res);
    },


    update: async (id, data) => {
      data = data || {};
      if (data.starts_at || data.ends_at) {
        const res = await api.Admin.reschedule(id, data.starts_at, data.ends_at);
        return normAppointment(res);
      }
      const res = await httpPut('/admin/appointments/' + encodeURIComponent(id), data);
      return normAppointment(res);
    },

    // delete – קודם ציבורי, פולבק ל-admin
    delete: async (id) => {
      try {
        return await httpDelete('/appointments/' + encodeURIComponent(id));
      } catch (e) {
        if (e && e.status === 404) {
          return await httpDelete('/admin/appointments/' + encodeURIComponent(id));
        }
        throw e;
      }
    },

    listMine: () => {
      const phone = getStoredClientPhone();
      const q = phone ? `?phone=${encodeURIComponent(phone)}` : '';
      return httpGet('/clients/me/appointments' + q);
    },
  },

  WaitingList: {
    join: ({ clientId, date, time, serviceId }) =>
        httpPost('/waiting-list', { clientId: clientId, desired_date: date, desired_time: time, serviceId: serviceId }),
    listByDate: (date) => httpGet('/waiting-list?date=' + encodeURIComponent(date || '')),
    listMine: () => httpGet('/waiting-list/mine'),
    removeMine: (id) => httpDelete('/waiting-list/mine/' + encodeURIComponent(id)),
  },

  BusinessHours: {
    list: async () => {
      try {
        const res = await httpGet('/business-hours');
        return Array.isArray(res) ? res : [];
      } catch (error) {
        if (error?.status === 403 || error?.status === 404) {
          return [];
        }
        throw error;
      }
    },
    get: async () => {
      return api.BusinessHours.list();
    },
    updateAll: async (rows) => {
      const payload = Array.isArray(rows) ? rows : [];
      const res = await httpPut('/admin/business-hours', { hours: payload });
      invalidateCacheByPathPrefix('/business-hours');
      return Array.isArray(res) ? res : payload;
    },
    update: async (rows) => api.BusinessHours.updateAll(rows),
  },

  Admin : {
    // מחזיר רשימת תורים ליום מסוים (פורמט YYYY-MM-DD)
    appointmentsByDate: (date) => {
      const d = toLocalYmd(date);
      return httpGet('/admin/appointments?date=' + encodeURIComponent(d));
    },

    // שינוי מועד תור קיים (מקבל ISO מלאים)
    reschedule: (id, newStartAtIso, newEndAtIso) => {
      return httpPost('/admin/appointments/reschedule', {
        id,
        newStartAt: String(newStartAtIso),
        newEndAt:   String(newEndAtIso),
      });
    },

    appointments: {
      async delete(id) {
        return api.delete(`/admin/appointments/${id}`);
      },
      async createRecurring(id, intervalWeeks) {
        return httpPost(`/admin/appointments/${encodeURIComponent(id)}/recurring`, {
          intervalWeeks,
        });
      },
      async cancelRecurring(id) {
        return httpDelete(`/admin/recurring-appointments/${encodeURIComponent(id)}`);
      },
    },

    blocks: {
      list: (date) => {
        const toYmdLocal = (dt) => {
          const d = dt instanceof Date ? dt : new Date(dt);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };

        const q = date ? `?date=${encodeURIComponent(toYmdLocal(date))}` : '';
        return httpGet('/admin/blocked-times' + q);
      },

      // נסיונות מדורגים: JSON camel -> FORM camel -> FORM snake
      add: async (startIso, endIso, reason, membersOnly = false) => {
        return await httpPost('/admin/blocked-times', {
          starts_at: String(startIso),
          ends_at:   String(endIso),
          reason:    reason ?? '',
          members_only: Boolean(membersOnly),
        });
      },

      update: async (id, startIso, endIso, reason, membersOnly = false) => {
        return await httpPut('/admin/blocked-times/' + encodeURIComponent(id), {
          starts_at: String(startIso),
          ends_at:   String(endIso),
          reason:    reason ?? '',
          members_only: Boolean(membersOnly),
        });
      },

      remove: (id) => httpDelete('/admin/blocked-times/' + encodeURIComponent(id)),
    }
  },

  Product: {
    list: async (options = {}) => normMediaArr((await httpGet('/products', options)) || []),
    adminList: async (options = {}) => normMediaArr((await httpGet('/admin/products', options)) || []),
    create: async (data) => normMedia(await httpPost('/admin/products', toProductBody(data))),
    update: async (id, data) => normMedia(await httpPut('/admin/products/' + encodeURIComponent(id), toProductBody(data))),
    remove: (id) => httpDelete('/admin/products/' + encodeURIComponent(id)),
  },

  Testimonial: {
    list: async () => {
      try {
        const admin = await httpGet('/admin/testimonials');
        if (Array.isArray(admin)) return normTestimonialArr(admin);
        const pub = await httpGet('/testimonials');
        return normTestimonialArr(pub || []);
      } catch (e) {
        if (e && e.status === 404) {
          const pub = await httpGet('/testimonials');
          return normTestimonialArr(pub || []);
        }
        return [];
      }
    },
    create: async (data) => normTestimonialRow(await httpPost('/admin/testimonials', toTestimonialBody(data))),
    update: async (id, data) => normTestimonialRow(await httpPut('/admin/testimonials/' + encodeURIComponent(id), toTestimonialBody(data))),
    remove: (id) => httpDelete('/admin/testimonials/' + encodeURIComponent(id)),
  },


  GalleryVideo: {
    list: async (options = {}) => normMediaArr((await httpGet('/gallery-videos', options)) || []),
    adminList: async (options = {}) => normMediaArr((await httpGet('/admin/gallery-videos', options)) || []),
    create: async (data) => normMedia(await httpPost('/admin/gallery-videos', toGalleryBody(data))),
    update: async (id, data) => normMedia(await httpPut('/admin/gallery-videos/' + encodeURIComponent(id), toGalleryBody(data))),
    remove: (id) => httpDelete('/admin/gallery-videos/' + encodeURIComponent(id)),
  },
  // alias: some UIs still call GalleryImage
  GalleryImage: {
    list: async (options = {}) => normMediaArr((await httpGet('/gallery-videos', options)) || []),
    adminList: async (options = {}) => normMediaArr((await httpGet('/admin/gallery-videos', options)) || []),
    create: async (data) => normMedia(await httpPost('/admin/gallery-videos', toGalleryBody(data))),
    update: async (id, data) => normMedia(await httpPut('/admin/gallery-videos/' + encodeURIComponent(id), toGalleryBody(data))),
    remove: (id) => httpDelete('/admin/gallery-videos/' + encodeURIComponent(id)),
  },

  BackgroundVideo: {
    list: async (options = {}) => normMediaArr((await httpGet('/background-videos', options)) || []),
    adminList: async (options = {}) => normMediaArr((await httpGet('/admin/background-videos', options)) || []),
    create: async (data) => normMedia(await httpPost('/admin/background-videos', toBackgroundBody(data))),
    update: async (id, data) => normMedia(await httpPut('/admin/background-videos/' + encodeURIComponent(id), toBackgroundBody(data))),
    remove: (id) => httpDelete('/admin/background-videos/' + encodeURIComponent(id)),
  },

  Setting: {
    // return { key, value } or null; doesn't throw on 404
    get: async (key) => normSetting(await httpGet('/settings/' + encodeURIComponent(key))),
    set: async (key, value) => normSetting(await httpPost('/admin/settings/' + encodeURIComponent(key), { value: value })),
  },

  /* ---------------- AUTH ---------------- */
  Auth: {
    requestCodeForLogin: async (phone) => {
      return httpPost('/auth/request-code-login', { phone: normalizePhone(phone) });
    },

    requestCodeForRegister: async (phone) => {
      return httpPost('/auth/request-code', { phone: normalizePhone(phone) });
    },
    verify: async (p) => {
      p = p || {};
      return httpPost('/auth/verify-code', {
        phone: normalizePhone(p.phone), code: p.code, firstName: p.firstName, lastName: p.lastName
      });
    },
  },
};

// הוסף את השורה הבאה לפני ה-exports:
Object.assign(api, { get: httpGet, post: httpPost, put: httpPut, patch: httpPatch, delete: httpDelete });


/* --------------- exports (keep all styles) --------------- */
export const base44 = api;
export default api;
export const {
  Service, Appointment, WaitingList, BusinessHours, Admin, Product,
  Testimonial, GalleryVideo, GalleryImage, BackgroundVideo, Setting, Auth
} = api;
export const base44Client = api; // legacy alias
export const Base44 = api;       // legacy alias
if (typeof window !== 'undefined') window.base44 = api; // handy for debugging
