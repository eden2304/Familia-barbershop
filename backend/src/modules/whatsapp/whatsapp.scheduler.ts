import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { WhatsAppService } from './whatsapp.service';
import { DateTime } from 'luxon';
import { sleep } from './whatsapp.utils';

@Injectable()
export class WhatsAppReminderScheduler implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WhatsAppReminderScheduler.name);
    private readonly cronExpr = process.env.WHATSAPP_REMINDER_CRON || '0 8 * * *';
    private readonly timeZone = process.env.WHATSAPP_TIMEZONE || 'Asia/Jerusalem';
    private timer: NodeJS.Timeout | null = null;
    private lastRunKey: string | null = null;

    constructor(
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
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
