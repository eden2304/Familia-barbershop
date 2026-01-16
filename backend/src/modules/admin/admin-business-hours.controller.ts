import { Body, Controller, Put, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessHour } from '../../entities/business-hour.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';

type BusinessHourPayload = {
    weekday?: number;
    open?: string | null;
    close?: string | null;
    slotIntervalMinutes?: number;
    slot_interval_minutes?: number;
    isOpen?: boolean;
    is_open?: boolean;
};

const sanitizeTime = (value?: string | null) => {
    if (!value) return null;
    const match = String(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hh = String(match[1]).padStart(2, '0');
    const mm = String(match[2]).padStart(2, '0');
    return `${hh}:${mm}`;
};

@Controller('admin/business-hours')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminBusinessHoursController {
    constructor(@InjectRepository(BusinessHour) private repo: Repository<BusinessHour>) {}

    @Put()
    async updateAll(@Body() body: { hours?: BusinessHourPayload[] }) {
        const rows = Array.isArray(body?.hours) ? body.hours : [];
        for (const row of rows) {
            const weekday = Number(row.weekday);
            if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
            const slotIntervalMinutes = Number(row.slotIntervalMinutes ?? row.slot_interval_minutes ?? 30) || 30;
            const isOpen = row.isOpen ?? row.is_open ?? true;
            const open = sanitizeTime(row.open ?? undefined);
            const close = sanitizeTime(row.close ?? undefined);
            const openVal = isOpen ? (open ?? '10:00') : '00:00';
            const closeVal = isOpen ? (close ?? '18:00') : '00:00';

            const existing = await this.repo.findOne({ where: { weekday } });
            if (existing) {
                await this.repo.update({ id: existing.id }, {
                    open: openVal,
                    close: closeVal,
                    slotIntervalMinutes,
                });
            } else {
                await this.repo.save(this.repo.create({
                    weekday,
                    open: openVal,
                    close: closeVal,
                    slotIntervalMinutes,
                }));
            }
        }

        const list = await this.repo.find({ order: { weekday: 'ASC', id: 'ASC' } });
        return list.map((row) => ({
            ...row,
            isOpen: Boolean(row.open && row.close && row.open !== row.close),
            is_open: Boolean(row.open && row.close && row.open !== row.close),
        }));
    }
}
