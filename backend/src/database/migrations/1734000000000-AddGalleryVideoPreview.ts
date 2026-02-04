import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGalleryVideoPreview1734000000000 implements MigrationInterface {
    name = 'AddGalleryVideoPreview1734000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "gallery_videos" ADD COLUMN IF NOT EXISTS "image_url" TEXT`);
        await queryRunner.query(`ALTER TABLE "gallery_videos" ADD COLUMN IF NOT EXISTS "full_url" TEXT`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "gallery_videos" DROP COLUMN IF EXISTS "full_url"`);
        await queryRunner.query(`ALTER TABLE "gallery_videos" DROP COLUMN IF EXISTS "image_url"`);
    }
}
