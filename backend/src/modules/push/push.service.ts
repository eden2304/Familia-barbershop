import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { PushSubscription } from '../../entities/push-subscription.entity';
import { AdminPhone } from '../../entities/admin-phone.entity';
import { normalizePhone, phoneVariants } from '../../common/security.utils';

interface PushPayload {
    title: string;
    body: string;
    url: string;
    icon?: string;
    badge?: string;
}

@Injectable()
export class PushService {
    private readonly logger = new Logger(PushService.name);
    private readonly vapidPublicKey: string;
    private readonly webPushClient: any;

    constructor(
        @InjectRepository(PushSubscription) private readonly pushRepo: Repository<PushSubscription>,
        @InjectRepository(AdminPhone) private readonly adminRepo: Repository<AdminPhone>,
        private readonly config: ConfigService,
    ) {
        this.vapidPublicKey = String(this.config.get<string>('VAPID_PUBLIC_KEY') || '');
        const vapidPrivateKey = String(this.config.get<string>('VAPID_PRIVATE_KEY') || '');
        const vapidSubject = String(this.config.get<string>('VAPID_SUBJECT') || '');

        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            this.webPushClient = require('web-push');
        } catch {
            this.webPushClient = null;
        }

        if (this.webPushClient && this.vapidPublicKey && vapidPrivateKey && vapidSubject) {
            this.webPushClient.setVapidDetails(vapidSubject, this.vapidPublicKey, vapidPrivateKey);
        } else {
            this.logger.warn('Web push disabled: missing web-push dependency or VAPID configuration');
        }
    }

    getPublicVapidKey() {
        return { publicKey: this.vapidPublicKey };
    }

    private normalizeDigitsOnly(phone: string): string {
        return String(phone || '').replace(/\D/g, '');
    }

    async assertAdminPhone(rawPhone: string): Promise<string> {
        const normalized = normalizePhone(rawPhone);
        if (!normalized) throw new ForbiddenException('ADMIN_REQUIRED');
        const digits = this.normalizeDigitsOnly(normalized);

        const envPhones = (this.config.get<string>('ADMIN_PHONES') || '')
            .split(',')
            .map((value) => this.normalizeDigitsOnly(value))
            .filter(Boolean);

        if (envPhones.includes(digits)) return digits;

        const variants = phoneVariants(normalized);
        const admins = await this.adminRepo.find({ where: variants.map((p) => ({ phone: p })) });
        const dbDigits = admins.map((item) => this.normalizeDigitsOnly(item.phone));
        if (dbDigits.includes(digits)) return digits;

        throw new ForbiddenException('ADMIN_REQUIRED');
    }

    async subscribe(phone: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
        const normalizedPhone = await this.assertAdminPhone(phone);

        const existing = await this.pushRepo.findOne({ where: { endpoint: subscription.endpoint } });
        if (existing) {
            existing.phone = normalizedPhone;
            existing.p256dh = subscription.keys.p256dh;
            existing.auth = subscription.keys.auth;
            existing.userAgent = userAgent || null;
            existing.lastSeenAt = new Date();
            await this.pushRepo.save(existing);
            return { ok: true };
        }

        await this.pushRepo.save(this.pushRepo.create({
            phone: normalizedPhone,
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            userAgent: userAgent || null,
        }));

        return { ok: true };
    }

    async unsubscribe(phone: string, endpoint?: string) {
        const normalizedPhone = await this.assertAdminPhone(phone);
        if (endpoint) {
            await this.pushRepo.delete({ endpoint, phone: normalizedPhone });
            return { ok: true };
        }
        await this.pushRepo.delete({ phone: normalizedPhone });
        return { ok: true };
    }

    async sendAdminUpdatePush(body: string) {
        if (!this.vapidPublicKey || !this.webPushClient) return;
        const subscriptions = await this.pushRepo.find();
        if (!subscriptions.length) return;

        const payload: PushPayload = {
            title: 'Familia – Update',
            body,
            url: '/Admin?tab=updates',
            icon: 'https://familia-barbershop-production.up.railway.app/uploads/Familia.png',
            badge: 'https://familia-barbershop-production.up.railway.app/uploads/Familia.png',
        };

        await Promise.all(subscriptions.map(async (subscription) => {
            try {
                await this.webPushClient.sendNotification({
                    endpoint: subscription.endpoint,
                    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
                }, JSON.stringify(payload));
            } catch (error: any) {
                const statusCode = Number(error?.statusCode || error?.status || 0);
                if (statusCode === 404 || statusCode === 410) {
                    await this.pushRepo.delete({ id: subscription.id });
                    return;
                }
                this.logger.warn(`Failed to send push notification: ${String(error?.message || error)}`);
            }
        }));
    }
}
