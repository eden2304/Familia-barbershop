import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';

@Controller('clients')
export class ClientsController {
    constructor(private readonly svc: AppointmentsService) {}

    @Get('me/appointments')
    async myAppointments(@Query('phone') phone: string) {
        if (!phone) throw new BadRequestException('phone is required');
        return this.svc.getMyAppointmentsByPhone(phone);
    }
}
