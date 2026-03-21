import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as https from 'https';
import {
    createECDH,
    createHmac,
    createPrivateKey,
    createSign,
    randomBytes,
    createCipheriv,
} from 'crypto';
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
        const endpointUrl = this.parseAndValidatePushEndpoint(endpoint);
        const p256dh = String(subscription.keys.p256dh).trim();
        const auth = String(subscription.keys.auth).trim();

        let existing = await this.subscriptionsRepo.findOne({ where: { endpoint: endpointUrl.toString() } });
        if (!existing) {
            existing = this.subscriptionsRepo.create({ adminPhone, endpoint: endpointUrl.toString(), p256dh, auth });
        } else {
            existing.adminPhone = adminPhone;
            existing.p256dh = p256dh;
            existing.auth = auth;
        }

        await this.subscriptionsRepo.save(existing);
        return existing;
    }


    private parseAndValidatePushEndpoint(endpoint: string): URL {
        let endpointUrl: URL;
        try {
            endpointUrl = new URL(endpoint);
        } catch {
            throw new BadRequestException('INVALID_PUSH_ENDPOINT');
        }

        const protocol = endpointUrl.protocol.toLowerCase();
        if (protocol != 'https:') {
            throw new BadRequestException('PUSH_ENDPOINT_PROTOCOL_NOT_ALLOWED');
        }

        const hostname = endpointUrl.hostname.toLowerCase();
        const allowedHosts = new Set([
            'fcm.googleapis.com',
            'updates.push.services.mozilla.com',
            'push.services.mozilla.com',
            'web.push.apple.com',
        ]);
        const allowedSuffixes = ['.push.apple.com'];
        const isAllowedHost = allowedHosts.has(hostname) || allowedSuffixes.some((suffix) => hostname.endsWith(suffix));
        if (!isAllowedHost) {
            throw new BadRequestException('PUSH_ENDPOINT_HOST_NOT_ALLOWED');
        }

        if (endpointUrl.username || endpointUrl.password) {
            throw new BadRequestException('PUSH_ENDPOINT_CREDENTIALS_FORBIDDEN');
        }

        return endpointUrl;
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
                const result = await this.sendVapidPushWithPayload(row.endpoint, row.p256dh, row.auth, payload);
                if (result === 410) {
                    await this.subscriptionsRepo.delete({ id: row.id });
                }
            } catch (error: any) {
                this.logger.warn(`Push send failed for subscription ${row.id}: ${String(error?.message || error)}`);
            }
        }));

        this.logger.log(`Push dispatched to ${all.length} admin subscriptions (${payload.body})`);
    }

    private async sendVapidPushWithPayload(endpoint: string, p256dh: string, auth: string, payload: PushPayload): Promise<number> {
        const endpointUrl = new URL(endpoint);
        const aud = endpointUrl.origin;
        const jwt = this.buildVapidJwt(aud);

        const encrypted = this.encryptPayload(
            Buffer.from(JSON.stringify({
                title: payload.title,
                body: payload.body,
                url: payload.url || '/admin/notifications',
                tag: 'admin-updates',
            }), 'utf8'),
            p256dh,
            auth,
        );

        const headers = {
            TTL: '60',
            Urgency: 'high',
            Authorization: `vapid t=${jwt}, k=${this.vapidPublicKey}`,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(encrypted.length),
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
            req.write(encrypted);
            req.end();
        });
    }

    private encryptPayload(payload: Buffer, userPublicKeyB64Url: string, authB64Url: string): Buffer {
        const userPublicKey = this.base64UrlDecode(userPublicKeyB64Url);
        const authSecret = this.base64UrlDecode(authB64Url);
        if (userPublicKey.length !== 65 || userPublicKey[0] !== 0x04 || authSecret.length < 16) {
            throw new Error('INVALID_SUBSCRIPTION_KEYS');
        }

        const serverECDH = createECDH('prime256v1');
        serverECDH.generateKeys();
        const serverPublicKey = serverECDH.getPublicKey();
        const sharedSecret = serverECDH.computeSecret(userPublicKey);

        const prk = this.hmac(authSecret, sharedSecret);
        const keyInfo = Buffer.concat([
            Buffer.from('WebPush: info\x00', 'utf8'),
            userPublicKey,
            serverPublicKey,
        ]);
        const ikm = this.hmac(prk, Buffer.concat([keyInfo, Buffer.from([0x01])]));

        const salt = randomBytes(16);
        const contentPrk = this.hmac(salt, ikm);

        const cekInfo = Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\x00', 'utf8'), Buffer.from([0x01])]);
        const nonceInfo = Buffer.concat([Buffer.from('Content-Encoding: nonce\x00', 'utf8'), Buffer.from([0x01])]);
        const cek = this.hmac(contentPrk, cekInfo).subarray(0, 16);
        const nonce = this.hmac(contentPrk, nonceInfo).subarray(0, 12);

        const plaintext = Buffer.concat([payload, Buffer.from([0x02])]);
        const cipher = createCipheriv('aes-128-gcm', cek, nonce);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        const record = Buffer.concat([ciphertext, tag]);

        const rs = Buffer.alloc(4);
        rs.writeUInt32BE(4096, 0);
        const keyIdLen = Buffer.from([serverPublicKey.length]);

        return Buffer.concat([
            salt,
            rs,
            keyIdLen,
            serverPublicKey,
            record,
        ]);
    }

    private hmac(key: Buffer, value: Buffer): Buffer {
        return createHmac('sha256', key).update(value).digest();
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
