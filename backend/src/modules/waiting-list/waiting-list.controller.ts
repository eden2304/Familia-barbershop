import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { WaitingListService } from './waiting-list.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { DateTime } from 'luxon';

const TZ = 'Asia/Jerusalem';

@Controller('waiting-list')
export class WaitingListController {
    constructor(private readonly waitingService: WaitingListService) {}

    @Public()
    @Post()
    async create(@Body() body: any) {
        const serviceId = body.serviceId ?? body.service_id ?? body.service?.id;
        const desiredStartsAt = body.desired_starts_at ?? body.desiredStartsAt ?? body.starts_at ?? body.startsAt;
        const desiredDate = body.desired_date ?? body.desiredDate ?? body.date;
        const desiredTime = body.desired_time ?? body.desiredTime ?? body.time;

        if (!serviceId) throw new BadRequestException('serviceId is required');

        let date = desiredDate;
        let time = desiredTime;
        if (!date && desiredStartsAt) {
            const parsed = DateTime.fromISO(String(desiredStartsAt), { zone: TZ });
            if (parsed.isValid) {
                date = parsed.toFormat('yyyy-LL-dd');
                time = parsed.toFormat('HH:mm');
            }
        }

        const entry = await this.waitingService.create({
            clientId: body.client_id ?? body.clientId ?? body.client?.id,
            clientName: body.client_name ?? body.clientName,
            phone: body.phone ?? body.client_phone ?? body.clientPhone,
            serviceId,
            desiredDate: date,
            desiredTime: time,
            isClubMember: body.is_club_member ?? body.isClubMember ?? body.member,
        });

        return this.present(entry);
    }

    @UseGuards(JwtAuthGuard)
    @Roles('admin')
    @Get()
    async list(@Query('date') date?: string) {
        const list = await this.waitingService.listByDate(date);
        return list.map(entry => this.present(entry));
    }

    @UseGuards(JwtAuthGuard)
    @Roles('admin')
    @Delete(':id')
    async remove(@Param('id') id: string) {
        return this.waitingService.remove(id);
    }

    @UseGuards(JwtAuthGuard)
    @Roles('admin')
    @Post(':id/assign')
    async assign(@Param('id') id: string) {
        const appointment = await this.waitingService.assign(id);
        return {
            ok: true,
            appointment: {
                id: appointment.id,
                startsAt: appointment.startsAt,
                endsAt: appointment.endsAt,
                serviceId: appointment.service?.id,
                clientId: appointment.client?.id,
            },
        };
    }

    private present(entry: any) {
        const desiredDate = entry.desiredDate ?? entry.desired_date;
        const desiredTime = entry.desiredTime ?? entry.desired_time;
        const desiredStartsAt = desiredDate && desiredTime ? `${desiredDate}T${desiredTime}:00` : null;
        return {
            id: entry.id,
            client_id: entry.client?.id ?? entry.clientId ?? entry.client_id ?? null,
            client_name: entry.clientName ?? entry.client_name ?? '',
            phone: entry.phone ?? '',
            service_id: entry.service?.id ?? entry.serviceId ?? entry.service_id ?? null,
            desired_date: desiredDate,
            desired_time: desiredTime,
            desired_starts_at: desiredStartsAt,
            is_club_member: Boolean(entry.isClubMember ?? entry.is_club_member ?? false),
            created_at: entry.createdAt ?? entry.created_at ?? null,
        };
    }
}
