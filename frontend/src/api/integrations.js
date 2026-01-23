// src/api/integrations.js

const isBrowser = typeof window !== 'undefined';

const Core = {
    openExternal(url) {
        if (!isBrowser || !url) return;
        try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) { console.error(e); }
    },
    copyToClipboard(text) {
        if (!isBrowser) return Promise.resolve(false);
        return navigator.clipboard?.writeText(text).then(() => true).catch(() => false);
    },
    isIOS:    isBrowser && /iPad|iPhone|iPod/.test(navigator.userAgent),
    isAndroid:isBrowser && /Android/.test(navigator.userAgent),
};

function normalizePhone(phone = '') {
    const d = String(phone).replace(/[^\d]/g, '');
    if (d.startsWith('9725')) return '0' + d.slice(3);
    if (d.startsWith('05')) return d;
    if (d.startsWith('5'))  return '0' + d;
    return d;
}

const WhatsApp = {
    link(phone, text = '') {
        const norm = normalizePhone(phone);
        const intl = norm.startsWith('0') ? '972' + norm.slice(1) : norm;
        const msg = encodeURIComponent(text);
        return `https://wa.me/${intl}${msg ? `?text=${msg}` : ''}`;
    },
    open(phone, text = '') { Core.openExternal(WhatsApp.link(phone, text)); },
};

const Phone = {
    telLink(phone) { return `tel:${normalizePhone(phone)}`; },
    call(phone) { if (!isBrowser) return; window.location.href = Phone.telLink(phone); },
};

const Maps = {
    gmapsLink(q) {
        const query = typeof q === 'string' ? q : `${q.lat},${q.lng}`;
        return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    },
    open(q) { Core.openExternal(Maps.gmapsLink(q)); },
};

/** ---------------- Dev-only uploader shim ----------------
 *  Returns a data: URL so the UI can preview/store something locally.
 *  In production we’ll swap this to S3/R2 and return a real https URL.
 */
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

// החלף את const UploadFile = {...} לשם אחר:
const DevUploader = {
    MAX_BYTES: 5 * 1024 * 1024,
    isTooLarge(file, max = 5 * 1024 * 1024) { return !!file && file.size > max; },
    async upload(file) {
        if (!isBrowser || !file) return '';
        if (DevUploader.isTooLarge(file)) {
            throw new Error('File too large for dev upload (max 5MB). Paste a URL instead.');
        }
        const url = await fileToDataUrl(file);
        return url;
    },
    uploadImage(file) { return DevUploader.upload(file); },
    uploadVideo(file) { return DevUploader.upload(file); },
    toDataUrl(file)   { return fileToDataUrl(file); },
};

import { API_ROOT } from '@/api/base44Client';
import { getStoredAuthToken } from '@/utils/authStorage';


export const UploadFile = {
    async upload(file) {
        const fd = new FormData();
        fd.append('file', file, file.name); // שם השדה חייב להיות "file"

        const headers = {};
        const token = getStoredAuthToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const res = await fetch(`${API_ROOT}/admin/upload`, {
            method: 'POST',
            body: fd,            // בלי headers בכלל
            headers,
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(JSON.stringify(data));

        const absoluteUrl = data.url?.startsWith('/')
            ? `${API_ROOT}${data.url}`
            : data.url;

        return { ok: true, url: absoluteUrl, file_url: absoluteUrl };
    }
};


export { Core, WhatsApp, Phone, Maps, DevUploader as _DevUploader };
export default { Core, WhatsApp, Phone, Maps, UploadFile };
