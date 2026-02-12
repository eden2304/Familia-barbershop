import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { WhatsAppMessageLog } from '../../entities/whatsapp-message-log.entity';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppReminderScheduler } from './whatsapp.scheduler';
import { WhatsAppAuthService } from './whatsappAuthService';

@Module({
    imports: [TypeOrmModule.forFeature([Appointment, WhatsAppMessageLog])],
    providers: [WhatsAppService, WhatsAppAuthService, WhatsAppReminderScheduler],
    exports: [WhatsAppService, WhatsAppAuthService],
})
export class WhatsAppModule {}
