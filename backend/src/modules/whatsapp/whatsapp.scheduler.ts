import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { WhatsAppService } from './whatsapp.service';
import { DateTime } from 'luxon';
import { sleep } from './whatsapp.utils';

@Injectable()
export class WhatsAppReminderScheduler {
    private readonly logger = new Logger(WhatsAppReminderScheduler.name);

    constructor(
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
        private readonly whatsappService: WhatsAppService,
    ) {}

    @Cron(process.env.WHATSAPP_REMINDER_CRON || '0 8 * * *', {
        timeZone: process.env.WHATSAPP_TIMEZONE || 'Asia/Jerusalem',
    })
    async sendSameDayReminders() {
        if (!this.whatsappService.isEnabled()) {
            this.logger.debug('WhatsApp reminders skipped (disabled).');
            return;
        }

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
