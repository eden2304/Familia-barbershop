import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WaitingList } from '../../entities/waiting-list.entity';
import { Client } from '../../clients/client.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { Public } from '../auth/public.decorator';
import { DateTime } from 'luxon';

const TZ = 'Asia/Jerusalem';

const normalizePhone = (raw: string) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('972')) return `0${digits.slice(3)}`;
    if (digits.startsWith('0')) return digits;
    return digits;
};

const splitName = (name: string) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { first: 'לקוח', last: 'מועדון' };
    if (parts.length === 1) return { first: parts[0], last: 'מועדון' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
};

const formatDateTimeParts = (date: Date) => {
    const dt = DateTime.fromJSDate(date, { zone: TZ });
    return { date: dt.toFormat('yyyy-MM-dd'), time: dt.toFormat('HH:mm') };
};

@Controller()
export class WaitingListController {
    constructor(
        @InjectRepository(WaitingList) private repo: Repository<WaitingList>,
        @InjectRepository(Client) private clients: Repository<Client>,
        @InjectRepository(ServiceEntity) private services: Repository<ServiceEntity>,
    ) {}

    @Public()
    @Post('waiting-list')
    async create(@Body() body: any) {
        const serviceIdRaw = body?.service_id ?? body?.serviceId ?? null;
        const serviceId = Number(serviceIdRaw);
        if (!Number.isFinite(serviceId)) {
            throw new BadRequestException('service_id is required');
        }

        const desiredRaw = body?.desired_starts_at ?? body?.desiredStartsAt ?? null;
        const desiredDate = desiredRaw ? new Date(desiredRaw) : null;
        if (!desiredDate || Number.isNaN(desiredDate.getTime())) {
            throw new BadRequestException('desired_starts_at is required');
        }

        const phone = normalizePhone(body?.phone ?? '');
        if (!phone) {
            throw new BadRequestException('phone is required');
        }

        const clientName = String(body?.client_name ?? body?.clientName ?? '').trim();
        let client: Client | null = null;
        if (body?.client_id) {
            client = await this.clients.findOne({ where: { id: Number(body.client_id) } });
        }
        if (!client) {
            client = await this.clients.findOne({ where: { phone } });
        }

        if (!client) {
            const { first, last } = splitName(clientName);
            client = await this.clients.save(this.clients.create({
                first_name: first,
                last_name: last,
                phone,
                is_member: false,
            }));
        }

        const service = await this.services.findOne({ where: { id: serviceId } });
        if (!service) {
            throw new BadRequestException('service not found');
        }

        const { date, time } = formatDateTimeParts(desiredDate);

        const entry = await this.repo.save(this.repo.create({
            client,
            service,
            date,
            time,
            clientName,
            phone,
            desiredStartsAt: desiredDate,
            status: 'waiting',
        }));

        return {
            ok: true,
            entry: this.presentEntry(entry),
        };
    }

    private presentEntry(entry: WaitingList) {
        const desired = entry.desiredStartsAt ?? new Date(`${entry.date}T${entry.time}:00`);
        const clientName =
            entry.clientName ??
            `${entry.client?.first_name ?? ''} ${entry.client?.last_name ?? ''}`.trim();
        return {
            id: entry.id,
            client_id: entry.client?.id ?? null,
            service_id: entry.service?.id ?? null,
            serviceId: entry.service?.id ?? null,
            client_name: clientName,
            phone: entry.phone ?? entry.client?.phone ?? '',
            desired_starts_at: desired.toISOString(),
            status: entry.status === 'open' ? 'waiting' : entry.status,
        };
    }
}
