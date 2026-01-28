// src/api/entities.js
// ייבוא יחיד – בלי resolverים כפולים ובלי דאבלים
import api, { invalidateCacheByPathPrefix,
    Service,
    Appointment,
    Admin,
    Product,
    GalleryVideo as GalleryVideoAPI,
    BackgroundVideo as BackgroundVideoAPI,
    Setting,
    Auth,
} from './base44Client.js';

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/* ---------------- Clients (CRUD) ---------------- */
export const Client = {
    list: async () => {
        try {
            return await api.get('/clients');
        } catch (e) {
            console.warn('[Client.list] fallback → []', e);
            return [];
        }
    },
    create: (data) => api.post('/clients', data),
    update: (id, data) => api.put(`/clients/${id}`, data),
    delete: (id) => api.delete(`/clients/${id}`),
    lookup: async (query) => {
        const raw = typeof query === 'string' ? query : (query?.phone ?? '');
        const phone = normalizePhone(raw);
        if (!phone) return null;
        try {
            return await api.get(`/clients/lookup?phone=${encodeURIComponent(phone)}`);
        } catch (e) {
            console.warn('[Client.lookup] failed', e);
            return null;
        }
    },
};


/* ---------------- Aliases/Exports עקביים לכל האפליקציה ---------------- */
export { Service, Appointment, Admin, Product, Setting, Auth };

// ה־UI משתמש בשניהם — שניהם אותו מקור:
export const GalleryVideo = GalleryVideoAPI;
export const GalleryImage = GalleryVideoAPI;

// אותו דבר לסרטון רקע
export const BackgroundVideo = BackgroundVideoAPI;

/* ---------------- LocalStorage client (ל־VerificationModal) ---------------- */
const LOCAL_KEY = 'familia_client';
function normalizePhone(phone = '') {
    const digits = String(phone).replace(/[^\d]/g, '');
    if (digits.startsWith('9725')) return '0' + digits.slice(3);
    if (digits.startsWith('05')) return digits;
    if (digits.startsWith('5')) return '0' + digits;
    return digits;
}
function normalizeClient(c = {}) {
    const firstName = c.firstName ?? c.first_name ?? '';
    const lastName  = c.lastName  ?? c.last_name  ?? '';
    const phone     = normalizePhone(c.phone ?? c.client_phone ?? '');
    const isMember  = Boolean(c.isMember ?? c.is_member ?? false);
    return {
        firstName, lastName, phone,
        first_name: firstName,
        last_name: lastName,
        client_phone: phone,
        isMember,
        is_member: isMember,
    };
}
function getStored() { try { const raw = localStorage.getItem(LOCAL_KEY); return raw ? normalizeClient(JSON.parse(raw)) : null; } catch { return null; } }
function setStored(c) { const n = normalizeClient(c); localStorage.setItem(LOCAL_KEY, JSON.stringify(n)); return n; }
function clearStored() { localStorage.removeItem(LOCAL_KEY); }
export const LocalClient = {
    current: () => getStored(),
    get: () => getStored(),
    isLoggedIn: () => !!getStored(),
    set: (c) => setStored(c),
    save: (c) => setStored(c),
    upsert: (c) => setStored(c),
    byPhone: (phone) => { const me = getStored(); const norm = normalizePhone(phone); return me && me.phone === norm ? me : null; },
    list: async () => (getStored() ? [getStored()] : []),
    search: async (q = '') => {
        const me = getStored(); if (!me) return [];
        const term = q.toLowerCase(); const name = `${me.firstName} ${me.lastName}`.toLowerCase();
        return name.includes(term) || me.phone.includes(q) ? [me] : [];
    },
    logout: () => clearStored(),
    clear: () => clearStored(),
};

// שיהיה נוח בדיבוג
if (typeof window !== 'undefined') {
    window.familiaClient = Client;
}

