import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessHoursOverrides1739000000000 implements MigrationInterface {
    name = 'CreateBusinessHoursOverrides1739000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS business_hours_overrides (
        id SERIAL PRIMARY KEY,
        date date NOT NULL UNIQUE,
        open varchar(8) NOT NULL,
        close varchar(8) NOT NULL,
        slot_interval_minutes integer NOT NULL DEFAULT 30
      )
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE IF EXISTS business_hours_overrides');
    }
}
