import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { SubscribeAdminPushDto } from './dto/subscribe-admin-push.dto';
import { AdminPushService } from './admin-push.service';

@Controller('admin/push')
@Roles('admin')
export class AdminPushController {
    constructor(private readonly adminPushService: AdminPushService) {}

    @Get('public-key')
    getPublicKey() {
        return { publicKey: this.adminPushService.getPublicKey() };
    }

    @Post('subscribe')
    async subscribe(@Body() body: SubscribeAdminPushDto, @Req() req: Request & { user?: { phone?: string } }) {
        const phone = String(req.user?.phone || '').trim();
        const record = await this.adminPushService.saveSubscription(phone, body);
        return { ok: true, id: record.id };
    }
}
