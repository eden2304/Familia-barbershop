import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Not } from 'typeorm';
import { Client } from './client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ensureRecurringSchema } from '../modules/appointments/recurring.helpers';

function normalizePhone(p?: string) {
    if (!p) return '';
    const digits = p.replace(/\D/g, '');
    if (digits.startsWith('972')) return '0' + digits.slice(3);
    if (digits.length === 9 && digits.startsWith('5')) return '0' + digits;
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    return digits.startsWith('0') ? digits : '0' + digits;
}

function normalizeDigits(phone?: string): string {
    if (!phone) return '';
    return String(phone).replace(/\D/g, '');
}


async function findClientByPhoneDigits(repo: Repository<Client>, digits: string): Promise<Client | null> {
    const q = normalizeDigits(digits);
    if (!q) return null;

    const client = await repo
        .createQueryBuilder('c')
        .where("regexp_replace(c.phone, '\\D', '', 'g') LIKE :p", { p: `%${q}%` })
        .getOne();

    return client || null;
}


function parseBool(value: any): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const norm = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on'].includes(norm);
}

function toNumericId(raw: any): number | null {
    if (raw === undefined || raw === null) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
}

@Injectable()
export class ClientsService {
    constructor(
        @InjectRepository(Client) private repo: Repository<Client>,
        @InjectDataSource() private readonly ds: DataSource,
    ) {}

    private async findByAnyId(candidate: any): Promise<Client | null> {
        if (candidate === undefined || candidate === null) return null;

        const numericId = toNumericId(candidate);
        if (numericId !== null) {
            const byNumeric = await this.repo.findOne({ where: { id: numericId } });
            if (byNumeric) return byNumeric;
        }

        const raw = String(candidate).trim();
        if (!raw) return null;

        try {
            return await this.repo.createQueryBuilder('c')
                .where('CAST(c.id AS text) = :raw', { raw })
                .getOne();
        } catch {
            return null;
        }
    }

    async lookupByPhone(phone: string): Promise<Client | null> {
        return findClientByPhoneDigits(this.repo, phone);
    }

    private extractName(source: any, primary: 'first' | 'last', fallback: string): string {
        const snake = primary === 'first' ? 'first_name' : 'last_name';
        const camel = primary === 'first' ? 'firstName' : 'lastName';
        if (Object.prototype.hasOwnProperty.call(source, snake) || Object.prototype.hasOwnProperty.call(source, camel)) {
            return String(source[snake] ?? source[camel] ?? '').trim();
        }
        return fallback;
    }

    private extractPhone(source: any, fallback: string): { value: string; provided: boolean } {
        const hasSnake = Object.prototype.hasOwnProperty.call(source, 'phone') ||
            Object.prototype.hasOwnProperty.call(source, 'client_phone') ||
            Object.prototype.hasOwnProperty.call(source, 'clientPhone');

        if (!hasSnake) {
            return { value: fallback, provided: false };
        }

        const raw = source.phone ?? source.client_phone ?? source.clientPhone ?? '';
        return { value: normalizePhone(String(raw)), provided: true };
    }

    private extractIsMember(source: any, fallback: boolean): { value: boolean; provided: boolean } {
        const has = Object.prototype.hasOwnProperty.call(source, 'is_member') ||
            Object.prototype.hasOwnProperty.call(source, 'isMember');
        if (!has) {
            return { value: fallback, provided: false };
        }
        const raw = source.is_member ?? source.isMember;
        return { value: parseBool(raw), provided: true };
    }

    // אם אין לך createdAt ב-Entity – תישאר עם id:
    async findAll(): Promise<Client[]> {
        return this.repo.find({ order: { id: 'DESC' } });
        // אם יש createdAt:
        // return this.repo.find({ order: { createdAt: 'DESC' } });
    }

