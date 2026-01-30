import { DataSource } from 'typeorm';

export const MAX_RECURRING_OCCURRENCES = 60;

export function formatHHmm(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

export function addMonthsSafe(date: Date, months: number): Date {
    const base = new Date(date.getTime());
    const targetMonth = base.getMonth() + months;
    const targetDay = base.getDate();
    base.setDate(1);
    base.setMonth(targetMonth);
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    base.setDate(Math.min(targetDay, daysInMonth));
    return base;
}

async function tableHasColumn(ds: DataSource, table: string, column: string): Promise<boolean> {
    const rows = await ds.query(
        `select exists(
            select 1 from information_schema.columns
            where table_schema = current_schema()
              and table_name = $1
              and column_name = $2
        ) as exists`,
        [table, column],
    );
    return Boolean(rows?.[0]?.exists);
}

async function ensureColumn(ds: DataSource, table: string, column: string, pgType: string): Promise<void> {
    const has = await tableHasColumn(ds, table, column);
    if (has) return;
    await ds.query(`alter table ${table} add column ${column} ${pgType}`);
}

export async function ensureRecurringSchema(ds: DataSource): Promise<void> {
    await ds.query(`
        create table if not exists recurring_appointments (
            id serial primary key,
            client_id int not null references clients(id) on delete cascade,
            service_id int not null references services(id) on delete cascade,
            weekday int not null,
            start_time varchar(8) not null,
            interval_weeks int not null default 1,
            interval_months int,
            day_of_month int,
            created_at timestamptz not null default now()
        )
    `);

    await ensureColumn(ds, 'recurring_appointments', 'interval_months', 'int');
    await ensureColumn(ds, 'recurring_appointments', 'day_of_month', 'int');
    await ensureColumn(ds, 'appointments', 'recurring_id', 'int');

    await ds.query(`drop index if exists ux_recurring_unique`);
    await ds.query(`
        create unique index if not exists ux_recurring_unique
            on recurring_appointments (client_id, service_id, coalesce(interval_months, 0), coalesce(day_of_month, weekday), start_time)
    `);
}
