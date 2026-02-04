import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBackgroundVideoPreview1734000000001 implements MigrationInterface {
    name = 'AddBackgroundVideoPreview1734000000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "background_videos" ADD COLUMN IF NOT EXISTS "image_url" TEXT`);
        await queryRunner.query(`ALTER TABLE "background_videos" ADD COLUMN IF NOT EXISTS "full_url" TEXT`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "background_videos" DROP COLUMN IF EXISTS "full_url"`);
        await queryRunner.query(`ALTER TABLE "background_videos" DROP COLUMN IF EXISTS "image_url"`);
    }
}