    async create(dto: CreateClientDto): Promise<Client> {
        const body: any = dto as any;
        const firstName = String(body.first_name ?? body.firstName ?? '').trim();
        const lastName = String(body.last_name ?? body.lastName ?? '').trim();
        const phone = normalizePhone(body.phone ?? body.client_phone ?? body.clientPhone ?? '');
        if (!phone) throw new BadRequestException('PHONE_REQUIRED');

        const exists = await this.repo.exists({ where: { phone } });
        if (exists) throw new BadRequestException('PHONE_EXISTS');

        const isMember = parseBool(body.is_member ?? body.isMember);
        const entity = this.repo.create({
            first_name: firstName,
            last_name: lastName,
            phone,
            is_member: isMember,
        });
        return this.repo.save(entity);
    }

    async update(id: string, dto: UpdateClientDto): Promise<Client> {
        const body: any = dto as any;

        const candidates = [id, body.id, body.client_id, body.clientId];
        let current: Client | null = null;
        for (const candidate of candidates) {
            current = await this.findByAnyId(candidate);
            if (current) break;
        }

        if (!current) {
            const phoneFallback = body.phone ?? body.client_phone ?? body.clientPhone ?? null;
            if (phoneFallback) {
                const normalized = normalizePhone(String(phoneFallback));
                if (normalized) {
                    current = await this.repo.findOne({ where: { phone: normalized } });
                }
            }
        }

        if (!current) {
            throw new NotFoundException('CLIENT_NOT_FOUND');
        }

        const nextFirst = this.extractName(body, 'first', current.first_name ?? '');
        const nextLast = this.extractName(body, 'last', current.last_name ?? '');
        const phoneInfo = this.extractPhone(body, current.phone ?? '');
        const memberInfo = this.extractIsMember(body, Boolean(current.is_member));

        if (phoneInfo.provided && !phoneInfo.value) {
            throw new BadRequestException('PHONE_REQUIRED');
        }

        const desiredPhone = phoneInfo.provided ? phoneInfo.value : current.phone;

        if (desiredPhone !== current.phone) {
            const clash = await this.repo.findOne({ where: { phone: desiredPhone, id: Not(current.id) }, select: { id: true } });
            if (clash) throw new BadRequestException('PHONE_EXISTS');
        }

        const desiredMember = memberInfo.provided ? memberInfo.value : current.is_member;

        await this.repo.update({ id: current.id }, {
            first_name: nextFirst,
            last_name: nextLast,
            phone: desiredPhone,
            is_member: desiredMember,
        });

        return this.repo.findOneByOrFail({ id: current.id });
    }

    async remove(id: string): Promise<void> {
        const existing = await this.findByAnyId(id);
        if (!existing) {
            throw new NotFoundException('CLIENT_NOT_FOUND');
        }
        await this.repo.delete({ id: existing.id });
    }

    async findAllWithLastAppointment() {
        await ensureRecurringSchema(this.ds);
        const rows = await this.ds.query(`
            select c.id,
                   c.first_name,
                   c.last_name,
                   c.phone,
                   coalesce(c.is_member,false) as is_member,
                   (select max(a.starts_at) from appointments a where a.client_id = c.id) as last_appointment_at,
                   coalesce(json_agg(
                       json_build_object(
                         'id', r.id,
                         'weekday', r.weekday,
                         'start_time', r.start_time,
                         'interval_weeks', r.interval_weeks,
                         'interval_months', r.interval_months,
                         'day_of_month', r.day_of_month,
                         'service_id', r.service_id,
                         'service_name', s.name
                       )
                   ) filter (where r.id is not null), '[]') as recurring
            from clients c
            left join recurring_appointments r on r.client_id = c.id
            left join services s on s.id = r.service_id
            group by c.id
            order by c.id desc
        `);

        return (rows || []).map((r: any) => ({
            id: r.id,
            firstName: r.first_name || '',
            lastName: r.last_name || '',
            phone: r.phone || '',
            first_name: r.first_name || '',
            last_name: r.last_name || '',
            isMember: Boolean(r.is_member),
            is_member: Boolean(r.is_member),
            lastAppointmentAt: r.last_appointment_at || null,
            recurringAppointments: Array.isArray(r.recurring) ? r.recurring : [],
            recurring_appointments: Array.isArray(r.recurring) ? r.recurring : [],
        }));
    }
}
