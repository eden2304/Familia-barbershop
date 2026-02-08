import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWhatsappLogs1735000000000 implements MigrationInterface {
    name = 'CreateWhatsappLogs1735000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_message_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        to_phone VARCHAR(32) NOT NULL,
        template_name VARCHAR(128) NOT NULL,
        payload_json JSONB NOT NULL,
        status VARCHAR(32) NOT NULL,
        meta_message_id VARCHAR(128),
        error TEXT,
        appointment_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_appt_template ON whatsapp_message_logs(appointment_id, template_name);`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_created_at ON whatsapp_message_logs(created_at);`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS idx_whatsapp_logs_created_at;`);
        await queryRunner.query(`DROP INDEX IF EXISTS idx_whatsapp_logs_appt_template;`);
        await queryRunner.query(`DROP TABLE IF EXISTS whatsapp_message_logs;`);
    }
}
