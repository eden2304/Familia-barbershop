import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1710000000000 implements MigrationInterface {
    name = 'InitSchema1710000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // services (ממופה ל-ServiceEntity)
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        duration_minutes INT NOT NULL DEFAULT 30,
        price INT NOT NULL,
        order_index INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_services_name ON services(name);`);

        // business_hours (ממופה ל-BusinessHour)
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS business_hours (
        id SERIAL PRIMARY KEY,
        weekday INT NOT NULL,                 -- 0=Sunday ... 6=Saturday
        open VARCHAR(8) NOT NULL,             -- 'HH:MM'
        close VARCHAR(8) NOT NULL,            -- 'HH:MM'
        slot_interval_minutes INT NOT NULL DEFAULT 30,
        CONSTRAINT ux_business_hours_weekday UNIQUE (weekday)
      );
    `);

        // admin_phones (ממופה ל-AdminPhone)
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS admin_phones (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(32) NOT NULL UNIQUE
      );
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS admin_phones;`);
        await queryRunner.query(`DROP TABLE IF EXISTS business_hours;`);
        await queryRunner.query(`DROP INDEX IF EXISTS ux_services_name;`);
        await queryRunner.query(`DROP TABLE IF EXISTS services;`);
    }
}
