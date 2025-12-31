import { Controller, Get } from '@nestjs/common';
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
}
