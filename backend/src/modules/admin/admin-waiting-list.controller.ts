import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WaitingList } from '../../entities/waiting-list.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { DateTime } from 'luxon';

const TZ = 'Asia/Jerusalem';

const toDesiredDate = (entry: WaitingList) => {
    if (entry.desiredStartsAt) return entry.desiredStartsAt;
    if (entry.date && entry.time) {
        return DateTime.fromISO(`${entry.date}T${entry.time}`, { zone: TZ }).toJSDate();
    }
    return null;
};

@Controller('admin/waiting-list')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminWaitingListController {
    constructor(@InjectRepository(WaitingList) private repo: Repository<WaitingList>) {}

    @Get()
    async list(@Query('status') status?: string, @Query('date') date?: string, @Query('serviceId') serviceId?: string) {
        const qb = this.repo
            .createQueryBuilder('w')
            .leftJoinAndSelect('w.service', 's')
            .leftJoinAndSelect('w.client', 'c')
            .orderBy('w.createdAt', 'DESC');

        if (status) {
            qb.andWhere('w.status = :status', { status });
        }
        if (serviceId) {
            const id = Number(serviceId);
            if (!Number.isNaN(id)) {
                qb.andWhere('s.id = :serviceId', { serviceId: id });
            }
        }
        if (date) {
            qb.andWhere('w.date = :date', { date });
        }

        const rows = await qb.getMany();
        return rows.map((entry) => {
            const desired = toDesiredDate(entry) ?? new Date();
            const clientName =
                entry.clientName ??
                `${entry.client?.first_name ?? ''} ${entry.client?.last_name ?? ''}`.trim();
            return {
                id: entry.id,
                client_id: entry.client?.id ?? null,
                service_id: entry.service?.id ?? null,
                service_name: entry.service?.name ?? null,
                client_name: clientName,
                phone: entry.phone ?? entry.client?.phone ?? '',
                desired_starts_at: desired.toISOString(),
                status: entry.status === 'open' ? 'waiting' : entry.status,
            };
        });
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() body: any) {
        const desiredRaw = body?.desired_starts_at ?? body?.desiredStartsAt ?? null;
        const desired = desiredRaw ? new Date(desiredRaw) : null;

        const entry = await this.repo.findOne({ where: { id }, relations: ['client', 'service'] });
        if (!entry) {
            return null;
        }

        if (body?.status) {
            entry.status = body.status;
        }

        if (desired && !Number.isNaN(desired.getTime())) {
            entry.desiredStartsAt = desired;
            const dt = DateTime.fromJSDate(desired, { zone: TZ });
            entry.date = dt.toFormat('yyyy-MM-dd');
            entry.time = dt.toFormat('HH:mm');
        }

        const saved = await this.repo.save(entry);
        return {
            id: saved.id,
            client_id: saved.client?.id ?? null,
            service_id: saved.service?.id ?? null,
            client_name:
                saved.clientName ??
                `${saved.client?.first_name ?? ''} ${saved.client?.last_name ?? ''}`.trim(),
            phone: saved.phone ?? saved.client?.phone ?? '',
            desired_starts_at: (saved.desiredStartsAt ?? desired ?? new Date()).toISOString(),
            status: saved.status === 'open' ? 'waiting' : saved.status,
        };
    }

    @Delete(':id')
    async remove(@Param('id') id: string) {
        await this.repo.delete({ id });
        return { ok: true };
    }
}
