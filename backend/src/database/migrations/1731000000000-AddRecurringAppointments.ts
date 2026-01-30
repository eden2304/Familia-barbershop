import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecurringAppointments1731000000000 implements MigrationInterface {
    name = 'AddRecurringAppointments1731000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
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

        await queryRunner.query(`alter table appointments add column if not exists recurring_id int`);
        await queryRunner.query(`alter table recurring_appointments add column if not exists interval_months int`);
        await queryRunner.query(`alter table recurring_appointments add column if not exists day_of_month int`);

        await queryRunner.query(`drop index if exists ux_recurring_unique`);
        await queryRunner.query(`
            create unique index if not exists ux_recurring_unique
                on recurring_appointments (client_id, service_id, coalesce(interval_months, 0), coalesce(day_of_month, weekday), start_time)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`drop index if exists ux_recurring_unique`);
        await queryRunner.query(`alter table appointments drop column if exists recurring_id`);
        await queryRunner.query(`drop table if exists recurring_appointments`);
    }
}
