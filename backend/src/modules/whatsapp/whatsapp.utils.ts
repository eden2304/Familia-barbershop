export function normalizeIsraeliPhoneToE164(raw: string): string | null {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (!digits) return null;

    if (digits.startsWith('9725') && digits.length === 12) {
        return `+${digits}`;
    }

    if (digits.startsWith('05') && digits.length === 10) {
        return `+972${digits.slice(1)}`;
    }

    return null;
}

export function formatDateParts(date: Date, timeZone: string) {
    const dateParts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).formatToParts(date);

    const day = dateParts.find(p => p.type === 'day')?.value || '';
    const month = dateParts.find(p => p.type === 'month')?.value || '';
    const year = dateParts.find(p => p.type === 'year')?.value || '';

    return { day, month, year };
}

export function formatDateForTemplate(date: Date, timeZone: string): string {
    const { day, month, year } = formatDateParts(date, timeZone);
    if (!day || !month || !year) return '';
    return `${day}.${month}.${year}`;
}

export function formatTimeForTemplate(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function toMetaRecipientFromE164(e164: string): string {
    return String(e164 || '').replace(/^\+/, '');
}
