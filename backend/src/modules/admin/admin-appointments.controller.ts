import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { DateTime } from 'luxon';

import { Appointment } from '../../entities/appointment.entity';

function normDate(date: string): string {
    if (!date) throw new BadRequestException('date is required');
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;

    // dd/MM/yyyy -> yyyy-MM-dd
    const m = String(date).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);

    throw new BadRequestException('Invalid date');
}

function dayRangeUtc(yyyyMmDd: string) {
    const TZ = 'Asia/Jerusalem';

    const start = DateTime.fromISO(yyyyMmDd, { zone: TZ })
        .startOf('day')
        .toUTC()
        .toJSDate();

    const end = DateTime.fromISO(yyyyMmDd, { zone: TZ })
        .endOf('day')
        .toUTC()
        .toJSDate();

    return { start, end };
}


@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminAppointmentsController {
    constructor(
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
    ) {}

    @Get('appointments')
    async listByDate(@Query('date') date: string) {
        const d = normDate(date);
        const { start, end } = dayRangeUtc(d);

        // אם אצלך relations נקראים אחרת (service/client) תעדכן פה בהתאם
        const rows = await this.apptRepo
            .createQueryBuilder('a')
            .leftJoinAndSelect('a.service', 's')
            .leftJoinAndSelect('a.client', 'c')
            .where('a.startsAt >= :start AND a.startsAt <= :end', { start, end })
            .orderBy('a.startsAt', 'ASC')
            .getMany();

        // מחזירים גם snake וגם camel כדי שה־UI “לא יישבר”
        return rows.map((a: any) => {
            const clientName =
                a?.clientName ??
                (a?.client ? `${a.client.firstName ?? ''} ${a.client.lastName ?? ''}`.trim() : '') ??
                '';

            const phone =
                a?.phone ??
                a?.clientPhone ??
                a?.client?.phone ??
                '';

            const serviceId =
                a?.serviceId ??
                a?.service?.id ??
                null;

            const startsAt = a.startsAt;
            const endsAt = a.endsAt;

            return {
                id: a.id,
                status: a.status ?? 'booked',

                // camel
                startsAt,
                endsAt,
                serviceId,
                clientName,
                phone,

                // snake (מה שהמון קוד ישן מצפה)
                starts_at: startsAt,
                ends_at: endsAt,
                service_id: serviceId,
                client_name: clientName,
                client_phone: phone,
            };
        });
    }
}
