import {
    BadRequestException,
    Body,
    Controller,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Client } from '../../clients/client.entity';
import { Appointment } from '../../entities/appointment.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { sleep } from '../whatsapp/whatsapp.utils';

@Controller('admin/whatsapp')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminWhatsAppController {
    constructor(
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
        private readonly whatsappService: WhatsAppService,
    ) {}

    @Post('broadcast')
    async broadcast(@Body() body: any) {
        const messageText = String(body?.messageText ?? '').trim();
        if (!messageText) throw new BadRequestException('messageText is required');

        const clients = await this.clientRepo.find();
        const normalizeKey = (value: string) => String(value || '').replace(/\D/g, '');
        const uniquePhones = new Map<string, string>();

        clients.forEach(client => {
            const phone = String((client as any)?.phone ?? '').trim();
            const key = normalizeKey(phone);
            if (!key) return;
            if (!uniquePhones.has(key)) uniquePhones.set(key, phone);
        });

        let sent = 0;
        let failed = 0;

        for (const phone of uniquePhones.values()) {
            const result = await this.whatsappService.sendAdminGeneralMessage(phone, messageText);
            if (result.ok) sent += 1;
            else failed += 1;
            await sleep(200);
        }

        return { ok: true, sent, failed, total: uniquePhones.size };
    }

    @Post('appointment/:appointmentId/message')
    async sendAppointmentMessage(@Param('appointmentId') appointmentId: string, @Body() body: any) {
        const messageText = String(body?.messageText ?? '').trim();
        if (!messageText) throw new BadRequestException('messageText is required');
        if (!appointmentId) throw new BadRequestException('appointmentId is required');

        const appointment = await this.apptRepo.findOne({
            where: { id: appointmentId },
            relations: ['client', 'service'],
        });
        if (!appointment) throw new BadRequestException('Appointment not found');

        const result = await this.whatsappService.sendAdminAppointmentMessage(appointment, messageText);
        return { ok: result.ok, status: result.status, error: result.error ?? null };
    }
}
