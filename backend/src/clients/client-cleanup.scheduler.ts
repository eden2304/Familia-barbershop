import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DateTime } from 'luxon';

/**
 * מוחק אוטומטית לקוחות שאינם פעילים, כדי לשמור על המערכת נקייה:
 *  - לקוח עם תור אחרון (last_appointment_at) שעבר מעל חודש וחצי - נמחק.
 *  - לקוח שנרשם ואין לו היסטוריית תורים בכלל ("אין היסטוריה") - מקבל חודש
 *    לקבוע תור ראשון; אם לא קבע תוך חודש מההרשמה - נמחק.
 * חברי מועדון (is_member) מוחרגים לחלוטין מהמחיקה האוטומטית.
 *
 * כל לקוח שנמחק נרשם קודם ל-deleted_clients_log (לוג בלתי הפיך - המחיקה
 * מוחקת בקאסקייד גם תורים, מנויי webauthn, refresh tokens וכו').
 *
 * ריצה: משימת לילה ייעודית לפי אזור הזמן Asia/Jerusalem, בתוספת ריצת השלמה
 * פעם אחת בעליית השרת (זו גם מבצעת את ניקוי החד-פעמי של הלקוחות הקיימים).
 */
@Injectable()
export class ClientCleanupScheduler implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ClientCleanupScheduler.name);
    private readonly timeZone = process.env.CLIENT_CLEANUP_TIMEZONE || 'Asia/Jerusalem';
    private readonly runHour = this.parseHour(process.env.CLIENT_CLEANUP_HOUR, 1);
    private readonly inactiveDays = this.parseDays(process.env.CLIENT_CLEANUP_INACTIVE_DAYS, 45);
    private readonly noHistoryDays = this.parseDays(process.env.CLIENT_CLEANUP_NO_HISTORY_DAYS, 30);
    private timer: NodeJS.Timeout | null = null;
    private lastRunKey: string | null = null;

    constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

    async onModuleInit() {
        try {
            await this.dataSource.query(`
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
                )
            `);
        } catch (error) {
            this.logger.warn(
                `Failed ensuring deleted_clients_log table: ${error instanceof Error ? error.message : error}`,
            );
        }

        this.timer = setInterval(() => {
            this.tick().catch(error => {
                this.logger.warn(`Client cleanup tick failed: ${error?.message || error}`);
            });
        }, 60_000);

        // ריצת השלמה מיידית - גם מבצעת את הניקוי החד-פעמי של לקוחות קיימים
        this.purgeStaleClients('startup').catch(error => {
            this.logger.warn(`Client cleanup initial run failed: ${error?.message || error}`);
        });
    }

    onModuleDestroy() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private parseHour(value: string | undefined, fallback: number): number {
        const parsed = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
            return fallback;
        }
        return parsed;
    }

    private parseDays(value: string | undefined, fallback: number): number {
        const parsed = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return fallback;
        }
        return parsed;
    }

    private async tick() {
        const now = DateTime.now().setZone(this.timeZone);
        if (now.hour !== this.runHour || now.minute !== 0) {
            return;
        }
        const runKey = now.toFormat('yyyy-LL-dd');
        if (this.lastRunKey === runKey) {
            return;
        }
        this.lastRunKey = runKey;
        await this.purgeStaleClients('nightly');
    }

    private async purgeStaleClients(trigger: 'startup' | 'nightly') {
        const inactiveCutoff = DateTime.now().minus({ days: this.inactiveDays }).toUTC().toJSDate();
        const noHistoryCutoff = DateTime.now().minus({ days: this.noHistoryDays }).toUTC().toJSDate();

        const inactiveDeleted = await this.deleteAndLog(
            `is_member = false AND last_appointment_at IS NOT NULL AND last_appointment_at < $1`,
            [inactiveCutoff],
            'inactive',
        );

        const noHistoryDeleted = await this.deleteAndLog(
            `is_member = false AND last_appointment_at IS NULL AND created_at < $1`,
            [noHistoryCutoff],
            'no_history_expired',
        );

        const total = inactiveDeleted + noHistoryDeleted;
        if (total > 0) {
            this.logger.log(
                `Client cleanup (${trigger}) removed ${inactiveDeleted} inactive and ${noHistoryDeleted} no-history client(s)`,
            );
        }
    }

    private async deleteAndLog(whereClause: string, params: unknown[], reason: 'inactive' | 'no_history_expired'): Promise<number> {
        const reasonParamIndex = params.length + 1;
        const rows = await this.dataSource.query(
            `
            WITH deleted AS (
                DELETE FROM clients
                WHERE ${whereClause}
                RETURNING id, first_name, last_name, phone, is_member, last_appointment_at, created_at
            )
            INSERT INTO deleted_clients_log
                (client_id, first_name, last_name, phone, is_member, last_appointment_at, client_created_at, reason, deleted_at)
            SELECT id, first_name, last_name, phone, is_member, last_appointment_at, created_at, $${reasonParamIndex}, now()
            FROM deleted
            RETURNING client_id
            `,
            [...params, reason],
        );
        return Array.isArray(rows) ? rows.length : 0;
    }
}
