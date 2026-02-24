import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Param,
    Put as PutRoute,
    Put,
    UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessHour } from '../../entities/business-hour.entity';
import { BusinessHoursOverride } from '../../entities/business-hours-override.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';

const DEFAULT_HOURS = [
    { weekday: 0, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 1, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 2, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 3, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 4, open: '10:00', close: '19:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 5, open: '08:00', close: '15:00', slotIntervalMinutes: 30, isOpen: true },
    { weekday: 6, open: '00:00', close: '00:00', slotIntervalMinutes: 30, isOpen: false },
];

function sanitizeTime(value: any) {
    if (value === null || value === undefined) return null;
    const match = String(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const h = String(match[1]).padStart(2, '0');
    const m = String(match[2]).padStart(2, '0');
    return `${h}:${m}`;
}

function timeToMinutes(value: string | null) {
    if (!value) return null;
    const match = String(value).match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
}

@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminBusinessHoursController {
    constructor(
        @InjectRepository(BusinessHour) private readonly businessHoursRepo: Repository<BusinessHour>,
        @InjectRepository(BusinessHoursOverride) private readonly businessHoursOverrideRepo: Repository<BusinessHoursOverride>,
    ) {}

    private isValidDate(value: string) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
    }

    private weekdayForDate(dateStr: string) {
        return new Date(`${dateStr}T12:00:00+02:00`).getDay();
    }

    private sanitizeTime(value: any) {
        return sanitizeTime(value);
    }

    @Get('business-hours/day/:date')
    async getDay(@Param('date') date: string) {
        const dateStr = String(date || '').trim();
        if (!this.isValidDate(dateStr)) {
            throw new BadRequestException('INVALID_DATE');
        }

        const weekday = this.weekdayForDate(dateStr);
        const base = await this.businessHoursRepo.findOne({ where: { weekday } });
        const override = await this.businessHoursOverrideRepo.findOne({ where: { date: dateStr } });

        const open = String(override?.open ?? base?.open ?? '00:00');
        const close = String(override?.close ?? base?.close ?? '00:00');
        const slotIntervalMinutes = Number(override?.slotIntervalMinutes ?? base?.slotIntervalMinutes ?? 30) || 30;
        const isOpen = Boolean(open && close && open !== close);

        return {
            date: dateStr,
            weekday,
            open: isOpen ? open : null,
            close: isOpen ? close : null,
            open_time: isOpen ? open : null,
            close_time: isOpen ? close : null,
            slotIntervalMinutes,
            slot_interval_minutes: slotIntervalMinutes,
            isOpen,
            is_open: isOpen,
            isClosed: !isOpen,
            is_closed: !isOpen,
            hasOverride: Boolean(override),
            has_override: Boolean(override),
        };
    }

    @PutRoute('business-hours/day/:date')
    async updateDay(@Param('date') date: string, @Body() body: any) {
        const dateStr = String(date || '').trim();
        if (!this.isValidDate(dateStr)) {
            throw new BadRequestException('INVALID_DATE');
        }

        const weekday = this.weekdayForDate(dateStr);
        const base = await this.businessHoursRepo.findOne({ where: { weekday } });
        const openCandidate = this.sanitizeTime(body?.open ?? body?.open_time ?? body?.openTime);
        const closeCandidate = this.sanitizeTime(body?.close ?? body?.close_time ?? body?.closeTime);
        const isOpenFlag = body?.isOpen ?? body?.is_open ?? (body?.isClosed !== undefined ? !body?.isClosed : undefined);
        const resolvedIsOpen = isOpenFlag !== undefined
            ? Boolean(isOpenFlag)
            : Boolean(openCandidate && closeCandidate && openCandidate !== closeCandidate);

        const slotIntervalMinutes = Number(
            body?.slotIntervalMinutes ??
            body?.slot_interval_minutes ??
            base?.slotIntervalMinutes ??
            30,
        ) || 30;

        const fallback = DEFAULT_HOURS.find((h) => h.weekday === weekday);
        const open = resolvedIsOpen ? (openCandidate ?? base?.open ?? fallback?.open ?? '00:00') : '00:00';
        const close = resolvedIsOpen ? (closeCandidate ?? base?.close ?? fallback?.close ?? '00:00') : '00:00';

        if (resolvedIsOpen) {
            const openMin = timeToMinutes(open);
            const closeMin = timeToMinutes(close);
            if (openMin === null || closeMin === null) {
                throw new BadRequestException('INVALID_HOUR_VALUE');
            }
            if (closeMin <= openMin) {
                throw new BadRequestException('INVALID_HOUR_RANGE');
            }
        }

        const existing = await this.businessHoursOverrideRepo.findOne({ where: { date: dateStr } });
        const row = existing ?? this.businessHoursOverrideRepo.create({ date: dateStr });
        row.open = open;
        row.close = close;
        row.slotIntervalMinutes = slotIntervalMinutes;
        await this.businessHoursOverrideRepo.save(row);

        const isOpen = Boolean(open && close && open !== close);
        return {
            date: dateStr,
            weekday,
            open: isOpen ? open : null,
            close: isOpen ? close : null,
            open_time: isOpen ? open : null,
            close_time: isOpen ? close : null,
            slotIntervalMinutes,
            slot_interval_minutes: slotIntervalMinutes,
            isOpen,
            is_open: isOpen,
            isClosed: !isOpen,
            is_closed: !isOpen,
            hasOverride: true,
            has_override: true,
        };
    }

    @Put('business-hours')
    async updateAll(@Body() body: any) {
        const candidate = Array.isArray(body?.hours)
            ? body.hours
            : Array.isArray(body)
                ? body
                : Array.isArray(body?.data)
                    ? body.data
                    : [];

        if (!Array.isArray(candidate) || candidate.length === 0) {
            throw new BadRequestException('EMPTY_BUSINESS_HOURS');
        }

        const normalized = new Map<number, {
            weekday: number;
            open: string | null;
            close: string | null;
            slotIntervalMinutes: number;
            isOpen: boolean;
        }>();

        for (const row of candidate) {
            if (!row) continue;
            const weekdayRaw = row.weekday ?? row.day ?? row.day_of_week ?? row.dayOfWeek;
            const weekday = Number(weekdayRaw);
            if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;

            const slot = Number(
                row.slotIntervalMinutes ??
                row.slot_interval_minutes ??
                row.slotMinutes ??
                row.slot ??
                row.interval ??
                30,
            ) || 30;

            const openCandidate = sanitizeTime(row.open ?? row.open_time ?? row.openTime);
            const closeCandidate = sanitizeTime(row.close ?? row.close_time ?? row.closeTime);
            const isOpenFlag = row.isOpen ?? row.is_open ?? (row.isClosed !== undefined ? !row.isClosed : undefined);
            const resolvedIsOpen = isOpenFlag !== undefined
                ? Boolean(isOpenFlag)
                : Boolean(openCandidate && closeCandidate && openCandidate !== closeCandidate);

            const fallback = DEFAULT_HOURS.find((h) => h.weekday === weekday);
            const open = resolvedIsOpen ? (openCandidate ?? fallback?.open ?? '00:00') : '00:00';
            const close = resolvedIsOpen ? (closeCandidate ?? fallback?.close ?? '00:00') : '00:00';

            if (resolvedIsOpen) {
                const openMin = timeToMinutes(open);
                const closeMin = timeToMinutes(close);
                if (openMin === null || closeMin === null) {
                    throw new BadRequestException('INVALID_HOUR_VALUE');
                }
                if (closeMin <= openMin) {
                    throw new BadRequestException('INVALID_HOUR_RANGE');
                }
            }

            normalized.set(weekday, {
                weekday,
                open,
                close,
                slotIntervalMinutes: slot,
                isOpen: resolvedIsOpen,
            });
        }

        const rowsToSave = Array.from(normalized.values()).map((row) => ({
            weekday: row.weekday,
            open: row.open,
            close: row.close,
            slotIntervalMinutes: row.slotIntervalMinutes,
        }));

        await this.businessHoursRepo.upsert(rowsToSave, ['weekday']);

        const fresh = await this.businessHoursRepo.find({
            order: { weekday: 'ASC', id: 'ASC' },
        });

        return fresh.map((row) => {
            const isOpen = Boolean(row.open && row.close && row.open !== row.close);
            return {
                weekday: row.weekday,
                open: isOpen ? row.open : null,
                close: isOpen ? row.close : null,
                slotIntervalMinutes: row.slotIntervalMinutes,
                slot_interval_minutes: row.slotIntervalMinutes,
                slot: row.slotIntervalMinutes,
                isOpen,
                is_open: isOpen,
                isClosed: !isOpen,
                is_closed: !isOpen,
                open_time: isOpen ? row.open : null,
                close_time: isOpen ? row.close : null,
            };
        });
    }
}
