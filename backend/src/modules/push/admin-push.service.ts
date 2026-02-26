import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as https from 'https';
import { createPrivateKey, createSign } from 'crypto';
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

    constructor(
        @InjectRepository(AdminPushSubscription)
        private readonly subscriptionsRepo: Repository<AdminPushSubscription>,
        private readonly configService: ConfigService,
    ) {
        this.vapidPublicKey = String(this.configService.get<string>('VAPID_PUBLIC_KEY') || '').trim();
        this.vapidPrivateKey = String(this.configService.get<string>('VAPID_PRIVATE_KEY') || '').trim();
        this.vapidSubject = String(this.configService.get<string>('VAPID_SUBJECT') || 'mailto:admin@familia.local').trim();
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
        if (!this.vapidPublicKey || !this.vapidPrivateKey) {
            this.logger.warn('Skipping push send: VAPID keys are not configured');
            return;
        }

        const all = await this.subscriptionsRepo.find();
        if (!all.length) return;

        await Promise.all(all.map(async (row) => {
            try {
                const result = await this.sendVapidPushWithoutPayload(row.endpoint);
                if (result === 410) {
                    await this.subscriptionsRepo.delete({ id: row.id });
                }
            } catch (error: any) {
                this.logger.warn(`Push send failed for subscription ${row.id}: ${String(error?.message || error)}`);
            }
        }));

        this.logger.log(`Push dispatched to ${all.length} admin subscriptions (${payload.title})`);
    }

    private async sendVapidPushWithoutPayload(endpoint: string): Promise<number> {
        const endpointUrl = new URL(endpoint);
        const aud = endpointUrl.origin;
        const jwt = this.buildVapidJwt(aud);

        const headers = {
            TTL: '60',
            Urgency: 'high',
            Authorization: `vapid t=${jwt}, k=${this.vapidPublicKey}`,
            'Content-Length': '0',
        };

        return await new Promise<number>((resolve, reject) => {
            const req = https.request(endpointUrl, { method: 'POST', headers }, (res) => {
                const statusCode = Number(res.statusCode || 500);
                res.resume();

                if (statusCode === 404 || statusCode === 410) {
                    resolve(410);
                    return;
                }

                if (statusCode >= 200 && statusCode < 300) {
                    resolve(statusCode);
                    return;
                }

                reject(new Error(`PUSH_HTTP_${statusCode}`));
            });

            req.on('error', reject);
            req.end();
        });
    }

    private buildVapidJwt(audience: string): string {
        const header = { typ: 'JWT', alg: 'ES256' };
        const now = Math.floor(Date.now() / 1000);
        const payload = {
            aud: audience,
            exp: now + (12 * 60 * 60),
            sub: this.vapidSubject,
        };

        const encodedHeader = this.base64UrlEncode(Buffer.from(JSON.stringify(header), 'utf8'));
        const encodedPayload = this.base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
        const toSign = `${encodedHeader}.${encodedPayload}`;

        const key = this.createPrivateKeyFromVapid();
        const signer = createSign('SHA256');
        signer.update(toSign);
        signer.end();

        const signatureDer = signer.sign(key);
        const signatureJose = this.derToJoseSignature(signatureDer);
        return `${toSign}.${this.base64UrlEncode(signatureJose)}`;
    }

    private createPrivateKeyFromVapid() {
        const publicBytes = this.base64UrlDecode(this.vapidPublicKey);
        const privateBytes = this.base64UrlDecode(this.vapidPrivateKey);
        if (publicBytes.length !== 65 || publicBytes[0] !== 0x04 || privateBytes.length !== 32) {
            throw new Error('INVALID_VAPID_KEY_FORMAT');
        }

        const x = publicBytes.subarray(1, 33);
        const y = publicBytes.subarray(33, 65);

        return createPrivateKey({
            key: {
                kty: 'EC',
                crv: 'P-256',
                x: this.base64UrlEncode(x),
                y: this.base64UrlEncode(y),
                d: this.base64UrlEncode(privateBytes),
            },
            format: 'jwk',
        });
    }

    private derToJoseSignature(der: Buffer): Buffer {
        if (der.length < 8 || der[0] !== 0x30) {
            throw new Error('INVALID_DER_SIGNATURE');
        }

        let offset = 1;
        const sequenceLength = der[offset++];
        if (sequenceLength + 2 !== der.length) {
            throw new Error('INVALID_DER_SEQUENCE');
        }

        if (der[offset++] !== 0x02) {
            throw new Error('INVALID_DER_R_MARKER');
        }
        const rLen = der[offset++];
        const r = der.subarray(offset, offset + rLen);
        offset += rLen;

        if (der[offset++] !== 0x02) {
            throw new Error('INVALID_DER_S_MARKER');
        }
        const sLen = der[offset++];
        const s = der.subarray(offset, offset + sLen);

        const out = Buffer.alloc(64);
        const rTrim = r[0] === 0 ? r.subarray(1) : r;
        const sTrim = s[0] === 0 ? s.subarray(1) : s;
        if (rTrim.length > 32 || sTrim.length > 32) {
            throw new Error('INVALID_DER_COORD_SIZE');
        }
        rTrim.copy(out, 32 - rTrim.length);
        sTrim.copy(out, 64 - sTrim.length);
        return out;
    }

    private base64UrlEncode(input: Buffer): string {
        return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    private base64UrlDecode(input: string): Buffer {
        const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
        const padLength = (4 - (normalized.length % 4)) % 4;
        return Buffer.from(normalized + '='.repeat(padLength), 'base64');
    }
}
