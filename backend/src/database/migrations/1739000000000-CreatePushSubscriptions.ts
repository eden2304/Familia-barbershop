import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePushSubscriptions1739000000000 implements MigrationInterface {
    name = 'CreatePushSubscriptions1739000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            create table if not exists push_subscriptions (
                id serial primary key,
                phone varchar(32) not null,
                endpoint text not null,
                p256dh text not null,
                auth text not null,
                user_agent text null,
                created_at timestamptz not null default now(),
                last_seen_at timestamptz not null default now()
            )
        `);
        await queryRunner.query(`create unique index if not exists uq_push_subscriptions_endpoint on push_subscriptions(endpoint)`);
        await queryRunner.query(`create unique index if not exists uq_push_subscriptions_phone_endpoint on push_subscriptions(phone, endpoint)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`drop table if exists push_subscriptions`);
    }
}
