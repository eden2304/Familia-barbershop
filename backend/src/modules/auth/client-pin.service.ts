import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';
import { Client } from '../../clients/client.entity';
import { HashedSecret, hashSecret, maskPhone, normalizePhone, verifySecret } from '../../common/security.utils';
import { AuthService } from './auth.service';
import { AuthTokens } from './auth.types';

/**
 * Personal login PIN (4–6 digits) chosen by the client after phone verification.
 *
 * Storage: the `settings` table (like OTP codes), so no schema migration is needed.
 *   client_pin:<clientId>   -> { hash: HashedSecret, length, updatedAt }
 *   client_pin_meta:<phone> -> { failedAttempts, lockedUntil? }
 *
 * Brute-force protection: after PIN_LOCK_THRESHOLD wrong tries the phone is locked
 * for PIN_LOCK_MS; after PIN_RESET_THRESHOLD wrong tries in total (without a
 * success) the PIN is wiped and the client must reset it via WhatsApp OTP. So an
 * attacker gets at most 10 guesses per WhatsApp-verified reset.
 *
 * Admins never use a PIN — they keep logging in with the WhatsApp code only.
 */
const PIN_LOCK_THRESHOLD = 5;
const PIN_RESET_THRESHOLD = 10;
const PIN_LOCK_MS = 15 * 60 * 1000;

interface StoredPin {
    hash: HashedSecret;
    length: number;
    updatedAt: string;
}

interface PinMeta {
    failedAttempts: number;
    lockedUntil?: number;
}

export type LoginMethod = { method: 'pin'; pinLength: number } | { method: 'otp' };

export function isWeakPin(pin: string): boolean {
    if (!/^\d{4,6}$/.test(pin)) return true;
    if (/^(\d)\1+$/.test(pin)) return true; // 0000, 111111
    const digits = pin.split('').map(Number);
    const steps = digits.slice(1).map((d, i) => d - digits[i]);
    if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true; // 1234, 654321
    if (['1212', '121212', '1122', '112233', '2580', '0852'].includes(pin)) return true;
    return false;
}

@Injectable()
export class ClientPinService {
    private readonly logger = new Logger(ClientPinService.name);

    constructor(
        @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
        private readonly authService: AuthService,
    ) {}

    private pinKey(clientId: number | string) {
        return `client_pin:${clientId}`;
    }

    private metaKey(phone: string) {
        return `client_pin_meta:${phone}`;
    }

    private async loadPin(clientId: number | string): Promise<StoredPin | null> {
        const row = await this.settingRepo.findOne({ where: { key: this.pinKey(clientId) } });
        const value = row?.value as StoredPin | undefined;
        return value?.hash?.hash && value?.hash?.salt ? value : null;
    }

    private async loadMeta(phone: string): Promise<PinMeta> {
        const row = await this.settingRepo.findOne({ where: { key: this.metaKey(phone) } });
        const value = (row?.value ?? {}) as PinMeta;
        return {
            failedAttempts: Number(value.failedAttempts) || 0,
            lockedUntil: value.lockedUntil ? Number(value.lockedUntil) : undefined,
        };
    }

    private async saveMeta(phone: string, meta: PinMeta) {
        await this.settingRepo.save(this.settingRepo.create({ key: this.metaKey(phone), value: meta }));
    }

    private async clearMeta(phone: string) {
        await this.settingRepo.delete({ key: this.metaKey(phone) });
    }

    async hasPin(clientId: number | string): Promise<boolean> {
        return Boolean(await this.loadPin(clientId));
    }

    /** True when this client must choose a PIN before finishing login (never for admins). */
    async isPinRequired(client: { id: number | string; phone: string }): Promise<boolean> {
        if (await this.authService.isAdminPhoneNumber(client.phone)) return false;
        return !(await this.hasPin(client.id));
    }

