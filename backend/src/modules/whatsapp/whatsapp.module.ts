import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { WhatsAppMessageLog } from '../../entities/whatsapp-message-log.entity';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppReminderScheduler } from './whatsapp.scheduler';
import { AdminPushModule } from '../push/admin-push.module';

@Module({
    imports: [TypeOrmModule.forFeature([Appointment, WhatsAppMessageLog]), AdminPushModule],
    providers: [WhatsAppService, WhatsAppReminderScheduler],
    exports: [WhatsAppService],
})
export class WhatsAppModule {}
