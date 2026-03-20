import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../modules/auth/public.decorator';
import { ClientsService } from './clients.service';

@Controller('clients')
export class PublicClientsController {
    constructor(private readonly service: ClientsService) {}

    @Public()
    @Get('lookup')
    async lookup(@Query('phone') phone?: string) {
        const client = await this.service.lookupByPhone(phone || '');
        if (!client) return null;

        return {
            id: (client as any).id,
            phone: (client as any).phone ?? '',
            firstName: (client as any).firstName ?? (client as any).first_name ?? '',
            lastName: (client as any).lastName ?? (client as any).last_name ?? '',
            isMember: Boolean((client as any).isMember ?? (client as any).is_member ?? false),
            isBlocked: Boolean((client as any).isBlocked ?? (client as any).is_blocked ?? false),
        };
    }
}
