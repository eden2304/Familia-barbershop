import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceColor1746000000000 implements MigrationInterface {
    name = 'AddServiceColor1746000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "services"
            ADD COLUMN IF NOT EXISTS "color" varchar(16)
        `);

        // Best-effort backfill so existing services already have a distinct color,
        // matching the black/dark-green convention used for beard services before
        // color became an explicit per-service field.
        const rows: Array<{ id: string; name: string }> = await queryRunner.query(
            `SELECT id, name FROM services ORDER BY order_index ASC, id ASC`,
        );

        const pastelCycle = ['sky', 'amber', 'violet', 'rose', 'emerald', 'pink'];
        const used = new Set<string>();
        let pastelIdx = 0;
        const nextFreePastel = () => {
            while (used.has(pastelCycle[pastelIdx % pastelCycle.length])) pastelIdx++;
            const color = pastelCycle[pastelIdx % pastelCycle.length];
            pastelIdx++;
            return color;
        };

        for (const row of rows) {
            const name = row.name || '';
            const hasBeard = name.includes('זקן') && !name.includes('ללא זקן');
            const isSoldier = name.includes('חייל');

            let color: string;
            if (hasBeard && isSoldier && !used.has('forest')) {
                color = 'forest';
            } else if (hasBeard && !used.has('black')) {
                color = 'black';
            } else {
                color = nextFreePastel();
            }
            used.add(color);

            await queryRunner.query(`UPDATE services SET color = $1 WHERE id = $2`, [color, row.id]);
        }

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "uq_services_color"
            ON "services" ("color")
            WHERE "color" IS NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "uq_services_color"`);
        await queryRunner.query(`ALTER TABLE "services" DROP COLUMN IF EXISTS "color"`);
    }
}
