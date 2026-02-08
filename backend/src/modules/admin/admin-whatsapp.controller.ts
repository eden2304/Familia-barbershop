import {
    BadRequestException,
    Body,
    Controller,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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

        const phonesInput = Array.isArray(body?.phones) ? body.phones : [];
        const clientIds = Array.isArray(body?.clientIds) ? body.clientIds : [];

        if (phonesInput.length === 0 && clientIds.length === 0) {
            throw new BadRequestException('phones or clientIds are required');
        }

        const recipients: Array<{ phone: string; name: string }> = [];

        if (phonesInput.length > 0) {
            phonesInput.forEach((phone: any) => {
                const text = String(phone || '').trim();
                if (text) {
                    recipients.push({ phone: text, name: '' });
                }
            });
        }

        if (clientIds.length > 0) {
            const ids = clientIds.map((id: any) => Number(id)).filter(Number.isFinite);
            if (ids.length > 0) {
                const clients = await this.clientRepo.find({ where: { id: In(ids) } });
                clients.forEach(client => {
                    const clientAny = client as any;
                    const first = clientAny.firstName ?? clientAny.first_name ?? '';
                    const last = clientAny.lastName ?? clientAny.last_name ?? '';
                    const name = [first, last].filter(Boolean).join(' ').trim();
                    const phone = clientAny.phone ?? '';
                    if (phone) {
                        recipients.push({ phone, name });
                    }
                });
            }
        }

        const unique = new Map<string, { phone: string; name: string }>();
        recipients.forEach(entry => {
            if (!unique.has(entry.phone)) unique.set(entry.phone, entry);
        });

        let sent = 0;
        let failed = 0;

        for (const entry of unique.values()) {
            const result = await this.whatsappService.sendAdminGeneralMessage(
                entry.phone,
                entry.name || '',
                messageText,
            );
            if (result.ok) sent += 1;
            else failed += 1;
            await sleep(200);
        }

        return { ok: true, sent, failed, total: unique.size };
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
        return { ok: true, status: result.status };
    }
}
