import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DateTime } from 'luxon';

/**
 * מוחק לגמרי תורים שסומנו כתשלום במזומן ("cash") בסוף כל יום.
 * תורים בכרטיס אשראי ("credit") ותורים ללא אמצעי תשלום (null) לא נגעים.
 *
 * ריצה: משימת חצות ייעודית לפי אזור הזמן Asia/Jerusalem, בתוספת ריצת השלמה
 * פעם אחת בעליית השרת (למקרה שהשרת היה כבוי בחצות).
 */
@Injectable()
export class CashCleanupScheduler implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(CashCleanupScheduler.name);
    private readonly timeZone = process.env.CASH_CLEANUP_TIMEZONE || 'Asia/Jerusalem';
    private readonly runHour = this.parseHour(process.env.CASH_CLEANUP_HOUR, 0);
    private timer: NodeJS.Timeout | null = null;
    private lastRunKey: string | null = null;

    constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

    async onModuleInit() {
        // ביטוח: אם המיגרציה עוד לא רצה בסביבה הזו, נוודא שהעמודה קיימת
        try {
            await this.dataSource.query(
                `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "payment_method" varchar(16)`,
            );
        } catch (error) {
            this.logger.warn(
                `Failed ensuring payment_method column: ${error instanceof Error ? error.message : error}`,
            );
        }

        this.timer = setInterval(() => {
            this.tick().catch(error => {
                this.logger.warn(`Cash cleanup tick failed: ${error?.message || error}`);
            });
        }, 60_000);

        // ריצת השלמה מיידית לתורי מזומן של ימים שכבר הסתיימו
        this.purgePastCashAppointments('startup').catch(error => {
            this.logger.warn(`Cash cleanup initial run failed: ${error?.message || error}`);
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
        await this.purgePastCashAppointments('midnight');
    }

    private async purgePastCashAppointments(trigger: 'startup' | 'midnight') {
        // תחילת היום הנוכחי לפי אזור הזמן המקומי, מומרת ל-UTC
        const startOfToday = DateTime.now().setZone(this.timeZone).startOf('day').toUTC().toJSDate();

        const result = await this.dataSource
            .createQueryBuilder()
            .delete()
            .from('appointments')
            .where(`payment_method = 'cash'`)
            .andWhere('COALESCE(ends_at, starts_at) < :cutoff', { cutoff: startOfToday })
            .execute();

        const deleted = result.affected ?? 0;
        if (deleted > 0) {
            this.logger.log(`Cash cleanup (${trigger}) removed ${deleted} past cash appointment(s)`);
        }
    }
}
