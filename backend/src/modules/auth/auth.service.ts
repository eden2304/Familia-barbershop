import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException, HttpException, HttpStatus, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial, MoreThan } from 'typeorm';
import { sign, verify, type Secret, type SignOptions, type JwtPayload } from 'jsonwebtoken';
import { randomBytes } from 'crypto';

import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';
import { AdminPhone } from '../../entities/admin-phone.entity';
import { Appointment } from '../../entities/appointment.entity';
import { ConfigService } from '@nestjs/config';
import { AuthRole, AuthTokenPayload, AuthTokens } from './auth.types';
import { RefreshToken } from '../../entities/refresh-token.entity';
import {
    hashSecret,
    maskPhone,
    normalizePhone,
    phoneVariants,
    sanitizeString,
    verifySecret,
    hashOtp,
    verifyOtp
} from '../../common/security.utils';
import { JwtService } from '@nestjs/jwt';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { AdminPushService } from '../push/admin-push.service';


interface OtpRecord {
    hashed: string;
    expiresAt: string;
    attempts: number;
}

interface OtpMeta {
    requests: number[];
    failedAttempts: number;
    lockedUntil?: number;
}

interface RateLimitPayload {
    error: 'RATE_LIMITED';
    message: string;
    retryAfterSeconds: number;
}

interface AdminUpdateEvent {
    type: 'login' | 'visit_no_booking' | 'booking';
    message: string;
    color: 'neutral' | 'red' | 'green';
    clientName: string;
    clientId?: string;
    createdAt: string;
    appointment?: {
        startsAt?: string;
        serviceName?: string;
    };
}


