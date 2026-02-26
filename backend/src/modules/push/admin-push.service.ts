import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminPushSubscription } from '../../entities/admin-push-subscription.entity';
import { normalizePhone } from '../../common/security.utils';

interface PushPayload {
    title: string;
    body: string;
    url?: string;
}

@Injectable()
export class AdminPushService {
    private readonly logger = new Logger(AdminPushService.name);
    private readonly vapidPublicKey: string;
    private readonly vapidPrivateKey: string;
    private readonly vapidSubject: string;
    private readonly webPush: any | null;

    constructor(
        @InjectRepository(AdminPushSubscription)
        private readonly subscriptionsRepo: Repository<AdminPushSubscription>,
        private readonly configService: ConfigService,
    ) {
        this.webPush = this.loadWebPush();
        this.vapidPublicKey = String(this.configService.get<string>('VAPID_PUBLIC_KEY') || '').trim();
        this.vapidPrivateKey = String(this.configService.get<string>('VAPID_PRIVATE_KEY') || '').trim();
        this.vapidSubject = String(this.configService.get<string>('VAPID_SUBJECT') || 'mailto:admin@familia.local').trim();

        if (this.webPush && this.vapidPublicKey && this.vapidPrivateKey) {
            this.webPush.setVapidDetails(this.vapidSubject, this.vapidPublicKey, this.vapidPrivateKey);
        }
    }

    private loadWebPush(): any | null {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            return require('web-push');
        } catch {
            this.logger.warn('web-push package is not installed; push notifications are disabled until dependency is available');
            return null;
        }
    }

    getPublicKey(): string {
        return this.vapidPublicKey;
    }

    async saveSubscription(adminPhoneRaw: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
        const adminPhone = normalizePhone(adminPhoneRaw);
        if (!adminPhone || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
            throw new BadRequestException('INVALID_SUBSCRIPTION');
        }

        const endpoint = String(subscription.endpoint).trim();
        const p256dh = String(subscription.keys.p256dh).trim();
        const auth = String(subscription.keys.auth).trim();

        let existing = await this.subscriptionsRepo.findOne({ where: { endpoint } });
        if (!existing) {
            existing = this.subscriptionsRepo.create({ adminPhone, endpoint, p256dh, auth });
        } else {
            existing.adminPhone = adminPhone;
            existing.p256dh = p256dh;
            existing.auth = auth;
        }

        await this.subscriptionsRepo.save(existing);
        return existing;
    }

    async sendAdminUpdateNotification(payload: PushPayload) {
        if (!this.webPush) {
            this.logger.warn('Skipping push send: web-push package unavailable');
            return;
        }

        if (!this.vapidPublicKey || !this.vapidPrivateKey) {
            this.logger.warn('Skipping push send: VAPID keys are not configured');
            return;
        }

        const all = await this.subscriptionsRepo.find();
        if (!all.length) return;

        const body = JSON.stringify({
            title: payload.title,
            body: payload.body,
            url: payload.url || '/admin/notifications',
            tag: 'admin-updates',
        });

        await Promise.all(all.map(async (row) => {
            try {
                await this.webPush.sendNotification(
                    {
                        endpoint: row.endpoint,
                        keys: {
                            p256dh: row.p256dh,
                            auth: row.auth,
                        },
                    },
                    body,
                );
            } catch (error: any) {
                if (Number(error?.statusCode) === 410) {
                    await this.subscriptionsRepo.delete({ id: row.id });
                    return;
                }
                this.logger.warn(`Push send failed for subscription ${row.id}: ${String(error?.message || error)}`);
            }
        }));
    }
}
