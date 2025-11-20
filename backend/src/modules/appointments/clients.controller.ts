import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Request } from 'express';
import { AuthTokenPayload } from '../auth/auth.types';

@Controller('clients')
export class ClientsController {
    constructor(private readonly svc: AppointmentsService) {}

    @Get('me/appointments')
    @UseGuards(JwtAuthGuard)
    @Roles('client')
    async myAppointments(@Req() req: Request & { user?: AuthTokenPayload }) {
        const phone = req.user?.phone;
        if (!phone) {
            return [];
        }
        return this.svc.getMyAppointmentsByPhone(phone);
    }
}
