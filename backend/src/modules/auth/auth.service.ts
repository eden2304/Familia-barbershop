import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';
import { AdminPhone } from '../../entities/admin-phone.entity';
import { ConfigService } from '@nestjs/config';
import { sign, verify } from 'jsonwebtoken';
import { AuthRole, AuthTokenPayload } from './auth.types';
import { WhatsappService } from '../whatsapp/whatsapp.service';

function normalizePhone(phone: string): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0')) return digits; // 05XXXXXXXX
    if (digits.startsWith('972')) return '0' + digits.slice(3); // 9725XXXX → 05XXXX
    return digits;
}

// מחזיר את כל הוריאנטים הסבירים לשאילתה (כולל ייצוג עם +972 למספרים ישנים במסד)
function phoneVariants(phone: string): string[] {
    if (!phone) return [];
    const raw = phone.toString().trim();
    const norm = normalizePhone(raw); // 05XXXXXXXX
    const e164 = norm && norm.startsWith('0') ? `972${norm.slice(1)}` : norm; // 9725XXXXXXXX
    const plusE164 = e164 ? `+${e164}` : '';
    const plusNorm = norm ? `+${norm}` : '';
    const digitsOnly = raw.replace(/\D/g, '');
    const plusDigits = digitsOnly ? `+${digitsOnly}` : '';

    return Array.from(
        new Set([norm, e164, plusE164, plusNorm, plusDigits, raw].filter(Boolean)),
    );
}

@Injectable()
export class AuthService {
    private DEV_CODE = '1111';
    private readonly jwtSecret: string;
    private readonly jwtExpiresIn: string;
    private readonly jwtExpiresMs: number;
    private readonly otpTtlMs = 10 * 60 * 1000;

    constructor(
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
        @InjectRepository(AdminPhone) private readonly adminRepo: Repository<AdminPhone>,
        private readonly configService: ConfigService,
        private readonly whatsappService: WhatsappService,
    ) {
        this.jwtSecret = this.configService.get<string>('JWT_SECRET') || 'familia-dev-secret';
        const configuredExpires = this.configService.get<string>('JWT_EXPIRES_IN');
        this.jwtExpiresIn = configuredExpires || '30d';
        this.jwtExpiresMs = this.parseDurationToMs(this.jwtExpiresIn, 30 * 24 * 60 * 60 * 1000);
    }

    private parseDurationToMs(input: string | undefined, fallback: number): number {
        if (!input) return fallback;
        const trimmed = input.trim();
        const match = trimmed.match(/^(\d+)([smhd])$/i);
        if (match) {
            const value = Number(match[1]);
            const unit = match[2].toLowerCase();
            const multipliers: Record<string, number> = {
                s: 1000,
                m: 60 * 1000,
                h: 60 * 60 * 1000,
                d: 24 * 60 * 60 * 1000,
            };
            return value * (multipliers[unit] ?? 1000);
        }
        const asNumber = Number(trimmed);
        if (!Number.isNaN(asNumber) && asNumber > 0) {
            // treat as seconds
            return asNumber * 1000;
        }
        return fallback;
    }

    async isRegistered(phone: string): Promise<boolean> {
        const variants = phoneVariants(phone);
        if (variants.length === 0) return false;

        // יש התאמה אם קיים לקוח עם אחד הווריאנטים
        const c = await this.clientRepo.findOne({ where: variants.map(p => ({ phone: p })) });
        return !!c;
    }

    async requestCode(phone: string) {
        const norm = normalizePhone(phone);
        if (!norm) throw new BadRequestException('Phone required');

        // שומרים תמיד את ה־OTP לפי המפתח של ה־05XXX
        const key = `otp:${norm}`;
        const config = await this.whatsappService.getConfig();
        const usingDevCode = !this.whatsappService.isConfigured(config);
        const code = usingDevCode ? this.DEV_CODE : this.generateOtp();
        const payload = {
            code,
            expiresAt: new Date(Date.now() + this.otpTtlMs).toISOString(),
            channel: 'whatsapp',
            usingDevCode,
        };

        await this.settingRepo.save({ key, value: payload });

        if (!usingDevCode) {
            await this.whatsappService.sendOtp(norm, code);
        }

        return { ok: true, devFallback: usingDevCode };
    }

