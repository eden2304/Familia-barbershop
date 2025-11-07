// src/api/entities.js
// ייבוא יחיד – בלי resolverים כפולים ובלי דאבלים
import api, {
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
    delete: (id) => api.delete(`/clients/${id}`)
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
    return {
        firstName, lastName, phone,
        first_name: firstName,
        last_name: lastName,
        client_phone: phone,
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
const mapHours = (arr) => arr.map(h => ({ ...h, open_time: h.open, close_time: h.close, is_closed: !h.isOpen }));
export const BusinessHours = {
    list: async () => mapHours(DEFAULT_HOURS),
    getWeekly: async () => mapHours(DEFAULT_HOURS),
    get: async () => mapHours(DEFAULT_HOURS),
    update: async () => { throw new Error('BusinessHours.update not implemented in this UI build'); },
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
    const root = Admin?.blocks || { list: async () => [], add: async () => { throw new Error('Admin.blocks.add unavailable'); }, remove: async () => { throw new Error('Admin.blocks.remove unavailable'); } };
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
    const add = (startAt, endAt, reason) => root.add(startAt, endAt, reason);
    const create = (data) => {
        const startAt = data.startAt ?? data.start_at ?? data.start;
        const endAt   = data.endAt   ?? data.end_at   ?? data.end;
        const reason  = data.reason  ?? '';
        return root.add(startAt, endAt, reason);
    };
    const remove = (id) => root.remove(id);
    const del = (id) => root.remove(id);
    return { list, listByDate, add, create, remove, delete: del };
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

    async create(data) {
        const payload = {
            author: data?.author ?? '',
            rating: data?.rating,
            content: (data?.content ?? data?.text ?? ''), // שולח תמיד content
            is_active: data?.is_active ?? data?.isActive ?? true,
            order_index: data?.order_index ?? data?.orderIndex ?? 0,
        };
        const res = await api.post("/admin/testimonials", payload);
        return normTestimonial(res?.data ?? res); // ← נחזיר אובייקט עם text+content
    },

    async update(id, data) {
        const payload = {
            author: data?.author,
            rating: data?.rating,
            ...( (data?.content !== undefined || data?.text !== undefined)
                ? { content: (data?.content ?? data?.text ?? '') }
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
if (typeof window !== 'undefined') {
    hydrateArray(Products,         () => Product.list?.());
    hydrateArray(Testimonials,     () => Testimonial.list?.());
    hydrateArray(GalleryVideos,    () => GalleryVideo.list?.());
    hydrateArray(GalleryImages,    () => GalleryImage.list?.());
    hydrateArray(BackgroundVideos, () => BackgroundVideo.list?.());
}