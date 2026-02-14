import { Request } from 'express';

export const getClientIp = (req: Request): string => {
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
        return cfConnectingIp.trim();
    }
    if (Array.isArray(cfConnectingIp) && cfConnectingIp.length > 0) {
        return String(cfConnectingIp[0]).trim();
    }

    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
        return xff.split(',')[0].trim();
    }
    if (Array.isArray(xff) && xff.length > 0) {
        return String(xff[0]).trim();
    }

    const expressIp = typeof req.ip === 'string' ? req.ip.trim() : '';
    if (expressIp) return expressIp;

    return req.socket?.remoteAddress || 'unknown';
};

export const getCfRay = (req: Request): string => String(req.headers['cf-ray'] || req.headers['x-request-id'] || '');

export const maskIp = (ip: string): string => {
    if (!ip || ip === 'unknown') return 'unknown';
    if (ip.includes('.')) {
        const p = ip.split('.');
        return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.x` : ip;
    }
    if (ip.includes(':')) {
        const chunks = ip.split(':').filter(Boolean);
        return `${chunks.slice(0, 3).join(':')}::`;
    }
    return ip;
};

export const maskPhone = (phone: string): string => {
    const tail = phone.slice(-3);
    return tail ? `***${tail}` : 'unknown';
};
