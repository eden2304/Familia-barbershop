import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Post,
    Put,
    Param,
    Delete,
    Query,
    UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { WaitingList } from '../../entities/waiting-list.entity';
import { Client } from '../../clients/client.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { Public } from '../auth/public.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';

const TZ = 'Asia/Jerusalem';

function normalizePhone(phone: string): string {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('972')) return `0${digits.slice(3)}`;
    if (digits.length === 9 && digits.startsWith('5')) return `0${digits}`;
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    return digits.startsWith('0') ? digits : `0${digits}`;
}

function splitName(name: string): [string, string] {
    const parts = String(name || '').trim().split(/\s+/);
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ') || '';
    return [first, last];
}

function toDateParts(desiredStartsAt: Date) {
    const dt = DateTime.fromJSDate(desiredStartsAt, { zone: TZ });
    return {
        date: dt.toFormat('yyyy-LL-dd'),
        time: dt.toFormat('HH:mm'),
        desiredAtIso: dt.toISO(),
    };
}

@Controller()
export class WaitingListController {
    constructor(
        @InjectRepository(WaitingList) private readonly waitRepo: Repository<WaitingList>,
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        @InjectRepository(ServiceEntity) private readonly serviceRepo: Repository<ServiceEntity>,
    ) {}

    @Public()
    @Post('waiting-list')
    async create(@Body() body: any) {
        const desiredRaw = body?.desired_starts_at ?? body?.desiredStartsAt;
        const desired = desiredRaw ? new Date(desiredRaw) : null;
        if (!desired || Number.isNaN(desired.getTime())) {
            throw new BadRequestException('desired_starts_at is required');
        }

        const phone = normalizePhone(body?.phone ?? '');
        const clientName = String(body?.client_name ?? '').trim();
        const serviceId = body?.service_id ?? body?.serviceId ?? null;
        if (!phone) throw new BadRequestException('phone is required');

        let client: Client | null = null;
        const clientId = body?.client_id ?? body?.clientId ?? null;
        if (clientId) {
            client = await this.clientRepo.findOne({ where: { id: clientId } as any });
        }
        if (!client) {
            client = await this.clientRepo.findOne({ where: { phone } });
        }
        if (!client) {
            const [firstName, lastName] = splitName(clientName);
            client = this.clientRepo.create({
                firstName: firstName || 'לקוח',
                lastName: lastName || '',
                phone,
            });
            client = await this.clientRepo.save(client);
        }

        const service = serviceId
            ? await this.serviceRepo.findOne({ where: { id: serviceId } as any })
            : null;

        const { date, time, desiredAtIso } = toDateParts(desired);

        const entry = this.waitRepo.create({
            client,
            service: service ?? undefined,
            date,
            time,
            status: String(body?.status ?? 'waiting'),
        });
        const saved = await this.waitRepo.save(entry);

        return {
            id: saved.id,
            client_id: client?.id ?? null,
            client_name: clientName || `${client?.firstName ?? ''} ${client?.lastName ?? ''}`.trim(),
            phone: client?.phone ?? phone,
            service_id: service?.id ?? serviceId ?? null,
            desired_starts_at: desiredAtIso,
            status: saved.status,
        };
    }

    @Get('admin/waiting-list')
    @UseGuards(JwtAuthGuard)
    @Roles('admin')
    async listAdmin(
        @Query('status') status?: string,
        @Query('date') date?: string,
        @Query('serviceId') serviceId?: string,
    ) {
        const qb = this.waitRepo
            .createQueryBuilder('w')
            .leftJoinAndSelect('w.client', 'c')
            .leftJoinAndSelect('w.service', 's');

        if (status) {
            qb.andWhere('w.status = :status', { status });
        }
        if (date) {
            qb.andWhere('w.date = :date', { date });
        }
        if (serviceId) {
            qb.andWhere('w.service_id = :serviceId', { serviceId });
        }

        const rows = await qb.orderBy('w.date', 'ASC').addOrderBy('w.time', 'ASC').getMany();

        return rows.map((row) => {
            const desired = DateTime.fromISO(`${row.date}T${row.time}`, { zone: TZ }).toISO();
            return {
                id: row.id,
                client_id: row.client?.id ?? null,
                client_name: row.client ? `${row.client.firstName ?? ''} ${row.client.lastName ?? ''}`.trim() : '',
                phone: row.client?.phone ?? '',
                service_id: row.service?.id ?? null,
                desired_starts_at: desired,
                status: row.status,
                service_name: row.service?.name ?? null,
                duration_minutes: row.service?.durationMinutes ?? null,
            };
        });
    }

    @Put('admin/waiting-list/:id')
    @UseGuards(JwtAuthGuard)
    @Roles('admin')
    async update(@Param('id') id: string, @Body() body: any) {
        const entry = await this.waitRepo.findOne({ where: { id } as any, relations: ['client', 'service'] });
        if (!entry) {
            throw new BadRequestException('Waiting list entry not found');
        }
        const nextStatus = body?.status ?? entry.status;
        let nextDate = entry.date;
        let nextTime = entry.time;
        const desiredRaw = body?.desired_starts_at ?? body?.desiredStartsAt;
        if (desiredRaw) {
            const desired = new Date(desiredRaw);
            if (Number.isNaN(desired.getTime())) {
                throw new BadRequestException('desired_starts_at is invalid');
            }
            const parts = toDateParts(desired);
            nextDate = parts.date;
            nextTime = parts.time;
        }

        entry.status = String(nextStatus);
        entry.date = nextDate;
        entry.time = nextTime;
        const saved = await this.waitRepo.save(entry);

        const desiredAt = DateTime.fromISO(`${saved.date}T${saved.time}`, { zone: TZ }).toISO();

        return {
            id: saved.id,
            client_id: saved.client?.id ?? null,
            client_name: saved.client ? `${saved.client.firstName ?? ''} ${saved.client.lastName ?? ''}`.trim() : '',
            phone: saved.client?.phone ?? '',
            service_id: saved.service?.id ?? null,
            desired_starts_at: desiredAt,
            status: saved.status,
        };
    }

    @Delete('admin/waiting-list/:id')
    @UseGuards(JwtAuthGuard)
    @Roles('admin')
    async remove(@Param('id') id: string) {
        await this.waitRepo.delete({ id } as any);
        return { ok: true };
    }
}
