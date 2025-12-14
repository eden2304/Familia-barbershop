import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCoreTables1710000000001 implements MigrationInterface {
    name = 'CreateCoreTables1710000000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(80) NOT NULL,
        last_name VARCHAR(120) NOT NULL DEFAULT '',
        phone VARCHAR(20) NOT NULL,
        is_member BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_clients_phone" ON "clients" ("phone");`);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        client_id INTEGER NOT NULL,
        service_id INTEGER NOT NULL,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ,
        CONSTRAINT fk_appointments_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        CONSTRAINT fk_appointments_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT
      );
    `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_appointments_service ON appointments(service_id);`);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS blocked_times (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        reason VARCHAR(255) NOT NULL,
        members_only BOOLEAN NOT NULL DEFAULT FALSE,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL
      );
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS waiting_list (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        client_id INTEGER NOT NULL,
        service_id INTEGER,
        date DATE NOT NULL,
        time VARCHAR(5) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'open',
        CONSTRAINT fk_waiting_list_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        CONSTRAINT fk_waiting_list_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
      );
    `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_waiting_list_client ON waiting_list(client_id);`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_waiting_list_service ON waiting_list(service_id);`);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(200) NOT NULL,
        price INTEGER NOT NULL,
        image_url TEXT,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      );
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS testimonials (
        id SERIAL PRIMARY KEY,
        author VARCHAR(200) NOT NULL,
        text TEXT NOT NULL,
        rating INT NOT NULL DEFAULT 5,
        order_index INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_testimonials_order ON testimonials(order_index);`);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS gallery_videos (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        video_url TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      );
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS background_videos (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        url TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        order_index INTEGER NOT NULL DEFAULT 0
      );
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(64) PRIMARY KEY,
        value JSONB NOT NULL
      );
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS settings;`);
        await queryRunner.query(`DROP TABLE IF EXISTS background_videos;`);
        await queryRunner.query(`DROP TABLE IF EXISTS gallery_videos;`);
        await queryRunner.query(`DROP INDEX IF EXISTS idx_testimonials_order;`);
        await queryRunner.query(`DROP TABLE IF EXISTS testimonials;`);
        await queryRunner.query(`DROP TABLE IF EXISTS products;`);
        await queryRunner.query(`DROP INDEX IF EXISTS idx_waiting_list_service;`);
        await queryRunner.query(`DROP INDEX IF EXISTS idx_waiting_list_client;`);
        await queryRunner.query(`DROP TABLE IF EXISTS waiting_list;`);
        await queryRunner.query(`DROP TABLE IF EXISTS blocked_times;`);
        await queryRunner.query(`DROP INDEX IF EXISTS idx_appointments_service;`);
        await queryRunner.query(`DROP INDEX IF EXISTS idx_appointments_client;`);
        await queryRunner.query(`DROP TABLE IF EXISTS appointments;`);
        await queryRunner.query(`DROP INDEX IF EXISTS "UQ_clients_phone";`);
        await queryRunner.query(`DROP TABLE IF EXISTS clients;`);
    }
}
