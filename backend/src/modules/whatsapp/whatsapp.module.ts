import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Appointment } from '../../entities/appointment.entity';
import { WhatsAppMessageLog } from '../../entities/whatsapp-message-log.entity';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppReminderScheduler } from './whatsapp.scheduler';

@Module({
    imports: [TypeOrmModule.forFeature([Appointment, WhatsAppMessageLog]), ScheduleModule.forRoot()],
    providers: [WhatsAppService, WhatsAppReminderScheduler],
    exports: [WhatsAppService],
})
export class WhatsAppModule {}