    /** Which login screen to show for this phone. Unknown/blocked/admin phones use the OTP flow. */
    async getLoginMethod(rawPhone: string): Promise<LoginMethod> {
        const client = await this.authService.findClientByPhone(rawPhone);
        if (!client || client.is_blocked) return { method: 'otp' };
        if (await this.authService.isAdminPhoneNumber(client.phone)) return { method: 'otp' };
        const stored = await this.loadPin(client.id);
        if (!stored) return { method: 'otp' };
        return { method: 'pin', pinLength: stored.length };
    }

    async setPin(clientId: number, pin: string) {
        const client = await this.authService.findClientById(clientId);
        if (!client) throw new UnauthorizedException('CLIENT_NOT_FOUND');
        if (client.is_blocked) throw new ForbiddenException('CLIENT_BLOCKED');
        if (await this.authService.isAdminPhoneNumber(client.phone)) {
            throw new BadRequestException('PIN_NOT_FOR_ADMIN');
        }
        if (!/^\d{4,6}$/.test(pin)) throw new BadRequestException('PIN_INVALID_FORMAT');
        if (isWeakPin(pin)) throw new BadRequestException('PIN_TOO_WEAK');

        // scrypt N=2^14 (16MB). N=2^15 exceeds Node's default scrypt maxmem and throws.
        const value: StoredPin = { hash: hashSecret(pin, 14), length: pin.length, updatedAt: new Date().toISOString() };
        await this.settingRepo.save(this.settingRepo.create({ key: this.pinKey(client.id), value }));
        await this.clearMeta(normalizePhone(client.phone));
        this.logger.log(`PIN set for client ${client.id} (${maskPhone(client.phone)})`);
        return { ok: true };
    }

    async loginWithPin(rawPhone: string, pin: string, rememberMe?: boolean, userAgent?: string): Promise<AuthTokens> {
        const phone = normalizePhone(rawPhone);
        if (!phone) throw new BadRequestException('Phone required');

        const meta = await this.loadMeta(phone);
        const now = Date.now();
        if (meta.lockedUntil && meta.lockedUntil > now) {
            throw this.lockedError(meta.lockedUntil - now);
        }

        const client: Client | null = await this.authService.findClientByPhone(phone);
        // Same error for "no such client" and "no PIN" so the endpoint can't be used to probe.
        if (!client || (await this.authService.isAdminPhoneNumber(client.phone))) {
            throw new UnauthorizedException('PIN_NOT_SET');
        }
        if (client.is_blocked) throw new ForbiddenException('CLIENT_BLOCKED');

        const stored = await this.loadPin(client.id);
        if (!stored) throw new UnauthorizedException('PIN_NOT_SET');

        if (!verifySecret(pin, stored.hash)) {
            const failedAttempts = meta.failedAttempts + 1;
            if (failedAttempts >= PIN_RESET_THRESHOLD) {
                await this.settingRepo.delete({ key: this.pinKey(client.id) });
                await this.clearMeta(phone);
                this.logger.warn(`PIN wiped after ${failedAttempts} failed attempts for ${maskPhone(phone)}`);
                throw new UnauthorizedException('PIN_RESET_REQUIRED');
            }
            const lockedUntil = failedAttempts % PIN_LOCK_THRESHOLD === 0 ? now + PIN_LOCK_MS : undefined;
            await this.saveMeta(phone, { failedAttempts, lockedUntil });
            if (lockedUntil) {
                this.logger.warn(`PIN locked for ${maskPhone(phone)} after ${failedAttempts} failed attempts`);
                throw this.lockedError(PIN_LOCK_MS);
            }
            throw new UnauthorizedException({
                statusCode: 401,
                message: 'INVALID_PIN',
                attemptsLeftBeforeLock: PIN_LOCK_THRESHOLD - (failedAttempts % PIN_LOCK_THRESHOLD),
            });
        }

        await this.clearMeta(phone);
        return this.authService.issueSessionForClient(client, rememberMe, userAgent);
    }

    private lockedError(remainingMs: number) {
        const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
        return new HttpException(
            { error: 'RATE_LIMITED', message: 'PIN_ATTEMPTS_EXCEEDED', retryAfterSeconds },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
}
