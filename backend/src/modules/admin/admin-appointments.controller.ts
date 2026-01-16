import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { DateTime } from 'luxon';

import { Appointment } from '../../entities/appointment.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { RecurringAppointment } from '../../entities/recurring-appointment.entity';

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

const MAX_RECURRING_OCCURRENCES = 60;
const TZ = 'Asia/Jerusalem';

const formatTime = (date: Date) =>
    DateTime.fromJSDate(date, { zone: TZ }).toFormat('HH:mm');

const dayOfWeek = (date: Date) => DateTime.fromJSDate(date, { zone: TZ }).weekday % 7;

@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminAppointmentsController {
    constructor(
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
        @InjectRepository(BlockedTime) private readonly blockRepo: Repository<BlockedTime>,
        @InjectRepository(RecurringAppointment) private readonly recurringRepo: Repository<RecurringAppointment>,
    ) {}

    @Get('appointments')
    async listByDate(@Query('date') date: string) {
        const d = normDate(date);

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
                (a?.client ? `${a.client.first_name ?? ''} ${a.client.last_name ?? ''}`.trim() : '') ??
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
                note: a.note ?? null,

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

    @Post('appointments/reschedule')
    async reschedule(@Body() body: { id?: string; newStartAt?: string; newEndAt?: string }) {
        const id = body?.id;
        if (!id || !body?.newStartAt || !body?.newEndAt) {
            throw new BadRequestException('Missing id/newStartAt/newEndAt');
        }
        const newStart = new Date(body.newStartAt);
        const newEnd = new Date(body.newEndAt);
        if (Number.isNaN(newStart.getTime()) || Number.isNaN(newEnd.getTime())) {
            throw new BadRequestException('Invalid date');
        }
        await this.apptRepo.update({ id }, { startsAt: newStart, endsAt: newEnd });
        return { ok: true };
    }

    @Put('appointments/:id')
    async update(@Param('id') id: string, @Body() body: { status?: string; note?: string }) {
        const appt = await this.apptRepo.findOne({ where: { id } });
        if (!appt) throw new NotFoundException('Appointment not found');
        appt.status = body?.status ?? appt.status;
        if (body?.note !== undefined) {
            appt.note = body.note;
        }
        await this.apptRepo.save(appt);
        return { ok: true };
    }

    @Delete('appointments/:id')
    async remove(@Param('id') id: string) {
        const result = await this.apptRepo.delete({ id });
        if (!result.affected) {
            throw new NotFoundException('Appointment not found');
        }
        return { ok: true };
    }

    @Post('appointments/:id/recurring')
    async createRecurring(
        @Param('id') id: string,
        @Body() body: { intervalWeeks?: number },
    ) {
        const intervalWeeks = Number(body?.intervalWeeks);
        if (!Number.isFinite(intervalWeeks) || ![1, 2, 3].includes(intervalWeeks)) {
            throw new BadRequestException('INVALID_INTERVAL');
        }

        const base = await this.apptRepo.findOne({ where: { id }, relations: ['client', 'service'] });
        if (!base) throw new NotFoundException('Appointment not found');
        if (!base.client || !base.service) throw new BadRequestException('Appointment missing client/service');

        const start = base.startsAt;
        const end = base.endsAt ?? new Date(start.getTime() + base.service.durationMinutes * 60_000);
        const durationMs = Math.max(end.getTime() - start.getTime(), 15 * 60_000);

        const weekday = dayOfWeek(start);
        const startTime = formatTime(start);

        let schedule = await this.recurringRepo.findOne({
            where: {
                client: { id: base.client.id },
                service: { id: base.service.id },
                weekday,
                startTime,
            },
        });
        if (schedule) {
            schedule.intervalWeeks = intervalWeeks;
            schedule = await this.recurringRepo.save(schedule);
        } else {
            schedule = await this.recurringRepo.save(this.recurringRepo.create({
                client: base.client,
                service: base.service,
                weekday,
                startTime,
                intervalWeeks,
            }));
        }

        base.recurringId = schedule.id;
        await this.apptRepo.save(base);

        const createdIds: string[] = [];
        const skippedDates: string[] = [];
        const clientIsMember = Boolean(base.client.is_member);

        const recurrenceEndDate = new Date(start.getTime());
        recurrenceEndDate.setFullYear(recurrenceEndDate.getFullYear() + 1);

        for (let occurrence = 1; occurrence <= MAX_RECURRING_OCCURRENCES; occurrence += 1) {
            const candidateStart = new Date(start.getTime() + occurrence * intervalWeeks * 7 * 24 * 60 * 60 * 1000);
            const candidateEnd = new Date(candidateStart.getTime() + durationMs);

            if (candidateStart >= recurrenceEndDate) break;

            const overlap = await this.apptRepo
                .createQueryBuilder('a')
                .where('a.startsAt < :end AND a.endsAt > :start', { start: candidateStart, end: candidateEnd })
                .andWhere("coalesce(a.status, 'booked') <> 'canceled'")
                .getCount();

            if (overlap > 0) {
                skippedDates.push(candidateStart.toISOString());
                continue;
            }

            const blocks = await this.blockRepo
                .createQueryBuilder('b')
                .where('b.startsAt < :end AND b.endsAt > :start', { start: candidateStart, end: candidateEnd })
                .getMany();
            const blocked = blocks.some((b) => !(b.membersOnly && clientIsMember));
            if (blocked) {
                skippedDates.push(candidateStart.toISOString());
                continue;
            }

            const created = await this.apptRepo.save(this.apptRepo.create({
                client: base.client,
                service: base.service,
                startsAt: candidateStart,
                endsAt: candidateEnd,
                status: base.status ?? 'booked',
                note: base.note ?? null,
                recurringId: schedule.id,
            }));
            createdIds.push(created.id);
        }

        return {
            createdCount: createdIds.length,
            skippedDates,
            createdAppointmentIds: createdIds,
            recurringScheduleId: schedule.id,
            schedule: {
                id: schedule.id,
                client_id: base.client.id,
                service_id: base.service.id,
                weekday,
                start_time: startTime,
                interval_weeks: intervalWeeks,
            },
        };
    }

    @Delete('recurring-appointments/:id')
    async cancelRecurring(@Param('id') id: string) {
        const scheduleId = Number(id);
        if (!Number.isFinite(scheduleId)) {
            throw new BadRequestException('INVALID_RECURRING_ID');
        }

        const schedule = await this.recurringRepo.findOne({
            where: { id: scheduleId },
            relations: ['client', 'service'],
        });
        if (!schedule) throw new NotFoundException('RECURRING_NOT_FOUND');

        await this.recurringRepo.delete({ id: scheduleId });

        let idsToCancel: string[] = [];
        const linked = await this.apptRepo.find({
            where: { recurringId: scheduleId },
        });
        idsToCancel = linked
            .filter((row) => (row.status ?? 'booked') !== 'canceled')
            .map((row) => row.id);

        if (idsToCancel.length === 0) {
            const now = new Date();
            const fallback = await this.apptRepo
                .createQueryBuilder('a')
                .leftJoin('a.client', 'c')
                .leftJoin('a.service', 's')
                .where('c.id = :clientId', { clientId: schedule.client.id })
                .andWhere('s.id = :serviceId', { serviceId: schedule.service.id })
                .andWhere('a.startsAt >= :now', { now })
                .andWhere("EXTRACT(DOW FROM a.startsAt AT TIME ZONE 'Asia/Jerusalem') = :weekday", { weekday: schedule.weekday })
                .andWhere("to_char(a.startsAt AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI') = :time", { time: schedule.startTime })
                .getMany();
            idsToCancel = fallback.map((row) => row.id);
        }

        if (idsToCancel.length > 0) {
            await this.apptRepo
                .createQueryBuilder()
                .update(Appointment)
                .set({ status: 'canceled' })
                .where('id IN (:...ids)', { ids: idsToCancel })
                .execute();
            await this.apptRepo.delete(idsToCancel);
        }

        return { ok: true, canceledCount: idsToCancel.length };
    }
}
