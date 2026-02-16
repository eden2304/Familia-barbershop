import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RateLimitPolicy } from '../../common/rate-limit/rate-limit.decorator';
import { PushService } from './push.service';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push-subscription.dto';

@Controller()
export class PushController {
    constructor(private readonly pushService: PushService) {}

    @Get('push/vapid-public-key')
    getVapidPublicKey() {
        return this.pushService.getPublicVapidKey();
    }

    @Post('admin/push/subscribe')
    @Roles('admin')
    @RateLimitPolicy('push-subscribe')
    subscribe(
        @Req() req: Request & { user?: { phone?: string } },
        @Body() body: SubscribePushDto,
    ) {
        return this.pushService.subscribe(String(req.user?.phone || ''), body.subscription, String(req.headers['user-agent'] || ''));
    }

    @Post('admin/push/unsubscribe')
    @Roles('admin')
    @RateLimitPolicy('push-unsubscribe')
    unsubscribe(
        @Req() req: Request & { user?: { phone?: string } },
        @Body() body: UnsubscribePushDto,
    ) {
        const endpoint = body.endpoint || body.subscription?.endpoint;
        return this.pushService.unsubscribe(String(req.user?.phone || ''), endpoint);
    }
}
