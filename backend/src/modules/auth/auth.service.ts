import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';

function normalizePhone(phone: string): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0')) return digits;            // 05XXXXXXXX
    if (digits.startsWith('972')) return '0' + digits.slice(3); // 9725XXXX → 05XXXX
    return digits;
}

// מחזיר את כל הוריאנטים הסבירים לשאילתה
function phoneVariants(phone: string): string[] {
    const norm = normalizePhone(phone); // 05XXXXXXXX
    const e164 = norm && norm.startsWith('0') ? `972${norm.slice(1)}` : norm; // 9725XXXXXXXX
    return Array.from(new Set([norm, e164].filter(Boolean)));
}

@Injectable()
export class AuthService {
    private DEV_CODE = '1111';

    constructor(
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
    ) {}

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
        const existing = await this.settingRepo.findOne({ where: { key } });
        if (existing) {
            existing.value = this.DEV_CODE;
            await this.settingRepo.save(existing);
        } else {
            const s = this.settingRepo.create({ key, value: this.DEV_CODE });
            await this.settingRepo.save(s);
        }
        return { ok: true };
    }

    async verifyCode(body: { phone: string; code: string; firstName?: string; lastName?: string; }) {
        const variants = phoneVariants(body.phone);
        if (variants.length === 0) throw new BadRequestException('Phone required');
        if (!body.code) throw new BadRequestException('Code required');
        if (body.code !== this.DEV_CODE) throw new BadRequestException('Invalid code');

        // מוצאים לפי כל הוריאנטים
        const client = await this.clientRepo.findOne({ where: variants.map(p => ({ phone: p })) });
        if (!client) throw new ConflictException('UNREGISTERED_CLIENT');

        const isMember = Boolean((client as any).isMember ?? (client as any).is_member ?? false);

        return {
            ok: true,
            client: {
                id: client.id,
                phone: client.phone,
                firstName: (client as any).firstName,
                lastName: (client as any).lastName,
                isMember,
                is_member: isMember,
            },
        };
    }

    async register(body: { phone: string; code: string; firstName?: string; lastName?: string; }) {
        const norm = normalizePhone(body.phone);
        if (!norm) throw new BadRequestException('Phone required');
        if (!body.code) throw new BadRequestException('Code required');
        if (body.code !== this.DEV_CODE) throw new BadRequestException('Invalid code');

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

        return {
            ok: true,
            client: {
                id: client.id,
                phone: client.phone,
                firstName: (client as any).firstName,
                lastName: (client as any).lastName,
                isMember: false,
                is_member: false,
            },
        };
    }
}
