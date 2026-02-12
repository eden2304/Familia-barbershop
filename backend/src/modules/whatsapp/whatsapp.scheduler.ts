import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { WhatsAppMessageLog } from '../../entities/whatsapp-message-log.entity';
import { WhatsAppService } from './whatsapp.service';
import { DateTime } from 'luxon';
import { sleep } from './whatsapp.utils';

@Injectable()
export class WhatsAppReminderScheduler implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WhatsAppReminderScheduler.name);
    private readonly cronExpr = process.env.WHATSAPP_REMINDER_CRON || '0 8 * * *';
    private readonly timeZone = process.env.WHATSAPP_TIMEZONE || 'Asia/Jerusalem';
    private readonly logRetentionDays = this.parsePositiveInt(process.env.WHATSAPP_LOG_RETENTION_DAYS, 3);
    private readonly cleanupEveryHours = this.parsePositiveInt(process.env.WHATSAPP_LOG_CLEANUP_EVERY_HOURS, 72);
    private timer: NodeJS.Timeout | null = null;
    private lastRunKey: string | null = null;
    private lastCleanupAt: DateTime | null = null;

    constructor(
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
        @InjectRepository(WhatsAppMessageLog) private readonly messageLogRepo: Repository<WhatsAppMessageLog>,
        private readonly whatsappService: WhatsAppService,
    ) {}

    onModuleInit() {
        this.timer = setInterval(() => {
            this.tick().catch(error => {
                this.logger.warn(`WhatsApp reminder tick failed: ${error?.message || error}`);
            });
        }, 60_000);

        this.tick().catch(error => {
            this.logger.warn(`WhatsApp reminder initial tick failed: ${error?.message || error}`);
        });
    }

    private parsePositiveInt(value: string | undefined, fallback: number): number {
        const parsed = Number.parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return fallback;
        }
        return parsed;
    }

    onModuleDestroy() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private parseMinuteHour(cronExpr: string): { minute: number; hour: number } {
        const parts = String(cronExpr || '').trim().split(/\s+/);
        if (parts.length !== 5) return { minute: 0, hour: 8 };
        const minute = Number(parts[0]);
        const hour = Number(parts[1]);
        if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { minute: 0, hour: 8 };
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { minute: 0, hour: 8 };
        return { minute, hour };
    }

    private async tick() {
        await this.cleanupMessageLogs();

        if (!this.whatsappService.isEnabled()) {
            return;
        }

        const now = DateTime.now().setZone(this.timeZone);
        const { minute, hour } = this.parseMinuteHour(this.cronExpr);

        if (now.hour !== hour || now.minute !== minute) {
            return;
        }

        const runKey = now.toFormat('yyyy-LL-dd-HH-mm');
        if (this.lastRunKey === runKey) {
            return;
        }
        this.lastRunKey = runKey;

        await this.sendSameDayReminders();
    }

    private async cleanupMessageLogs() {
        const now = DateTime.now().setZone(this.timeZone);
        if (this.lastCleanupAt) {
            const hoursSinceLastCleanup = now.diff(this.lastCleanupAt, 'hours').hours;
            if (hoursSinceLastCleanup < this.cleanupEveryHours) {
                return;
            }
        }

        const cutoff = now.minus({ days: this.logRetentionDays }).toUTC().toJSDate();
        const result = await this.messageLogRepo
            .createQueryBuilder()
            .delete()
            .from(WhatsAppMessageLog)
            .where('created_at < :cutoff', { cutoff: cutoff.toISOString() })
            .execute();

        this.lastCleanupAt = now;
        const deletedCount = result.affected ?? 0;
        if (deletedCount > 0) {
            this.logger.log(`WhatsApp logs cleanup removed ${deletedCount} rows older than ${this.logRetentionDays} days`);
        }
    }

    private async sendSameDayReminders() {
        const tz = this.whatsappService.getTimeZone();
        const now = DateTime.now().setZone(tz);
        const startOfDay = now.startOf('day').toUTC().toJSDate();
        const endOfDay = now.endOf('day').toUTC().toJSDate();

        const appointments = await this.apptRepo.find({
            where: { startsAt: Between(startOfDay, endOfDay) },
            relations: ['client', 'service'],
            order: { startsAt: 'ASC' },
        });

        for (const appointment of appointments) {
            const status = (appointment as any)?.status ?? (appointment as any)?.status_name;
            if (String(status || '').toLowerCase() === 'canceled') {
                continue;
            }
            await this.whatsappService.sendAppointmentReminderSameDay(appointment);
            await sleep(200);
        }
    }
}
