import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../../clients/client.entity';
import { HashedSecret, hashSecret, maskPhone, verifySecret } from '../../common/security.utils';
import { AuthService } from './auth.service';
import { AuthTokens } from './auth.types';

/**
 * Personal login PIN (4–6 digits) chosen by the client after phone verification.
 *
 * Stored on the client record (clients.pin_hash, pin_length, pin_failed_attempts,
 * pin_locked_until, pin_updated_at). Those entity columns are select/insert/update
 * disabled, so this service reads and writes them with explicit SQL, and it ensures
 * the columns exist on startup (same as migration 1748000000000-AddClientPin).
 *
 * Brute-force protection: after PIN_LOCK_THRESHOLD wrong tries the client is locked
 * for PIN_LOCK_MS; after PIN_RESET_THRESHOLD wrong tries in total (without a
 * success) the PIN is wiped and the client must reset it via WhatsApp OTP. So an
 * attacker gets at most 10 guesses per WhatsApp-verified reset.
 *
 * Admins never use a PIN — they keep logging in with the WhatsApp code only.
 */
const PIN_LOCK_THRESHOLD = 5;
const PIN_RESET_THRESHOLD = 10;
const PIN_LOCK_MS = 15 * 60 * 1000;

interface PinRow {
    pin_hash: string | null;
    pin_length: number | null;
    pin_failed_attempts: number | null;
    pin_locked_until: Date | string | null;
}

export type LoginMethod = { method: 'pin'; pinLength: number } | { method: 'otp' };

@Injectable()
export class ClientPinService implements OnModuleInit {
    private readonly logger = new Logger(ClientPinService.name);

    constructor(
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        private readonly authService: AuthService,
    ) {}

    async onModuleInit() {
        try {
            await this.clientRepo.query(`
                ALTER TABLE "clients"
                    ADD COLUMN IF NOT EXISTS "pin_hash" text NULL,
                    ADD COLUMN IF NOT EXISTS "pin_length" smallint NULL,
                    ADD COLUMN IF NOT EXISTS "pin_failed_attempts" integer NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS "pin_locked_until" TIMESTAMPTZ NULL,
                    ADD COLUMN IF NOT EXISTS "pin_updated_at" TIMESTAMPTZ NULL;
            `);
        } catch (error: any) {
            this.logger.error(`Failed ensuring client PIN columns: ${error?.message || error}`);
        }
    }

    private async loadPinRow(clientId: number | string): Promise<PinRow | null> {
        const rows: PinRow[] = await this.clientRepo.query(
            `SELECT pin_hash, pin_length, pin_failed_attempts, pin_locked_until FROM clients WHERE id = $1`,
            [clientId],
        );
        return rows[0] ?? null;
    }

    private parseHash(row: PinRow | null): HashedSecret | null {
        if (!row?.pin_hash) return null;
        try {
            const parsed = JSON.parse(row.pin_hash) as HashedSecret;
            return parsed?.hash && parsed?.salt ? parsed : null;
        } catch {
            return null;
        }
    }

    private async writeAttempts(clientId: number | string, failedAttempts: number, lockedUntil: Date | null) {
        await this.clientRepo.query(
            `UPDATE clients SET pin_failed_attempts = $2, pin_locked_until = $3 WHERE id = $1`,
            [clientId, failedAttempts, lockedUntil],
        );
    }

    /**
     * Called after a successful WhatsApp-code login: the client proved phone ownership,
     * so any PIN lock / failed-attempt count is lifted (the PIN itself is kept).
     */
    async clearLockout(clientId: number | string) {
        try {
            await this.clientRepo.query(
                `UPDATE clients SET pin_failed_attempts = 0, pin_locked_until = NULL
                  WHERE id = $1 AND (pin_failed_attempts <> 0 OR pin_locked_until IS NOT NULL)`,
                [clientId],
            );
        } catch (error: any) {
            this.logger.warn(`Failed clearing PIN lockout for client ${clientId}: ${error?.message || error}`);
        }
    }