interface PendingNoBookingEvent {
    clientId: string;
    clientName: string;
    loginAt: string;
    dueAt: string;
}

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly jwtSecret: string = String(process.env.JWT_SECRET ?? '');
    private readonly accessTokenTtl: string;
    private readonly accessTokenMs: number;
    private readonly refreshTokenMs: number;
    private readonly otpTtlMs = 5 * 60 * 1000;
    private readonly otpRequestLimit = 3;
    private readonly otpRequestWindowMs = 10 * 60 * 1000;
    private readonly otpMaxAttempts = 10;
    private readonly otpLockMs = 10 * 60 * 1000;
    private readonly defaultRemember = false;
    private readonly otpSecret: string;
    private readonly noBookingDelayMs = 5 * 60 * 1000;
    private readonly adminUpdatesFeedKey = 'admin.updates.feed';
    private readonly pendingNoBookingKey = 'admin.updates.pending_no_booking';
    private readonly pendingSweepMs = 60 * 1000;

    constructor(
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
        @InjectRepository(AdminPhone) private readonly adminRepo: Repository<AdminPhone>,
        @InjectRepository(Appointment) private readonly appointmentRepo: Repository<Appointment>,
        @InjectRepository(RefreshToken) private readonly refreshRepo: Repository<RefreshToken>,
        private readonly configService: ConfigService,
        private readonly jwt: JwtService,
        private readonly whatsAppService: WhatsAppService,
        private readonly adminPushService: AdminPushService,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') || '';
        if (!this.jwtSecret || this.jwtSecret.length < 64) {
            throw new Error('JWT_SECRET must be at least 64 characters long');
        }
        const configuredAccess = this.configService.get<string>('ACCESS_TOKEN_TTL') || '15m';
        this.accessTokenTtl = configuredAccess;
        this.accessTokenMs = this.parseDurationToMs(configuredAccess, 15 * 60 * 1000);
        const configuredRefresh = this.configService.get<string>('REFRESH_TOKEN_TTL') || '30d';
        this.refreshTokenMs = this.parseDurationToMs(configuredRefresh, 30 * 24 * 60 * 60 * 1000);
        this.otpSecret =
            this.configService.get<string>('OTP_SECRET') || this.jwtSecret;

        this.reconcileDuePendingNoBooking().catch((error) => {
            this.logger.warn(`Initial no-booking reconcile failed: ${String(error?.message || error)}`);
        });
        setInterval(() => {
            this.reconcileDuePendingNoBooking().catch((error) => {
                this.logger.warn(`Scheduled no-booking reconcile failed: ${String(error?.message || error)}`);
            });
        }, this.pendingSweepMs);
    }

    private parseDurationToMs(input: string | undefined, fallback: number): number {
        if (!input) return fallback;
        const trimmed = input.trim();
        const match = trimmed.match(/^(\d+)([smhd])$/i);
        if (match) {
            const value = Number(match[1]);
            const unit = match[2].toLowerCase();
            const multipliers: Record<string, number> = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
            return value * (multipliers[unit] ?? 1000);
        }
        const asNumber = Number(trimmed);
        if (!Number.isNaN(asNumber) && asNumber > 0) {
            return asNumber * 1000;
        }
        return fallback;
    }

    async isRegistered(phone: string): Promise<boolean> {
        const variants = phoneVariants(phone);
        if (variants.length === 0) return false;
        const c = await this.clientRepo.findOne({ where: variants.map((p) => ({ phone: p })) });
        return !!c;
    }

    async isBlocked(phone: string): Promise<boolean> {
        const variants = phoneVariants(phone);
        if (variants.length === 0) return false;
        const c = await this.clientRepo.findOne({ where: variants.map((p) => ({ phone: p, is_blocked: true })) });
        return !!c;
    }

    private async getOtpMeta(phone: string): Promise<OtpMeta> {
        const key = `otp:meta:${phone}`;
        const meta = await this.settingRepo.findOne({ where: { key } });
        if (!meta) return { requests: [], failedAttempts: 0 };
        const value = meta.value as OtpMeta;
        return {
            requests: (value.requests || []).map((n) => Number(n)).filter((n) => Number.isFinite(n)),
            failedAttempts: Number(value.failedAttempts) || 0,
            lockedUntil: value.lockedUntil ? Number(value.lockedUntil) : undefined,
        };
    }

    private async saveOtpMeta(phone: string, meta: OtpMeta) {
        const key = `otp:meta:${phone}`;
        const existing = await this.settingRepo.findOne({ where: { key } });
        const value = { ...meta, requests: meta.requests, failedAttempts: meta.failedAttempts, lockedUntil: meta.lockedUntil };
        if (existing) {
            existing.value = value;
            await this.settingRepo.save(existing);
        } else {
            const s = this.settingRepo.create({ key, value });
            await this.settingRepo.save(s);
        }
    }

    private async clearOtpMeta(phone: string) {
        const key = `otp:meta:${phone}`;
        await this.settingRepo.delete({ key });
    }

    private async assertOtpRequestAllowance(phone: string) {
        const meta = await this.getOtpMeta(phone);
        const now = Date.now();
        if (meta.lockedUntil && meta.lockedUntil > now) {
            const retryAfterSeconds = Math.max(1, Math.ceil((meta.lockedUntil - now) / 1000));
            throw new HttpException(
                { error: 'RATE_LIMITED', message: 'OTP_ATTEMPTS_EXCEEDED', retryAfterSeconds } satisfies RateLimitPayload,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        const recent = meta.requests.filter((ts) => now - ts < this.otpRequestWindowMs);
        if (recent.length >= this.otpRequestLimit) {
            await this.saveOtpMeta(phone, { ...meta, requests: recent, lockedUntil: meta.lockedUntil, failedAttempts: meta.failedAttempts });
            const oldestInWindow = recent[0] || now;
            const retryAfterSeconds = Math.max(1, Math.ceil((oldestInWindow + this.otpRequestWindowMs - now) / 1000));
            throw new HttpException(
                { error: 'RATE_LIMITED', message: 'OTP_REQUEST_LIMITED', retryAfterSeconds } satisfies RateLimitPayload,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        recent.push(now);
        await this.saveOtpMeta(phone, { ...meta, requests: recent });
    }

    private async recordFailedOtpAttempt(phone: string): Promise<number | null> {
        const meta = await this.getOtpMeta(phone);
        const failedAttempts = (meta.failedAttempts || 0) + 1;
        const lockedUntil = failedAttempts >= this.otpMaxAttempts ? Date.now() + this.otpLockMs : undefined;

        if (lockedUntil) {
            this.logger.warn(`OTP attempts exceeded for ${maskPhone(phone)}. Locked for ${this.otpLockMs / 1000}s.`);
        }

        await this.saveOtpMeta(phone, { ...meta, failedAttempts, lockedUntil });
        if (!lockedUntil) return null;
        return Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
    }

    private async storeOtp(phone: string, code: string) {
        const key = `otp:${phone}`;
        const hashed = hashOtp(code, this.otpSecret);
        const expiresAt = new Date(Date.now() + this.otpTtlMs).toISOString();
        const value: OtpRecord = { hashed, expiresAt, attempts: 0 };
        const existing = await this.settingRepo.findOne({ where: { key } });
        if (existing) {
            existing.value = value;
            await this.settingRepo.save(existing);
        } else {
            const s = this.settingRepo.create({ key, value });
            await this.settingRepo.save(s);
        }
    }

    private async loadOtp(phone: string): Promise<OtpRecord | null> {
        const key = `otp:${phone}`;
        const existing = await this.settingRepo.findOne({ where: { key } });
        if (!existing) return null;
        return existing.value as OtpRecord;
    }

    private async deleteOtp(phone: string) {
        const key = `otp:${phone}`;
        await this.settingRepo.delete({ key });
    }

    async requestCode(rawPhone: string) {
        const norm = normalizePhone(rawPhone);
        if (!norm) throw new BadRequestException('Phone required');
        const code = this.generateOtpCode();

        await this.assertOtpRequestAllowance(norm);

        await this.storeOtp(norm, code);

        const whatsappResult = await this.whatsAppService.sendAuthCode(norm, code);
        if (!whatsappResult.ok && whatsappResult.status === 'failed') {
            this.logger.error(`OTP WhatsApp send failed for ${maskPhone(norm)}: ${whatsappResult.error || 'unknown_error'}`);
            throw new HttpException('OTP_SEND_FAILED', HttpStatus.BAD_GATEWAY);
        }

        this.logger.log(
            `OTP issued for ${maskPhone(norm)}${whatsappResult.status === 'sent' ? ' (WHATSAPP_SENT)' : ''}`
        );

        return { ok: true };
    }


    async verifyCode(body: { phone: string; code: string; firstName?: string; lastName?: string; rememberMe?: boolean; userAgent?: string; }) {
        const norm = normalizePhone(body.phone);
        if (!norm) throw new BadRequestException('Phone required');
        if (!/^\d{4}$/.test(String(body.code || ''))) throw new BadRequestException('Invalid code');
        const meta = await this.getOtpMeta(norm);
        const now = Date.now();
        if (meta.lockedUntil && meta.lockedUntil > now) {
            const retryAfterSeconds = Math.max(1, Math.ceil((meta.lockedUntil - now) / 1000));
            throw new HttpException(
                { error: 'RATE_LIMITED', message: 'OTP_ATTEMPTS_EXCEEDED', retryAfterSeconds } satisfies RateLimitPayload,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        const record = await this.loadOtp(norm);
        if (!record) {
            throw new BadRequestException('Invalid code');
        }
        if (new Date(record.expiresAt).getTime() < now) {
            await this.deleteOtp(norm);
            throw new BadRequestException('Code expired');
        }
        const valid = record.hashed
            ? verifyOtp(body.code, record.hashed, this.otpSecret)
            : false;
        if (!valid) {
            const retryAfterSeconds = await this.recordFailedOtpAttempt(norm);
            if (retryAfterSeconds) {
                throw new HttpException(
                    { error: 'RATE_LIMITED', message: 'OTP_ATTEMPTS_EXCEEDED', retryAfterSeconds } satisfies RateLimitPayload,
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
            throw new BadRequestException('Invalid code');
        }

        await this.deleteOtp(norm);
        await this.clearOtpMeta(norm);

        const variants = phoneVariants(norm);
        const client = await this.clientRepo.findOne({ where: variants.map((p) => ({ phone: p })) });
        if (!client) throw new BadRequestException('Invalid code');
        if (client.is_blocked) throw new ForbiddenException('CLIENT_BLOCKED');
        return this.buildAuthResult(client, body.rememberMe, body.userAgent);
    }

    async register(body: { phone: string; code: string; firstName?: string; lastName?: string; rememberMe?: boolean; userAgent?: string; }) {
        const norm = normalizePhone(body.phone);
        if (!norm) throw new BadRequestException('Phone required');
        if (!/^\d{4}$/.test(String(body.code || ''))) throw new BadRequestException('Invalid code');
        const meta = await this.getOtpMeta(norm);
        const now = Date.now();
        if (meta.lockedUntil && meta.lockedUntil > now) {
            const retryAfterSeconds = Math.max(1, Math.ceil((meta.lockedUntil - now) / 1000));
            throw new HttpException(
                { error: 'RATE_LIMITED', message: 'OTP_ATTEMPTS_EXCEEDED', retryAfterSeconds } satisfies RateLimitPayload,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
        const record = await this.loadOtp(norm);
        if (!record) throw new BadRequestException('Invalid code');
        if (new Date(record.expiresAt).getTime() < Date.now()) {
            await this.deleteOtp(norm);
            throw new BadRequestException('Code expired');
        }
        const valid = record.hashed
            ? verifyOtp(body.code, record.hashed, this.otpSecret)
            : false;
        if (!valid) {
            const retryAfterSeconds = await this.recordFailedOtpAttempt(norm);
            if (retryAfterSeconds) {
                throw new HttpException(
                    { error: 'RATE_LIMITED', message: 'OTP_ATTEMPTS_EXCEEDED', retryAfterSeconds } satisfies RateLimitPayload,
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
            throw new BadRequestException('Invalid code');
        }

        const firstName = sanitizeString(body.firstName || '');
        const lastName = sanitizeString(body.lastName || '');
        if (!firstName || !lastName) throw new BadRequestException('NAME_REQUIRED');

        if (await this.isRegistered(norm)) {
            throw new ConflictException('ALREADY_REGISTERED');
        }

        const partial: DeepPartial<Client> = {
            phone: norm,
            first_name: firstName,
            last_name: lastName,
            is_member: false,
        } as any;
        (partial as any).firstName = firstName;
        (partial as any).lastName = lastName;
        const client = this.clientRepo.create(partial);
        try {
            await this.clientRepo.save(client);
        } catch (e: any) {
            if (e?.code === '23505') throw new ConflictException('ALREADY_REGISTERED');
            throw e;
        }

        await this.deleteOtp(norm);
        await this.clearOtpMeta(norm);
        return this.buildAuthResult(client, body.rememberMe, body.userAgent);
    }

    private async buildAuthResult(client: Client, rememberMe?: boolean, userAgent?: string, logUpdates = true): Promise<AuthTokens> {
        const payload = this.buildClientPayload(client);
        const roles = await this.resolveRolesForPhone(payload.phone);
        const isAdmin = roles.includes('admin');
        const payloadWithRole = { ...payload, isAdmin, is_admin: isAdmin } as any;
        if (logUpdates) {
            await this.logClientLoginUpdates(client);
        }
        const access = this.issueAccessToken(payloadWithRole, roles);
        const remember = rememberMe ?? this.defaultRemember;
        let refreshToken: string | undefined;
        let refreshExpiresAt: Date | undefined;
        if (remember) {
            const refresh = await this.issueRefreshToken(client, userAgent);
            refreshToken = refresh.token;
            refreshExpiresAt = refresh.expiresAt;
        }
        return {
            ok: true,
            client: payloadWithRole,
            roles,
            token: access.token,
            expiresAt: access.expiresAt.toISOString(),
            refreshToken,
            refreshExpiresAt: refreshExpiresAt?.toISOString(),
        };
    }

    private async hasFutureAppointment(clientId: string): Promise<boolean> {
        if (!clientId) return false;

        const count = await this.appointmentRepo.count({
            where: {
                client: { id: clientId } as any,
                status: 'booked',
                startsAt: MoreThan(new Date()),
            },
        });

        return count > 0;
    }

    private async logClientLoginUpdates(client: Client) {
        if (await this.isAdminPhone(client.phone)) {
            return;
        }

        const firstName = ((client as any)?.firstName ?? client.first_name ?? '').toString().trim();
        const lastName = ((client as any)?.lastName ?? client.last_name ?? '').toString().trim();
        const clientName = `${firstName} ${lastName}`.trim() || client.phone;
        const clientId = String(client.id);
        if (await this.wasRecentlyLogged(clientId)) {
            return;
        }

        if (await this.hasFutureAppointment(clientId)) {
            return;
        }

        await this.appendAdminUpdate({
            type: 'login',
            message: `${clientName} נכנס למערכת`,
            color: 'neutral',
            clientName,
            clientId,
            createdAt: new Date().toISOString(),
        });

        const now = Date.now();
        await this.enqueuePendingNoBooking({
            clientId,
            clientName,
            loginAt: new Date(now).toISOString(),
            dueAt: new Date(now + this.noBookingDelayMs).toISOString(),
        });
        await this.reconcileDuePendingNoBooking();
    }

    private async appendAdminUpdate(event: AdminUpdateEvent) {
        const key = this.adminUpdatesFeedKey;
        const existing = await this.settingRepo.findOne({ where: { key } });
        const current = Array.isArray(existing?.value) ? existing.value : [];
        const next = [event, ...current].slice(0, 300);
        if (existing) {
            existing.value = next;
            await this.settingRepo.save(existing);
        } else {
            await this.settingRepo.save(this.settingRepo.create({ key, value: next }));
        }

        const clientId = event?.clientId ? String(event.clientId) : '';
        const isClientVisitUpdate = String(event?.type) === 'login' || String(event?.type) === 'visit_no_booking';
        const notificationUrl = isClientVisitUpdate && clientId
            ? `/Admin?notificationTarget=client-login&clientId=${encodeURIComponent(clientId)}`
            : isClientVisitUpdate
                ? '/Admin?notificationTarget=client-login'
                : '/Admin';

        await this.adminPushService.sendAdminUpdateNotification({
            title: 'עדכון חדש',
            body: String(event?.message || 'יש עדכון חדש במערכת').slice(0, 180),
            url: notificationUrl,
        });
    }


    private async wasRecentlyLogged(clientId: string, withinMs = 2 * 60 * 1000): Promise<boolean> {
        const existing = await this.settingRepo.findOne({ where: { key: this.adminUpdatesFeedKey } });
        const events = Array.isArray(existing?.value) ? existing.value : [];
        const now = Date.now();
        return events.some((event: any) => (
            String(event?.type) === 'login' &&
            String(event?.clientId ?? '') === clientId &&
            (now - new Date(event?.createdAt || 0).getTime()) <= withinMs
        ));
    }

    async trackClientVisit(payload: AuthTokenPayload | undefined) {
        if (!payload?.sub) return { ok: true, tracked: false };
        const client = await this.clientRepo.findOne({ where: { id: String(payload.sub) as any } });
        if (!client) return { ok: true, tracked: false };
        await this.logClientLoginUpdates(client);
        return { ok: true, tracked: true };
    }

    private async getPendingNoBookingEvents(): Promise<PendingNoBookingEvent[]> {
        const row = await this.settingRepo.findOne({ where: { key: this.pendingNoBookingKey } });
        const raw = Array.isArray(row?.value) ? row?.value : [];
        return raw
            .map((item: any) => ({
                clientId: String(item?.clientId ?? ''),
                clientName: String(item?.clientName ?? ''),
                loginAt: String(item?.loginAt ?? ''),
                dueAt: String(item?.dueAt ?? ''),
            }))
            .filter((item: PendingNoBookingEvent) => Boolean(item.clientId) && Boolean(item.clientName) && Boolean(item.dueAt));
    }

    private async savePendingNoBookingEvents(events: PendingNoBookingEvent[]) {
        const existing = await this.settingRepo.findOne({ where: { key: this.pendingNoBookingKey } });
        if (existing) {
            existing.value = events;
            await this.settingRepo.save(existing);
            return;
        }
        await this.settingRepo.save(this.settingRepo.create({ key: this.pendingNoBookingKey, value: events }));
    }

    private async enqueuePendingNoBooking(entry: PendingNoBookingEvent) {
        const current = await this.getPendingNoBookingEvents();
        const next = [entry, ...current.filter((item) => item.clientId !== entry.clientId)].slice(0, 300);
        await this.savePendingNoBookingEvents(next);
        this.schedulePendingNoBookingCheck(entry);
    }

    private schedulePendingNoBookingCheck(entry: PendingNoBookingEvent) {
        const delay = Math.max(0, new Date(entry.dueAt).getTime() - Date.now());
        setTimeout(() => {
            this.reconcileDuePendingNoBooking().catch((error) => {
                this.logger.warn(`Failed to reconcile no-booking updates: ${String(error?.message || error)}`);
            });
        }, delay);
    }

    private async reconcileDuePendingNoBooking() {
        const all = await this.getPendingNoBookingEvents();
        if (!all.length) return;
        const now = Date.now();
        const due = all.filter((entry) => new Date(entry.dueAt).getTime() <= now);
        const future = all.filter((entry) => new Date(entry.dueAt).getTime() > now);

        for (const entry of due) {
            const client = await this.clientRepo.findOne({ where: { id: entry.clientId as any } });
            if (client && await this.isAdminPhone(client.phone)) {
                continue;
            }

            if (await this.hasFutureAppointment(entry.clientId)) {
                continue;
            }

            await this.appendAdminUpdate({
                type: 'visit_no_booking',
                message: `${entry.clientName} ביקר במערכת אבל לא קבע תור`,
                color: 'red',
                clientName: entry.clientName,
                clientId: entry.clientId,
                createdAt: new Date().toISOString(),
            });
        }

        await this.savePendingNoBookingEvents(future);
    }

    private buildClientPayload(client: Client) {
        const firstName = (client as any).firstName ?? client.first_name ?? '';
        const lastName = (client as any).lastName ?? client.last_name ?? '';
        const isMember = Boolean((client as any).isMember ?? client.is_member ?? false);
        const isBlocked = Boolean((client as any).isBlocked ?? client.is_blocked ?? false);
        const phone = client.phone;
        return { id: client.id, phone, firstName, lastName, isMember, is_member: isMember, isBlocked, is_blocked: isBlocked } as any;
    }

    private async resolveRolesForPhone(phone: string): Promise<AuthRole[]> {
        const roles: AuthRole[] = ['client'];
        const isAdmin = await this.isAdminPhone(phone);
        if (isAdmin) roles.push('admin');
        return roles;
    }

    private async isAdminPhone(phone: string): Promise<boolean> {
        const variants = phoneVariants(phone);
        if (variants.length === 0) return false;

        const envPhones = (this.configService.get<string>('ADMIN_PHONES') || '')
            .split(',')
            .map(p => normalizePhone(p) || p.trim())
            .filter(Boolean);

        const digitsOnly = (s: string) => String(s).replace(/\D/g, '');
        const isInEnv = variants.some(v => envPhones.some(e => digitsOnly(e) === digitsOnly(v)));
        if (isInEnv) return true;

        const admin = await this.adminRepo.findOne({ where: variants.map((p) => ({ phone: p })) });
        return !!admin;
    }


    private issueAccessToken(client: any, roles: AuthRole[]) {
        const payload: AuthTokenPayload = {
            sub: client.id,
            phone: client.phone,
            firstName: client.firstName,
            lastName: client.lastName,
            roles,
            isAdmin: roles.includes('admin'),
        };
        const token = sign(
            payload,
            this.jwtSecret as Secret,
            { expiresIn: this.accessTokenTtl as SignOptions['expiresIn'] }
        );
        const expiresAt = new Date(Date.now() + this.accessTokenMs);
        return { token, expiresAt };
    }

    private async issueRefreshToken(client: Client, userAgent?: string) {
        const raw = this.generateTokenValue();
        const hashed = hashSecret(raw, 15);
        const entity = this.refreshRepo.create({
            client,
            tokenHash: JSON.stringify(hashed),
            expiresAt: new Date(Date.now() + this.refreshTokenMs),
            userAgent,
        });
        const saved = await this.refreshRepo.save(entity);
        const compound = `${saved.id}.${raw}`;
        return { token: compound, expiresAt: entity.expiresAt };
    }

    async refreshAccessToken(rawToken: string) {
        const { id, token } = this.splitRefreshToken(rawToken);
        const record = await this.refreshRepo.findOne({ where: { id }, relations: ['client'] });
        if (!record || record.revokedAt) throw new UnauthorizedException('INVALID_REFRESH');
        if (record.expiresAt.getTime() < Date.now()) {
            await this.refreshRepo.update({ id: record.id }, { revokedAt: new Date() });
            throw new UnauthorizedException('REFRESH_EXPIRED');
        }
        const stored = record.tokenHash ? JSON.parse(record.tokenHash) : undefined;
        if (!verifySecret(token, stored)) {
            await this.refreshRepo.update({ id: record.id }, { revokedAt: new Date() });
            throw new UnauthorizedException('INVALID_REFRESH');
        }
        await this.refreshRepo.update({ id: record.id }, { revokedAt: new Date() });
        const auth = await this.buildAuthResult(record.client, true, record.userAgent, false);
        return auth;
    }

    async revokeRefreshToken(rawToken: string) {
        const { id } = this.splitRefreshToken(rawToken);
        await this.refreshRepo.update({ id }, { revokedAt: new Date() });
    }

    private splitRefreshToken(input: string): { id: string; token: string } {
        if (!input || !input.includes('.')) throw new UnauthorizedException('INVALID_REFRESH');
        const [id, token] = input.split('.');
        if (!id || !token) throw new UnauthorizedException('INVALID_REFRESH');
        return { id, token };
    }

    async verifyToken(token: string) {
        return this.jwt.verifyAsync(token); // משתמש באותו secret של JwtModule.register
    }

    // async verifyToken(token: string): Promise<AuthTokenPayload> {
    //     try {
    //         const decoded = verify(token, this.jwtSecret as Secret);
    //         if (typeof decoded === 'string') {
    //             throw new UnauthorizedException('INVALID_TOKEN');
    //         }
    //         const payload = decoded as unknown as AuthTokenPayload;
    //         if (!payload.sub || !payload.phone || !payload.exp || !payload.iat) {
    //             throw new UnauthorizedException('INVALID_TOKEN');
    //         }
    //         if (!payload.roles || payload.roles.length === 0) {
    //             payload.roles = ['client'];
    //         }
    //         payload.isAdmin = payload.roles.includes('admin');
    //         return payload;
    //     } catch (e) {
    //         throw new UnauthorizedException('INVALID_TOKEN');
    //     }
    // }

    private generateOtpCode(): string {
        return ('' + Math.floor(1000 + Math.random() * 9000)).substring(0, 4);
    }

    private generateTokenValue(): string {
        return randomBytes(48).toString('base64url');
    }
}