    async verifyCode(body: { phone: string; code: string; firstName?: string; lastName?: string; }) {
        const variants = phoneVariants(body.phone);
        if (variants.length === 0) throw new BadRequestException('Phone required');
        if (!body.code) throw new BadRequestException('Code required');

        const norm = normalizePhone(body.phone);
        await this.ensureValidOtp(norm, body.code);

        // מוצאים לפי כל הוריאנטים
        const client = await this.clientRepo.findOne({ where: variants.map(p => ({ phone: p })) });
        if (!client) throw new ConflictException('UNREGISTERED_CLIENT');

        return this.buildAuthResult(client);
    }

    async register(body: { phone: string; code: string; firstName?: string; lastName?: string; }) {
        const norm = normalizePhone(body.phone);
        if (!norm) throw new BadRequestException('Phone required');
        if (!body.code) throw new BadRequestException('Code required');

        await this.ensureValidOtp(norm, body.code);

        const firstName = body.firstName?.trim();
        const lastName  = body.lastName?.trim();
        if (!firstName || !lastName) throw new BadRequestException('NAME_REQUIRED');

        // בדיקה חזקה: אם קיים לקוח עם 05… או 972… → כבר רשום
        if (await this.isRegistered(norm)) {
            throw new ConflictException('ALREADY_REGISTERED');
        }

        // מכאן ואילך – שומרים תמיד בפורמט 05… כדי לאחד את הנתונים
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

        return this.buildAuthResult(client);
    }

    private generateOtp(): string {
        return String(Math.floor(1000 + Math.random() * 9000));
    }

    private async ensureValidOtp(normPhone: string, providedCode: string) {
        const key = `otp:${normPhone}`;
        const stored = await this.settingRepo.findOne({ where: { key } });
        const value = stored?.value;
        const storedCode = typeof value === 'string' ? value : value?.code;
        const expiresAt = typeof value === 'object' ? value?.expiresAt : null;
        const expires = expiresAt ? new Date(expiresAt).getTime() : null;

        const config = await this.whatsappService.getConfig();
        const allowDevFallback = !this.whatsappService.isConfigured(config);

        if (expires && Date.now() > expires) {
            throw new BadRequestException('EXPIRED_CODE');
        }

        if (storedCode && providedCode === storedCode) return true;
        if (allowDevFallback && providedCode === this.DEV_CODE) return true;

        throw new BadRequestException('Invalid code');
    }

    private async buildAuthResult(client: Client) {
        const payload = this.buildClientPayload(client);
        const roles = await this.resolveRolesForPhone(payload.phone);
        const isAdmin = roles.includes('admin');
        const payloadWithRole = { ...payload, isAdmin, is_admin: isAdmin } as any;
        const { token, expiresAt } = this.issueToken(payloadWithRole, roles);
        return {
            ok: true,
            client: payloadWithRole,
            roles,
            token,
            expiresAt: expiresAt.toISOString(),
        };
    }

    private buildClientPayload(client: Client) {
        const firstName = (client as any).firstName ?? client.first_name ?? '';
        const lastName = (client as any).lastName ?? client.last_name ?? '';
        const isMember = Boolean((client as any).isMember ?? client.is_member ?? false);
        const phone = client.phone;
        return {
            id: client.id,
            phone,
            firstName,
            lastName,
            isMember,
            is_member: isMember,
        } as any;
    }

    private async resolveRolesForPhone(phone: string): Promise<AuthRole[]> {
        const roles: AuthRole[] = ['client'];
        const isAdmin = await this.isAdminPhone(phone);
        if (isAdmin) {
            roles.push('admin');
        }
        return roles;
    }

    private async isAdminPhone(phone: string): Promise<boolean> {
        const variants = phoneVariants(phone);
        if (variants.length === 0) return false;
        const admin = await this.adminRepo.findOne({ where: variants.map(p => ({ phone: p })) });
        return !!admin;
    }

    private issueToken(client: any, roles: AuthRole[]) {
        const payload: AuthTokenPayload = {
            sub: client.id,
            phone: client.phone,
            firstName: client.firstName,
            lastName: client.lastName,
            roles,
            isAdmin: roles.includes('admin'),
        };
        const token = sign(payload, this.jwtSecret, { expiresIn: this.jwtExpiresIn });
        const expiresAt = new Date(Date.now() + this.jwtExpiresMs);
        return { token, expiresAt };
    }

    async verifyToken(token: string): Promise<AuthTokenPayload> {
        try {
            const payload = verify(token, this.jwtSecret) as AuthTokenPayload;
            if (!payload.roles || payload.roles.length === 0) {
                payload.roles = ['client'];
            }
            payload.isAdmin = payload.roles.includes('admin');
            return payload;
        } catch (e) {
            throw new UnauthorizedException('INVALID_TOKEN');
        }
    }
}