/* ---------------- BusinessHours shim ---------------- */
const DEFAULT_HOURS = [
    { weekday: 0, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 1, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 2, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 3, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 4, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 5, open: '08:00', close: '15:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 6, open: null,   close: null,     slotIntervalMinutes: 30, isOpen: false },
];

const sanitizeTimeString = (value) => {
    if (value == null) return null;
    const match = String(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const h = String(match[1]).padStart(2, '0');
    const m = String(match[2]).padStart(2, '0');
    return `${h}:${m}`;
};

const normalizeBusinessHour = (row = {}) => {
    const weekday = Number(row.weekday ?? row.day ?? row.day_of_week ?? row.dayOfWeek);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
    const slot = Number(row.slotIntervalMinutes ?? row.slot_interval_minutes ?? row.slotMinutes ?? row.slot ?? 30) || 30;
    const openRaw = sanitizeTimeString(row.open ?? row.open_time ?? row.openTime);
    const closeRaw = sanitizeTimeString(row.close ?? row.close_time ?? row.closeTime);
    const isOpenFlag = row.isOpen ?? row.is_open ?? (row.isClosed !== undefined ? !row.isClosed : row.is_closed !== undefined ? !row.is_closed : undefined);
    const isOpen = isOpenFlag !== undefined ? Boolean(isOpenFlag) : Boolean(openRaw && closeRaw && openRaw !== closeRaw);
    const openVal = isOpen ? openRaw : null;
    const closeVal = isOpen ? closeRaw : null;
    return {
        weekday,
        open: openVal,
        close: closeVal,
        slotIntervalMinutes: slot,
        slot_interval_minutes: slot,
        slotMinutes: slot,
        slot: slot,
        isOpen,
        is_open: isOpen,
        isClosed: !isOpen,
        is_closed: !isOpen,
        open_time: openVal,
        close_time: closeVal,
    };
};

const normalizeBusinessHourArr = (arr) => (Array.isArray(arr) ? arr.map(normalizeBusinessHour).filter(Boolean) : []);

const prepareBusinessHourPayload = (rows = []) => rows
    .map((row) => {
        const weekday = Number(row.weekday ?? row.day ?? row.day_of_week ?? row.dayOfWeek);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
        const isOpen = row.isOpen !== undefined ? Boolean(row.isOpen)
            : row.is_open !== undefined ? Boolean(row.is_open)
                : !(row.isClosed ?? row.is_closed);
        const open = sanitizeTimeString(row.open ?? row.open_time ?? row.openTime);
        const close = sanitizeTimeString(row.close ?? row.close_time ?? row.closeTime);
        const slot = Number(row.slotIntervalMinutes ?? row.slot_interval_minutes ?? row.slot ?? row.slotMinutes ?? 30) || 30;
        return {
            weekday,
            open: isOpen ? open : null,
            close: isOpen ? close : null,
            slotIntervalMinutes: slot,
            isOpen,
        };
    })
    .filter(Boolean);

const fetchBusinessHours = async () => {
    try {
        const res = await api.get('/business-hours');
        const normalized = normalizeBusinessHourArr(res);
        if (normalized.length > 0) return normalized;
    } catch (e) {
        console.warn('[BusinessHours.list] fallback to defaults', e);
    }
    return normalizeBusinessHourArr(DEFAULT_HOURS);
};

export const BusinessHours = {
    list: async () => fetchBusinessHours(),
    getWeekly: async () => fetchBusinessHours(),
    get: async () => fetchBusinessHours(),
    updateAll: async (rows) => {
        const payload = prepareBusinessHourPayload(rows);
        try {
            const res = await api.put('/admin/business-hours', { hours: payload });
            invalidateCacheByPathPrefix('/business-hours');
            const normalized = normalizeBusinessHourArr(res);
            if (normalized.length > 0) return normalized;
        } catch (e) {
            console.error('[BusinessHours.updateAll] failed', e);
            throw e;
        }
        return normalizeBusinessHourArr(payload);
    },
    update: async (rows) => BusinessHours.updateAll(rows),
};
export const BusinessHour = BusinessHours;
export const OpeningHours = BusinessHours;
export const Hours = BusinessHours;

/* ---------------- BlockedTime shim ---------------- */
function dayBounds(dateStr) {
    const d = new Date(dateStr);
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 1);
    return { start, end };
}
export const BlockedTime = (() => {
    const root = Admin?.blocks || {
        list: async () => [],
        add: async () => { throw new Error('Admin.blocks.add unavailable'); },
        update: async () => { throw new Error('Admin.blocks.update unavailable'); },
        remove: async () => { throw new Error('Admin.blocks.remove unavailable'); },
    };
    const list = async () => (await root.list()) || [];
    const listByDate = async (date) => {
        const all = await list();
        if (!date) return all;
        const { start, end } = dayBounds(date);
        return all.filter(b => {
            const s = new Date(b.startAt ?? b.start_at ?? b.start);
            const e = new Date(b.endAt   ?? b.end_at   ?? b.end);
            return e > start && s < end;
        });
    };
    const add = (startAt, endAt, reason, membersOnly = false) => root.add(startAt, endAt, reason, membersOnly);
    const create = (data) => {
        const startAt = data.startAt ?? data.start_at ?? data.start;
        const endAt   = data.endAt   ?? data.end_at   ?? data.end;
        const reason  = data.reason  ?? '';
        const membersOnly = Boolean(data.membersOnly ?? data.members_only ?? false);
        return root.add(startAt, endAt, reason, membersOnly);
    };
    const update = (id, startAt, endAt, reason, membersOnly = false) => root.update(id, startAt, endAt, reason, membersOnly);
    const remove = (id) => root.remove(id);
    const del = (id) => root.remove(id);
    return { list, listByDate, add, create, update, remove, delete: del };
})();
export const BlockedTimes = BlockedTime;

// מבטיח ששדות order_index/is_active קיימים גם בסנייק וגם בקמל
const ensureOrdAct = (x = {}) => {
    const orderIndex = (x.orderIndex !== undefined) ? x.orderIndex
        : (x.order_index !== undefined) ? x.order_index
            : 0;
    const isActive   = (x.isActive   !== undefined) ? x.isActive
        : (x.is_active !== undefined) ? x.is_active
            : true;
    return { ...x, orderIndex, order_index: orderIndex, isActive, is_active: isActive };
};

const normTestimonial = (t = {}) => {
    const withOrd = ensureOrdAct(t);
    const txt = (withOrd.text != null) ? String(withOrd.text)
        : (withOrd.content != null) ? String(withOrd.content)
            : '';
    const content = (withOrd.content != null) ? String(withOrd.content) : txt;
    return { ...withOrd, text: txt, content };
};
const normTestimonialArr = (arr) => Array.isArray(arr) ? arr.map(normTestimonial) : [];

async function req(method, path, body) {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    const payload = isJson ? await res.json().catch(() => null) : null;
    if (!res.ok) {
        const msg =
            payload?.message ||
            payload?.error ||
            (typeof payload === "string" ? payload : "") ||
            `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.payload = payload;
        throw err;
    }
    return payload;
}
const getJson = (p) => req("GET", p);
const postJson = (p, b) => req("POST", p, b);
const putJson = (p, b) => req("PUT", p, b);
const delJson = (p) => req("DELETE", p);


export const Testimonial = {
    async list(order = "order_index") {
        const res = await api.get("/testimonials"); // או /admin/testimonials אם בחרת
        const raw = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const arr = normTestimonialArr(raw);
        if (order === "order_index") {
            arr.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        }
        return arr;
    },
    async adminList(order = "order_index") {
        const res = await api.get("/admin/testimonials");
        const raw = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const arr = normTestimonialArr(raw);
        if (order === "order_index") {
            arr.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        }
        return arr;
    },

    async create(data) {
        const contentValue = (data?.content ?? data?.text ?? "").toString();
        const payload = {
            author: data?.author ?? '',
            rating: data?.rating,
            content: contentValue, // תואם לשרת שמצפה ל-content
            text: contentValue, // תואם לשרת שמצפה ל-text
            is_active: data?.is_active ?? data?.isActive ?? true,
            order_index: data?.order_index ?? data?.orderIndex ?? 0,
        };
        const res = await api.post("/admin/testimonials", payload);
        return normTestimonial(res?.data ?? res); // ← נחזיר אובייקט עם text+content
    },

    async update(id, data) {
        const hasContent = (data?.content !== undefined || data?.text !== undefined);
        const contentValue = (data?.content ?? data?.text ?? "").toString();
        const payload = {
            author: data?.author,
            rating: data?.rating,
            ...(hasContent
                ? { content: contentValue, text: contentValue }
                : {} ),
            is_active: data?.is_active ?? data?.isActive,
            order_index: data?.order_index ?? data?.orderIndex,
        };
        const res = await api.put(`/admin/testimonials/${id}`, payload);
        return normTestimonial(res?.data ?? res); // ← גם כאן
    },

    async delete(id) {
        return await api.delete(`/admin/testimonials/${id}`);
    },
};

export const WaitingList = {
    /**
     * יצירת בקשת רשימת המתנה (צד לקוח)
     * payload:
     * { client_id?, client_name, phone, service_id, desired_starts_at (ISO), status? }
     */
    async create(payload) {
        return postJson("/waiting-list", payload);
    },

    /**
     * רשימת המתנה לאדמין (אופציונלי למסך ניהול)
     * filters: { status?, date?, serviceId? }
     */
    async listAdmin(filters = {}) {
        const q = new URLSearchParams();
        if (filters.status) q.set("status", filters.status);
        if (filters.date) q.set("date", filters.date);           // yyyy-MM-dd
        if (filters.serviceId) q.set("serviceId", String(filters.serviceId));
        const qs = q.toString() ? `?${q.toString()}` : "";
        return getJson(`/admin/waiting-list${qs}`);
    },

    /** עדכון סטטוס/זמן (אדמין) */
    async update(id, patch) {
        return putJson(`/admin/waiting-list/${id}`, patch);
    },

    /** מחיקה (לא חובה) */
    async remove(id) {
        return delJson(`/admin/waiting-list/${id}`);
    },
};


/* ---------------- אוספי תצוגה “חיים” + הידרציה ---------------- */
export const Products         = [];
export const Testimonials     = [];
export const GalleryVideos    = [];
export const GalleryImages    = [];
export const BackgroundVideos = [];

async function hydrateArray(target, fetcher) {
    try {
        const list = await fetcher?.();
        if (Array.isArray(list)) target.splice(0, target.length, ...list);
    } catch (e) {
        console.warn('[entities] hydrateArray failed', e);
    }
}
function shouldHydratePublicCollections() {
    if (typeof window === 'undefined') return false;
    const path = String(window.location?.pathname || '').toLowerCase();
    if (!path) return true;
    if (path.startsWith('/admin')) return false;
    return true;
}

if (shouldHydratePublicCollections()) {
    hydrateArray(Products,         () => Product.list?.());
    hydrateArray(Testimonials,     () => Testimonial.list?.());
    hydrateArray(GalleryVideos,    () => GalleryVideo.list?.());
    hydrateArray(GalleryImages,    () => GalleryImage.list?.());
    hydrateArray(BackgroundVideos, () => BackgroundVideo.list?.());
}