    async hasPin(clientId: number | string): Promise<boolean> {
        return Boolean(this.parseHash(await this.loadPinRow(clientId)));
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
        const row = await this.loadPinRow(client.id);
        const length = Number(row?.pin_length);
        if (!this.parseHash(row) || !(length >= 4 && length <= 6)) return { method: 'otp' };
        return { method: 'pin', pinLength: length };
    }

    async setPin(clientId: number | string, pin: string) {
        const client = await this.authService.findClientById(clientId);
        if (!client) throw new UnauthorizedException('CLIENT_NOT_FOUND');
        if (client.is_blocked) throw new ForbiddenException('CLIENT_BLOCKED');
        if (await this.authService.isAdminPhoneNumber(client.phone)) {
            throw new BadRequestException('PIN_NOT_FOR_ADMIN');
        }
        // Any 4–6 digit code is accepted (business decision: no "too simple" check).
        // The PIN never expires; it changes only when the client resets it.
        if (!/^\d{4,6}$/.test(pin)) throw new BadRequestException('PIN_INVALID_FORMAT');

        // scrypt N=2^14 (16MB). N=2^15 exceeds Node's default scrypt maxmem and throws.
        const hash = JSON.stringify(hashSecret(pin, 14));
        await this.clientRepo.query(
            `UPDATE clients
                SET pin_hash = $2, pin_length = $3, pin_failed_attempts = 0,
                    pin_locked_until = NULL, pin_updated_at = now()
              WHERE id = $1`,
            [client.id, hash, pin.length],
        );
        this.logger.log(`PIN set for client ${client.id} (${maskPhone(client.phone)})`);
        return { ok: true };
    }

    async loginWithPin(rawPhone: string, pin: string, rememberMe?: boolean, userAgent?: string): Promise<AuthTokens> {
        const client: Client | null = await this.authService.findClientByPhone(rawPhone);
        // Same error for "no such client", admins and "no PIN" so the endpoint can't be used to probe.
        if (!client || (await this.authService.isAdminPhoneNumber(client.phone))) {
            throw new UnauthorizedException('PIN_NOT_SET');
        }

        const row = await this.loadPinRow(client.id);
        const now = Date.now();
        const lockedUntil = row?.pin_locked_until ? new Date(row.pin_locked_until).getTime() : 0;
        if (lockedUntil > now) throw this.lockedError(lockedUntil - now);

        if (client.is_blocked) throw new ForbiddenException('CLIENT_BLOCKED');

        const stored = this.parseHash(row);
        if (!stored) throw new UnauthorizedException('PIN_NOT_SET');

        if (!verifySecret(pin, stored)) {
            const failedAttempts = (Number(row?.pin_failed_attempts) || 0) + 1;
            if (failedAttempts >= PIN_RESET_THRESHOLD) {
                await this.clientRepo.query(
                    `UPDATE clients SET pin_hash = NULL, pin_length = NULL, pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`,
                    [client.id],
                );
                this.logger.warn(`PIN wiped after ${failedAttempts} failed attempts for ${maskPhone(client.phone)}`);
                throw new UnauthorizedException('PIN_RESET_REQUIRED');
            }
            const lock = failedAttempts % PIN_LOCK_THRESHOLD === 0 ? new Date(now + PIN_LOCK_MS) : null;
            await this.writeAttempts(client.id, failedAttempts, lock);
            if (lock) {
                this.logger.warn(`PIN locked for ${maskPhone(client.phone)} after ${failedAttempts} failed attempts`);
                throw this.lockedError(PIN_LOCK_MS);
            }
            throw new UnauthorizedException({
                statusCode: 401,
                message: 'INVALID_PIN',
                attemptsLeftBeforeLock: PIN_LOCK_THRESHOLD - (failedAttempts % PIN_LOCK_THRESHOLD),
            });
        }

        if (Number(row?.pin_failed_attempts) || row?.pin_locked_until) {
            await this.writeAttempts(client.id, 0, null);
        }
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
