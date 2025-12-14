import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientsPhoneUnique1726221000000 implements MigrationInterface {
    name = 'ClientsPhoneUnique1726221000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    UPDATE clients
    SET phone = '0' || SUBSTRING(phone FROM 4)
    WHERE phone ~ '^972[0-9]+' AND NOT phone LIKE '0%';

    UPDATE clients
    SET phone = REGEXP_REPLACE(phone, '\\D', '', 'g')
    WHERE phone ~ '\\D';

    WITH ranked AS (
      SELECT id, phone,
             ROW_NUMBER() OVER (PARTITION BY phone ORDER BY id) AS rn
      FROM clients
    )
    DELETE FROM clients
    USING ranked
    WHERE clients.id = ranked.id
      AND ranked.rn > 1;

    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_clients_phone" ON "clients" ("phone")';
  END IF;
END $$;
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX IF EXISTS "UQ_clients_phone";
        `);
    }
}
