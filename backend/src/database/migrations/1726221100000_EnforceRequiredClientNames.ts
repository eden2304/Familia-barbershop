import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceRequiredClientNames1726221100000 implements MigrationInterface {
    name = 'EnforceRequiredClientNames1726221100000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // נוודא שאין DEFAULT על first_name/last_name
        await queryRunner.query(`ALTER TABLE "clients" ALTER COLUMN "first_name" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "clients" ALTER COLUMN "last_name" DROP DEFAULT`);

        // גיבוי מינימלי: אם יש NULL היסטורי, נהפוך ל־'' כדי לא להפיל את המיגרציה.
        // (אין כאן דיפולטים קדימה; רק תיקון נתונים עבר)
        await queryRunner.query(`UPDATE "clients" SET "first_name" = '' WHERE "first_name" IS NULL`);
        await queryRunner.query(`UPDATE "clients" SET "last_name"  = '' WHERE "last_name"  IS NULL`);

        // אכיפת NOT NULL
        await queryRunner.query(`ALTER TABLE "clients" ALTER COLUMN "first_name" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "clients" ALTER COLUMN "last_name"  SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // ביטול NOT NULL (לא מחזירים דיפולטים)
        await queryRunner.query(`ALTER TABLE "clients" ALTER COLUMN "last_name"  DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "clients" ALTER COLUMN "first_name" DROP NOT NULL`);
    }
}
