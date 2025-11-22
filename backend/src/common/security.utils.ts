import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export function sanitizeString(input: any): string {
    if (typeof input !== 'string') return '';
    const trimmed = input.trim();
    const withoutTags = trimmed.replace(/<[^>]*>/g, '');
    const withoutScripts = withoutTags.replace(/script/gi, '');
    return withoutScripts.replace(/[\r\n\t]+/g, ' ').trim();
}

export function maskPhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length <= 4) return `****${digits}`;
    return `****${digits.slice(-4)}`;
}

export function normalizePhone(phone: string): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0')) return digits;
    if (digits.startsWith('972')) return '0' + digits.slice(3);
    return digits;
}

export function phoneVariants(phone: string): string[] {
    if (!phone) return [];
    const raw = phone.toString().trim();
    const norm = normalizePhone(raw);
    const e164 = norm && norm.startsWith('0') ? `972${norm.slice(1)}` : norm;
    const plusE164 = e164 ? `+${e164}` : '';
    const plusNorm = norm ? `+${norm}` : '';
    const digitsOnly = raw.replace(/\D/g, '');
    const plusDigits = digitsOnly ? `+${digitsOnly}` : '';
    return Array.from(new Set([norm, e164, plusE164, plusNorm, plusDigits, raw].filter(Boolean)));
}

export interface HashedSecret {
    hash: string;
    salt: string;
    iterations: number;
}

export function hashSecret(value: string, iterations = 15): HashedSecret {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(value, salt, 64, { N: 2 ** iterations }).toString('hex');
    return { hash, salt, iterations };
}

export function verifySecret(value: string, stored?: HashedSecret): boolean {
    if (!stored?.salt || !stored?.hash) return false;
    const computed = scryptSync(value, stored.salt, 64, { N: 2 ** stored.iterations }).toString('hex');
    try {
        return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(stored.hash, 'hex'));
    } catch {
        return false;
    }
}

export function stableHash(value: string): string {
    return createHash('sha256').update(value || '').digest('hex');
}
