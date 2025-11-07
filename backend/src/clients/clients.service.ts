import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { Appointment } from '../entities/appointment.entity'; // ← אם תרצה להשתמש ב-from(Appointment,...)

function normalizePhone(p?: string) {
    if (!p) return '';
    const digits = p.replace(/\D/g, '');
    if (digits.startsWith('972')) return '0' + digits.slice(3);
    if (digits.length === 9 && digits.startsWith('5')) return '0' + digits;
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    return digits.startsWith('0') ? digits : '0' + digits;
}

@Injectable()
export class ClientsService {
    constructor(@InjectRepository(Client) private repo: Repository<Client>) {}

    // אם אין לך createdAt ב-Entity – תישאר עם id:
    async findAll(): Promise<Client[]> {
        return this.repo.find({ order: { id: 'DESC' } });
        // אם יש createdAt:
        // return this.repo.find({ order: { createdAt: 'DESC' } });
    }

    async create(dto: CreateClientDto): Promise<Client> {
        const phone = normalizePhone(dto.phone);
        const exists = await this.repo.exists({ where: { phone } });
        if (exists) throw new BadRequestException('PHONE_EXISTS');
        const entity = this.repo.create({ ...dto, phone });
        return this.repo.save(entity);
    }

    async update(id: number, dto: UpdateClientDto): Promise<Client> {
        const cur = await this.repo.findOneByOrFail({ id });
        const next = { ...cur, ...dto } as Client;
        if (dto.phone) next.phone = normalizePhone(dto.phone);
        if (next.phone !== cur.phone) {
            const clash = await this.repo.exists({ where: { phone: next.phone } });
            if (clash) throw new BadRequestException('PHONE_EXISTS');
        }
        await this.repo.update({ id }, next);
        return this.repo.findOneByOrFail({ id });
    }

    async remove(id: number): Promise<void> {
        await this.repo.delete({ id });
    }

    async findAllWithLastAppointment() {
        // פתרון יציב: סאבאקוויריי שמחשב MAX(starts_at) לכל לקוח
        const qb = this.repo.createQueryBuilder('c')
            .leftJoin(
                sub => sub
                    // אם יש לך Appointment Entity אפשר להשתמש בו:
                    // .from(Appointment, 'a')
                    .from('appointments', 'a')
                    .select('a.client_id', 'client_id')
                    .addSelect('MAX(a.starts_at)', 'last_at')
                    .groupBy('a.client_id'),
                'la',
                'la.client_id = c.id'
            )
            .addSelect('la.last_at', 'lastAppointmentAt')
            .orderBy('c.id', 'DESC');

        const { entities, raw } = await qb.getRawAndEntities();

        return entities.map((c, i) => ({
            id: c.id,
            // נחזיר גם camel וגם snake כדי להתאים לכל הקומפוננטים
            firstName:  (c as any).firstName ?? (c as any).first_name ?? '',
            lastName:   (c as any).lastName  ?? (c as any).last_name  ?? '',
            phone:      (c as any).phone     ?? '',
            first_name: (c as any).first_name ?? (c as any).firstName ?? '',
            last_name:  (c as any).last_name  ?? (c as any).lastName  ?? '',
            lastAppointmentAt: raw[i]?.lastAppointmentAt ?? raw[i]?.la_last_at ?? null,
        }));
    }
}
