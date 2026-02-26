import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminPushSubscriptions1741000000000 implements MigrationInterface {
    name = 'CreateAdminPushSubscriptions1741000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "admin_push_subscriptions" (
                "id" SERIAL NOT NULL,
                "admin_phone" character varying(32) NOT NULL,
                "endpoint" text NOT NULL,
                "p256dh" text NOT NULL,
                "auth" text NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_admin_push_subscriptions_endpoint" UNIQUE ("endpoint"),
                CONSTRAINT "PK_admin_push_subscriptions_id" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_admin_push_subscriptions_admin_phone"
            ON "admin_push_subscriptions" ("admin_phone")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "public"."idx_admin_push_subscriptions_admin_phone"');
        await queryRunner.query('DROP TABLE "admin_push_subscriptions"');
    }
}
