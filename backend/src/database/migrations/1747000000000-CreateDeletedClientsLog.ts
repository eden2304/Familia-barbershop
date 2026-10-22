import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeletedClientsLog1747000000000 implements MigrationInterface {
    name = 'CreateDeletedClientsLog1747000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "deleted_clients_log" (
                "id" SERIAL PRIMARY KEY,
                "client_id" integer NOT NULL,
                "first_name" character varying(80),
                "last_name" character varying(120),
                "phone" character varying(20),
                "is_member" boolean,
                "last_appointment_at" TIMESTAMPTZ,
                "client_created_at" TIMESTAMPTZ,
                "reason" character varying(32) NOT NULL,
                "deleted_at" TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_deleted_clients_log_client_id"
            ON "deleted_clients_log" ("client_id");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_deleted_clients_log_client_id";`);
        await queryRunner.query(`DROP TABLE IF EXISTS "deleted_clients_log";`);
    }
}
