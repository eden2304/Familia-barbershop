import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpException,
    HttpStatus,
    NotFoundException,
    Param,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { DateTime } from 'luxon';

import { Appointment } from '../../entities/appointment.entity';
import { ensureRecurringSchema, MAX_RECURRING_OCCURRENCES } from '../appointments/recurring.helpers';

function parseBoolean(value: any, fallback = false): boolean {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const norm = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(norm)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(norm)) return false;
    return fallback;
}

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
        @InjectDataSource() private readonly ds: DataSource,
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
            .where("(a.startsAt AT TIME ZONE 'Asia/Jerusalem')::date = :d", { d })
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

    @Delete('appointments/:id')
    async remove(@Param('id') id: string) {
        if (!id) throw new BadRequestException('Missing id');
        const result = await this.apptRepo.delete({ id });
        if (!result.affected) {
            throw new NotFoundException('Appointment not found');
        }
        return { ok: true, id };
    }

    @Get('clients/:id/appointments')
    async listClientAppointments(@Param('id') id: string, @Query('future') future: string) {
        if (!id) throw new BadRequestException('Missing client id');
        const futureOnly = parseBoolean(future, true);
        const now = new Date();

        const rows = await this.ds.query(
            `
            select a.id, a.starts_at, a.ends_at, a.status, a.note,
                   s.id as service_id, s.name as service_name, s.duration_minutes,
                   c.id as client_id, c.first_name, c.last_name, c.phone
            from appointments a
                     left join services s on s.id=a.service_id
                     left join clients c  on c.id=a.client_id
            where a.client_id = $1
              ${futureOnly ? "and a.starts_at > $2 and coalesce(a.status,'') <> 'canceled'" : ""}
            order by a.starts_at asc
            `,
            futureOnly ? [id, now] : [id],
        );

        return rows.map((a: any) => {
            const clientName = [a?.first_name, a?.last_name].filter(Boolean).join(' ').trim();
            return {
                id: a.id,
                status: a.status ?? 'booked',

                startsAt: a.starts_at,
                endsAt: a.ends_at,
                serviceId: a.service_id,
                clientName,
                phone: a.phone ?? '',

                starts_at: a.starts_at,
                ends_at: a.ends_at,
                service_id: a.service_id,
                client_name: clientName,
                client_phone: a.phone ?? '',
            };
        });
    }

    @Post('appointments/:id/recurring')
    async createRecurring(@Param('id') id: string, @Body() body: any) {
        if (!id) throw new BadRequestException('Missing id');

        const intervalUnitRaw = body?.intervalUnit ?? body?.interval_unit ?? body?.unit;
        const intervalCandidate = body?.intervalWeeks ?? body?.interval ?? body?.every ?? body?.frequency;
        const intervalMonthsCandidate = body?.intervalMonths ?? body?.interval_months ?? body?.months;
        const intervalUnit = typeof intervalUnitRaw === 'string' ? intervalUnitRaw.toLowerCase() : null;
        const hasMonthlyUnit = intervalUnit && ['month', 'months', 'monthly'].includes(intervalUnit);
        let intervalWeeks = Number(intervalCandidate);
        let intervalMonths = Number(intervalMonthsCandidate);
        const useMonths = hasMonthlyUnit || Number.isFinite(intervalMonths);

        if (useMonths) {
            intervalMonths = Number.isFinite(intervalMonths) ? intervalMonths : 1;
            if (!Number.isFinite(intervalMonths) || intervalMonths !== 1) {
                throw new BadRequestException('ניתן לבחור חזרה חודשית בלבד.');
            }
        } else if (!Number.isFinite(intervalWeeks) || ![1, 2, 3].includes(Number(intervalWeeks))) {
            throw new BadRequestException('ניתן לבחור כל שבוע, כל שבועיים או כל שלושה שבועות.');
        }

        await ensureRecurringSchema(this.ds);

        const baseRows = await this.ds.query(
            `select id, client_id, service_id, starts_at, ends_at from appointments where id = $1 limit 1`,
            [id],
        );
        const base = baseRows?.[0];
        if (!base) throw new NotFoundException('Appointment not found');

        const start = new Date(base.starts_at);
        const end = new Date(base.ends_at ?? base.starts_at);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
            throw new BadRequestException('לא ניתן ליצור תור קבוע עבור תור עם שעה שגויה.');
        }

        const durationMs = Math.max(end.getTime() - start.getTime(), 15 * 60 * 1000);
        const clientId = base.client_id;
        if (clientId == null) {
            throw new BadRequestException('לא ניתן ליצור תור קבוע ללא לקוח משויך.');
        }

        const localStart = DateTime.fromJSDate(start, { zone: 'utc' }).setZone('Asia/Jerusalem');
        const scheduleWeekday = localStart.weekday % 7;
        const scheduleDayOfMonth = localStart.day;
        const scheduleTime = localStart.toFormat('HH:mm');

        const clientRows = await this.ds.query(
            'select coalesce(is_member,false) as is_member from clients where id = $1 limit 1',
            [clientId],
        );
        const clientIsMember = Boolean(clientRows?.[0]?.is_member);

        const recurrenceEndDate = localStart.plus({ months: 6 });
        const occurrences: Array<{ start: Date; end: Date }> = [];
        for (let occurrence = 1; occurrence <= MAX_RECURRING_OCCURRENCES; occurrence += 1) {
            const candidateLocal = useMonths
                ? localStart.plus({ months: occurrence * intervalMonths })
                : localStart.plus({ weeks: occurrence * intervalWeeks });
            if (candidateLocal >= recurrenceEndDate) break;
            const candidateStart = candidateLocal.toUTC().toJSDate();
            occurrences.push({ start: candidateStart, end: new Date(candidateStart.getTime() + durationMs) });
        }

        const conflicts: Array<Record<string, any>> = [];
        const conflictKeys = new Set<string>();
        let hasMoreConflicts = false;
        const pushConflict = (key: string, payload: Record<string, any>) => {
            if (conflictKeys.has(key)) return;
            conflictKeys.add(key);
            if (conflicts.length < 3) {
                conflicts.push(payload);
            } else {
                hasMoreConflicts = true;
            }
        };

        for (const occurrence of occurrences) {
            const apptConflicts = await this.ds.query(
                `select a.id,
                        a.starts_at,
                        a.ends_at,
                        c.first_name,
                        c.last_name,
                        s.name as service_name
                 from appointments a
                 left join clients c on c.id = a.client_id
                 left join services s on s.id = a.service_id
                 where a.starts_at < $2
                   and coalesce(a.ends_at, a.starts_at + interval '30 minutes') > $1`,
                [occurrence.start, occurrence.end],
            );

            for (const row of apptConflicts || []) {
                const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
                pushConflict(`appointment-${row.id}`, {
                    type: 'appointment',
                    id: row.id,
                    starts_at: row.starts_at,
                    ends_at: row.ends_at,
                    client_name: name || null,
                    service_name: row.service_name || null,
                });
            }

            const blockRows = await this.ds.query(
                `select id, starts_at, ends_at, reason, coalesce(members_only,false) as members_only
                 from blocked_times
                 where starts_at < $2
                   and ends_at > $1`,
                [occurrence.start, occurrence.end],
            );
            const blocking = (blockRows || []).filter((row: any) => !(row.members_only && clientIsMember));
            for (const row of blocking) {
                pushConflict(`blocked-${row.id}`, {
                    type: 'blocked',
                    id: row.id,
                    starts_at: row.starts_at,
                    ends_at: row.ends_at,
                    reason: row.reason || null,
                });
            }

            if (hasMoreConflicts && conflicts.length >= 3) break;
        }

        if (conflicts.length > 0) {
            throw new HttpException(
                {
                    error: 'RECURRING_CONFLICT',
                    message: 'לא ניתן לקבוע תור קבוע כי קיימים תורים מתנגשים.',
                    conflicts,
                    hasMore: hasMoreConflicts,
                },
                HttpStatus.CONFLICT,
            );
        }

        const scheduleLookup = useMonths
            ? await this.ds.query(
                `select id from recurring_appointments
                 where client_id = $1
                   and service_id = $2
                   and start_time = $3
                   and interval_months = $4
                   and day_of_month = $5
                 limit 1`,
                [clientId, base.service_id, scheduleTime, intervalMonths, scheduleDayOfMonth],
            )
            : await this.ds.query(
                `select id from recurring_appointments
                 where client_id = $1
                   and service_id = $2
                   and start_time = $3
                   and interval_months is null
                   and weekday = $4
                 limit 1`,
                [clientId, base.service_id, scheduleTime, scheduleWeekday],
            );

        let recurringScheduleId = scheduleLookup?.[0]?.id ?? null;
        if (recurringScheduleId) {
            await this.ds.query(
                `update recurring_appointments
                 set interval_weeks = $1,
                     interval_months = $2,
                     day_of_month = $3,
                     weekday = $4
                 where id = $5`,
                [useMonths ? 1 : intervalWeeks, useMonths ? intervalMonths : null, useMonths ? scheduleDayOfMonth : null, scheduleWeekday, recurringScheduleId],
            );
        } else {
            const scheduleRes = await this.ds.query(
                `insert into recurring_appointments (client_id, service_id, weekday, start_time, interval_weeks, interval_months, day_of_month)
                 values ($1,$2,$3,$4,$5,$6,$7)
                 returning id`,
                [clientId, base.service_id, scheduleWeekday, scheduleTime, useMonths ? 1 : intervalWeeks, useMonths ? intervalMonths : null, useMonths ? scheduleDayOfMonth : null],
            );
            recurringScheduleId = scheduleRes?.[0]?.id ?? null;
        }

        if (recurringScheduleId) {
            await this.ds.query(`update appointments set recurring_id = $1 where id = $2`, [recurringScheduleId, base.id]);
        }

        const createdIds: string[] = [];
        for (const occurrence of occurrences) {
            const insertRows = await this.ds.query(
                `insert into appointments (service_id, client_id, starts_at, ends_at, recurring_id)
                 values ($1,$2,$3,$4,$5)
                 returning id`,
                [base.service_id, clientId, occurrence.start, occurrence.end, recurringScheduleId],
            );
            if (insertRows?.[0]?.id) {
                createdIds.push(insertRows[0].id);
            }
        }

        return {
            createdCount: createdIds.length,
            createdAppointmentIds: createdIds,
            recurringScheduleId,
            schedule: {
                id: recurringScheduleId,
                client_id: clientId,
                service_id: base.service_id,
                weekday: scheduleWeekday,
                start_time: scheduleTime,
                interval_weeks: useMonths ? null : intervalWeeks,
                interval_months: useMonths ? intervalMonths : null,
                day_of_month: useMonths ? scheduleDayOfMonth : null,
            },
        };
    }

    @Delete('recurring-appointments/:id')
    async cancelRecurring(@Param('id') id: string) {
        if (!id) throw new BadRequestException('Missing recurring id');
        await ensureRecurringSchema(this.ds);

        const scheduleRows = await this.ds.query(
            `select id, client_id, service_id, weekday, start_time, interval_months, day_of_month
             from recurring_appointments where id = $1 limit 1`,
            [id],
        );
        const schedule = scheduleRows?.[0];
        if (!schedule) throw new NotFoundException('Recurring schedule not found');

        await this.ds.query(`delete from recurring_appointments where id = $1`, [id]);

        const scheduleTime = schedule.start_time;
        const usesMonthly = Number(schedule.interval_months) > 0;
        const matchClause = usesMonthly
            ? `extract(day from starts_at at time zone 'Asia/Jerusalem') = $3`
            : `extract(dow from starts_at at time zone 'Asia/Jerusalem') = $3`;
        const matchValue = usesMonthly ? schedule.day_of_month : schedule.weekday;
        const rowsToCancel = await this.ds.query(
            `select id from appointments
             where (recurring_id = $1)
                or (
                    client_id = $2
                    and service_id = $4
                    and starts_at >= now()
                    and ${matchClause}
                    and to_char(starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') = $5
                )`,
            [schedule.id, schedule.client_id, matchValue, schedule.service_id, scheduleTime],
        );
        const idsToCancel = (rowsToCancel || []).map((row: any) => row.id).filter(Boolean);

        if (idsToCancel.length > 0) {
            await this.ds.query(`delete from appointments where id = any($1::uuid[])`, [idsToCancel]);
        }

        return { ok: true, canceledCount: idsToCancel.length };
    }
}
