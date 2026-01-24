import {
    BadRequestException,
    ConflictException,
    Controller,
    Delete,
    Get,
    NotFoundException,
    Param,
    Body,
    Put,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { Appointment } from '../../entities/appointment.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { DateTime } from 'luxon';

const TZ = 'Asia/Jerusalem';

function parseBoolean(value: any, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const norm = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(norm)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(norm)) return false;
    return fallback;
}

function parseISOWithZone(value: any) {
    if (!value) return new Date(NaN);
    if (value instanceof Date) return value;
    const raw = String(value).trim();
    if (!raw) return new Date(NaN);
    if (/Z$|[+-]\d\d:\d\d$/.test(raw)) return new Date(raw);
    const dt = DateTime.fromISO(raw, { zone: TZ });
    if (dt.isValid) return dt.toJSDate();
    return new Date(raw);
}

function dayRangeUtc(yyyyMmDd: string) {
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

function normalizeDate(date: string) {
    if (!date) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const m = String(date).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    throw new BadRequestException('Invalid date');
}

function serializeBlockedTime(row: BlockedTime) {
    return {
        id: row.id,
        reason: row.reason,
        membersOnly: row.membersOnly,
        startAt: row.startsAt,
        endAt: row.endsAt,
        start_at: row.startsAt,
        end_at: row.endsAt,
        members_only: row.membersOnly,
    };
}

@Controller('admin/blocked-times')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class BlockedTimesController {
    constructor(
        @InjectRepository(BlockedTime) private repo: Repository<BlockedTime>,
        @InjectRepository(Appointment) private apptRepo: Repository<Appointment>,
    ) {}

    @Get()
    async list(@Query('date') date?: string) {
        if (!date) {
            const rows = await this.repo.find({ order: { startsAt: 'DESC' } });
            return rows.map(serializeBlockedTime);
        }

        const normalized = normalizeDate(date);
        const { start, end } = dayRangeUtc(normalized);
        const rows = await this.repo
            .createQueryBuilder('b')
            .where('b.startsAt < :end AND b.endsAt > :start', { start, end })
            .orderBy('b.startsAt', 'DESC')
            .getMany();

        return rows.map(serializeBlockedTime);
    }

    @Post()
    async add(@Body() body: Record<string, any>) {
        const startsAtRaw = body.starts_at ?? body.startAt ?? body.start ?? body.from;
        const endsAtRaw = body.ends_at ?? body.endAt ?? body.end ?? body.to;
        if (!startsAtRaw || !endsAtRaw) throw new BadRequestException('Missing starts_at/ends_at');

        const startsAt = parseISOWithZone(startsAtRaw);
        const endsAt = parseISOWithZone(endsAtRaw);
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
            throw new BadRequestException('Invalid datetime format');
        }
        if (endsAt <= startsAt) throw new BadRequestException('Invalid time range');

        const overlap = await this.apptRepo
            .createQueryBuilder('a')
            .leftJoinAndSelect('a.client', 'c')
            .where('a.startsAt < :end AND a.endsAt > :start', { start: startsAt, end: endsAt })
            .orderBy('a.startsAt', 'ASC')
            .getMany();

        if (overlap.length > 0) {
            throw new ConflictException({
                error: 'יש תורים קיימים בתוך הטווח – בטל/י אותם לפני חסימה.',
                conflicts: overlap.slice(0, 20).map(a => ({
                    id: a.id,
                    starts_at: a.startsAt,
                    ends_at: a.endsAt,
                    client_name: a.client ? `${a.client.firstName ?? ''} ${a.client.lastName ?? ''}`.trim() : '',
                })),
            });
        }

        const reason = String(body.reason ?? body.desc ?? '');
        const membersOnly = parseBoolean(body.members_only ?? body.membersOnly ?? body.members, false);
        const row = await this.repo.save(
            this.repo.create({ startsAt, endsAt, reason, membersOnly }),
        );
        return serializeBlockedTime(row);
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() body: Record<string, any>) {
        const row = await this.repo.findOne({ where: { id } });
        if (!row) throw new NotFoundException('Blocked time not found');

        const startsAtRaw = body.starts_at ?? body.startAt ?? body.start ?? body.from ?? row.startsAt;
        const endsAtRaw = body.ends_at ?? body.endAt ?? body.end ?? body.to ?? row.endsAt;
        const startsAt = parseISOWithZone(startsAtRaw);
        const endsAt = parseISOWithZone(endsAtRaw);

        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
            throw new BadRequestException('Invalid datetime format');
        }
        if (endsAt <= startsAt) throw new BadRequestException('Invalid time range');

        const overlap = await this.apptRepo
            .createQueryBuilder('a')
            .leftJoinAndSelect('a.client', 'c')
            .where('a.startsAt < :end AND a.endsAt > :start', { start: startsAt, end: endsAt })
            .orderBy('a.startsAt', 'ASC')
            .getMany();

        if (overlap.length > 0) {
            throw new ConflictException({
                error: 'יש תורים קיימים בתוך הטווח – בטל/י אותם לפני חסימה.',
                conflicts: overlap.slice(0, 20).map(a => ({
                    id: a.id,
                    starts_at: a.startsAt,
                    ends_at: a.endsAt,
                    client_name: a.client ? `${a.client.firstName ?? ''} ${a.client.lastName ?? ''}`.trim() : '',
                })),
            });
        }

        row.startsAt = startsAt;
        row.endsAt = endsAt;
        row.reason = String(body.reason ?? body.desc ?? row.reason ?? '');
        row.membersOnly = parseBoolean(body.members_only ?? body.membersOnly ?? body.members, row.membersOnly);

        const saved = await this.repo.save(row);
        return serializeBlockedTime(saved);
    }

    @Delete(':id')
    async remove(@Param('id') id: string) {
        await this.repo.delete({ id }); // ✔
        return { ok: true };
    }
}
