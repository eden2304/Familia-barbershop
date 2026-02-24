import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';

function defaultBusinessHoursRows() {
    // weekday: 0=Sunday ... 6=Saturday
    return [
        { weekday: 0, open: '10:00', close: '19:00', slot_interval_minutes: 30 },
        { weekday: 1, open: '10:00', close: '19:00', slot_interval_minutes: 30 },
        { weekday: 2, open: '10:00', close: '19:00', slot_interval_minutes: 30 },
        { weekday: 3, open: '10:00', close: '19:00', slot_interval_minutes: 30 },
        { weekday: 4, open: '10:00', close: '19:00', slot_interval_minutes: 30 },
        { weekday: 5, open: '08:00', close: '15:00', slot_interval_minutes: 30 },
        // שבת סגור – נשאיר 00:00-00:00 (הפרונט מזהה סגור או שאין טווח)
        { weekday: 6, open: '00:00', close: '00:00', slot_interval_minutes: 30 },
    ];
}

async function seedBusinessHoursIfEmpty(ds: DataSource) {
    const [{ count }] = await ds.query(`SELECT COUNT(*)::int AS count FROM business_hours`);
    if (count > 0) return;

    const rows = defaultBusinessHoursRows();
    for (const r of rows) {
        await ds.query(
            `INSERT INTO business_hours (weekday, open, close, slot_interval_minutes)
       VALUES ($1, $2, $3, $4)`,
            [r.weekday, r.open, r.close, r.slot_interval_minutes],
        );
    }
}

@Controller()
export class BusinessHoursPublicController {
    constructor(private readonly ds: DataSource) {}

    private isValidDate(value: string) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
    }

    @Public()
    @Get('business-hours')
    async list() {
        await seedBusinessHoursIfEmpty(this.ds);

        // מחזיר בדיוק את הפורמט שהפרונט יודע לנרמל
        return this.ds.query(
            `SELECT id, weekday, open, close, slot_interval_minutes
       FROM business_hours
       ORDER BY weekday ASC, id ASC`,
        );
    }

    @Public()
    @Get('business-hours/day')
    async day(@Query('date') date: string) {
        const dateStr = String(date || '').trim();
        if (!this.isValidDate(dateStr)) {
            throw new BadRequestException('INVALID_DATE');
        }

        await seedBusinessHoursIfEmpty(this.ds);

        const offset = '+02:00';
        const jsDow = new Date(`${dateStr}T12:00:00${offset}`).getDay();
        const [base] = await this.ds.query(
            `SELECT id, weekday, open, close, slot_interval_minutes
       FROM business_hours
       WHERE weekday = $1
       ORDER BY id ASC
       LIMIT 1`,
            [jsDow],
        );

        const [override] = await this.ds.query(
            `SELECT id, date, open, close, slot_interval_minutes
       FROM business_hours_overrides
       WHERE date = $1
       LIMIT 1`,
            [dateStr],
        );

        const open = String(override?.open ?? base?.open ?? '00:00');
        const close = String(override?.close ?? base?.close ?? '00:00');
        const slot = Number(override?.slot_interval_minutes ?? base?.slot_interval_minutes ?? 30) || 30;
        const isOpen = Boolean(open && close && open !== close);

        return {
            date: dateStr,
            weekday: jsDow,
            open: isOpen ? open : null,
            close: isOpen ? close : null,
            open_time: isOpen ? open : null,
            close_time: isOpen ? close : null,
            slotIntervalMinutes: slot,
            slot_interval_minutes: slot,
            isOpen,
            is_open: isOpen,
            isClosed: !isOpen,
            is_closed: !isOpen,
            hasOverride: Boolean(override),
            has_override: Boolean(override),
        };
    }
}
