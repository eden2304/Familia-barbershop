// src/lib/apt-utils.js
export function isPast(apt) {
    try {
        const end = apt?.ends_at ?? apt?.endsAt ?? apt?.starts_at ?? apt?.startsAt;
        return new Date(end) < new Date();
    } catch {
        return false;
    }
}

export function fullName(apt) {
    const c = apt?.client || {};
    const first = c.firstName ?? apt?.client_first_name ?? apt?.first_name ?? apt?.client_name?.split(' ')?.[0] ?? '';
    const last  = c.lastName  ?? apt?.client_last_name  ?? apt?.last_name  ?? '';
    const name = `${first} ${last}`.trim();
    return name || apt?.client_name || 'לקוח';
}

export function serviceName(apt) {
    return apt?.service?.name ?? apt?.service_name ?? 'שירות';
}

export function phone(apt) {
    return apt?.client?.phone ?? apt?.client_phone ?? apt?.phone ?? '';
}

export function statusPill(apt) {
    const status = (apt?.status || '').toLowerCase();

    if (status === 'canceled') {
        return { label: 'בוטל', className: 'border border-red-200 bg-red-50 text-red-700' };
    }
    if (isPast(apt)) {
        return { label: 'הושלם', className: 'border border-green-200 bg-green-50 text-green-700' };
    }
    return { label: 'נקבע', className: 'border border-blue-200 bg-blue-50 text-blue-700' };
}
