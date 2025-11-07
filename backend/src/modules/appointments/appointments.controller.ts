import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
export class AppointmentsController {
    constructor(private readonly svc: AppointmentsService) {}

    private normDate(date: string): string {
        if (!date) throw new BadRequestException('date is required');
        // already yyyy-MM-dd
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
        // dd/MM/yyyy  -> yyyy-MM-dd
        const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        // Date parse fallback
        const d = new Date(date);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        throw new BadRequestException('Invalid date');
    }

    @Get('available')
    async getAvailable(@Query('serviceId') serviceId: string, @Query('date') date: string) {
        if (!serviceId) throw new BadRequestException('serviceId is required');
        const norm = this.normDate(date);
        return this.svc.getAvailableSlots(serviceId, norm);
    }

    @Post()
    async create(@Body() body: any) {
        // (ללא שינוי מהגרסה האחרונה ששלחתי)
        const hasNestedClient = !!body?.client;

        let clientPhone = body.clientPhone ?? body.client_phone ?? body.phone ?? (hasNestedClient ? body.client.phone : undefined);
        let clientFirstName =
            body.clientFirstName ?? body.client_first_name ?? (hasNestedClient ? (body.client.firstName ?? body.client.first_name) : undefined);
        let clientLastName =
            body.clientLastName ?? body.client_last_name ?? (hasNestedClient ? (body.client.lastName ?? body.client.last_name) : undefined);

        const serviceId = body.serviceId ?? body.service_id ?? body?.service?.id;

        let date = body.date;
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            // תמיכה ב־dd/MM/yyyy גם ביצירה
            const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            date = m ? `${m[3]}-${m[2]}-${m[1]}` : new Date(date).toISOString().slice(0, 10);
        }

        let startsAtISO =
            body.startsAt ??
            body.starts_at ??
            (date && body.time ? `${date}T${body.time}:00` : undefined);

        const note = body.note ?? body.client_note ?? null;

        if (!serviceId) throw new BadRequestException('serviceId is required');
        if (!startsAtISO) throw new BadRequestException('startsAt or (date+time) are required');
        if (!clientPhone) throw new BadRequestException('client phone is required');
        if (!clientFirstName || !clientLastName) throw new BadRequestException('NAME_REQUIRED');

        const dto = {
            clientPhone,
            clientFirstName,
            clientLastName,
            serviceId,
            startsAtISO,
            note: note ?? undefined,
        };

        const saved = await this.svc.create(dto);

        return {
            ok: true,
            success: true,
            appointment: {
                id: saved.id,
                serviceId: saved.service?.id,
                clientId: saved.client?.id,
                startsAt: saved.startsAt,
                endsAt: saved.endsAt,
            },
        };
    }
}
