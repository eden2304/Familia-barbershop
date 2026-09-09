import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppointmentPaymentMethod1743000000000 implements MigrationInterface {
    name = 'AddAppointmentPaymentMethod1743000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "appointments"
            ADD COLUMN IF NOT EXISTS "payment_method" varchar(16)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "appointments"
            DROP COLUMN IF EXISTS "payment_method"
        `);
    }
}
