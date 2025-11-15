import { BadRequestException } from '@nestjs/common';
import { WaitingStatus } from '../../entities/waiting-list.entity';
import { CreateWaitingListDto, UpdateWaitingListDto } from './waiting-list.service';

const STATUS_VALUES: WaitingStatus[] = ['waiting', 'notified', 'booked', 'canceled'];

function parseDesiredStart(body: any): Date {
    const direct = body?.desiredStartsAt ?? body?.desired_starts_at ?? body?.desired_start;
    const datePart = body?.date ?? body?.desired_date;
    const timePart = body?.time ?? body?.desired_time;
    const combined = direct ?? (datePart && timePart ? `${datePart}T${timePart}:00` : null);
    if (!combined) throw new BadRequestException('desired_starts_at is required');
    const desired = new Date(combined);
    if (Number.isNaN(desired.getTime())) throw new BadRequestException('Invalid desired_starts_at');
    return desired;
}

function parseClientId(body: any): number | undefined | null {
    if (body?.clientId === null || body?.clientId === undefined) {
        if (body?.client_id === null || body?.client_id === undefined) return undefined;
    }
    const raw = body?.clientId ?? body?.client_id;
    if (raw === null) return null;
    if (raw === undefined || raw === '') return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
}

export function mapCreatePayload(body: any): CreateWaitingListDto {
    if (!body) throw new BadRequestException('Body is required');
    const serviceId = body.serviceId ?? body.service_id ?? body.service?.id;
    if (!serviceId) throw new BadRequestException('serviceId is required');
    const phone = body.phone ?? body.client_phone ?? body.clientPhone;
    if (!phone) throw new BadRequestException('phone is required');

    return {
        clientId: parseClientId(body),
        clientName: body.client_name ?? body.clientName ?? '',
        phone: String(phone),
        serviceId: String(serviceId),
        desiredStartsAt: parseDesiredStart(body),
        status: normalizeStatus(body.status),
    };
}

export function mapUpdatePayload(body: any): UpdateWaitingListDto {
    if (!body) return {};
    const patch: UpdateWaitingListDto = {};

    if ('clientId' in body || 'client_id' in body) {
        const parsed = parseClientId(body);
        patch.clientId = parsed === undefined ? undefined : parsed;
        if (body?.clientId === null || body?.client_id === null) {
            patch.clientId = null;
        }
    }

    if ('clientName' in body || 'client_name' in body) {
        patch.clientName = body.client_name ?? body.clientName ?? '';
    }

    if ('phone' in body || 'client_phone' in body || 'clientPhone' in body) {
        patch.phone = body.phone ?? body.client_phone ?? body.clientPhone;
    }

    if ('serviceId' in body || 'service_id' in body) {
        const raw = body.serviceId ?? body.service_id;
        patch.serviceId = raw ? String(raw) : null;
    }

    if ('desiredStartsAt' in body || 'desired_starts_at' in body || (body?.date && body?.time)) {
        patch.desiredStartsAt = parseDesiredStart(body);
    }

    if ('status' in body) {
        patch.status = normalizeStatus(body.status);
    }

    return patch;
}

export function parseStatusFilter(raw?: string | string[]): WaitingStatus[] | undefined {
    if (!raw) return undefined;
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    const statuses = list
        .map((value) => normalizeStatus(value))
        .filter((value) => !!value && STATUS_VALUES.includes(value as WaitingStatus)) as WaitingStatus[];
    return statuses.length ? statuses : undefined;
}

function normalizeStatus(input?: string): WaitingStatus | undefined {
    if (!input) return undefined;
    const value = String(input).trim().toLowerCase();
    return STATUS_VALUES.find((status) => status === value) ?? undefined;
}
