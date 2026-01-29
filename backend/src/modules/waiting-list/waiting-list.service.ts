import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, LessThan, Repository } from 'typeorm';
import { DateTime } from 'luxon';
import { WaitingList } from '../../entities/waiting-list.entity';
import { Client } from '../../clients/client.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { Appointment } from '../../entities/appointment.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';

const TZ = 'Asia/Jerusalem';

interface WaitingListCreateInput {
    clientId?: number;
    clientName?: string;
    phone?: string;
    serviceId: string;
    desiredDate: string;
    desiredTime: string;
    isClubMember?: boolean;
}

@Injectable()
export class WaitingListService {
    constructor(
        @InjectRepository(WaitingList) private readonly waitingRepo: Repository<WaitingList>,
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        @InjectRepository(ServiceEntity) private readonly serviceRepo: Repository<ServiceEntity>,
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
        @InjectRepository(BlockedTime) private readonly blockRepo: Repository<BlockedTime>,
    ) {}

    private normalizePhone(raw?: string): string | null {
        if (!raw) return null;
        const digits = String(raw).replace(/\D/g, '');
        if (!digits) return null;
        if (digits.startsWith('972')) return `0${digits.slice(3)}`;
        if (digits.startsWith('0')) return digits;
        return `0${digits}`;
    }

    private normalizeDate(input?: string): string {
        if (!input) throw new BadRequestException('desired_date is required');
        if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
        const m = String(input).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        const d = new Date(input);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        throw new BadRequestException('Invalid date');
    }

    private normalizeTime(input?: string): string {
        if (!input) throw new BadRequestException('desired_time is required');
        const match = String(input).trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!match) throw new BadRequestException('Invalid time');
        const hh = String(match[1]).padStart(2, '0');
        const mm = String(match[2]).padStart(2, '0');
        return `${hh}:${mm}`;
    }

    private splitName(full?: string): { first: string; last: string } {
        const parts = String(full || '').trim().split(/\s+/);
        const first = parts[0] || '';
        const last = parts.slice(1).join(' ') || '';
        return { first, last };
    }

    private async resolveClient(input: WaitingListCreateInput, existing?: Client | null) {
        if (existing) return existing;
        if (input.clientId) {
            const found = await this.clientRepo.findOne({ where: { id: input.clientId } });
            if (found) return found;
        }
        const phone = this.normalizePhone(input.phone);
        if (phone) {
            const found = await this.clientRepo.findOne({ where: { phone } });
            if (found) return found;
        }
        return null;
    }

    async create(input: WaitingListCreateInput) {
        const service = await this.serviceRepo.findOne({ where: { id: input.serviceId } });
        if (!service) throw new NotFoundException('Service not found');

        const desiredDate = this.normalizeDate(input.desiredDate);
        const desiredTime = this.normalizeTime(input.desiredTime);
        const phone = this.normalizePhone(input.phone);
        const client = await this.resolveClient(input, null);
        const clientName =
            input.clientName ||
            (client ? `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() : '') ||
            phone ||
            '';

        if (!client && (!clientName || !phone)) {
            throw new BadRequestException('client_name and phone are required');
        }

        const isClubMember =
            input.isClubMember ??
            Boolean((client as any)?.isMember ?? (client as any)?.is_member ?? false);

        const duplicate = await this.waitingRepo.findOne({
            where: client?.id
                ? {
                      desiredDate,
                      desiredTime,
                      service: { id: service.id },
                      client: { id: client.id },
                      status: 'open',
                  }
                : {
                      desiredDate,
                      desiredTime,
                      service: { id: service.id },
                      phone: phone ?? undefined,
                      status: 'open',
                  },
        });

        if (duplicate) {
            throw new ConflictException('Already on waiting list for this time');
        }

        const entry = this.waitingRepo.create({
            client: client ?? undefined,
            clientName,
            phone: phone ?? undefined,
            service,
            desiredDate,
            desiredTime,
            isClubMember: Boolean(isClubMember),
            status: 'open',
        });

        return this.waitingRepo.save(entry);
    }

    async listByDate(date?: string) {
        const where = date ? { desiredDate: this.normalizeDate(date) } : {};
        return this.waitingRepo.find({
            where,
            order: {
                desiredDate: 'ASC',
                desiredTime: 'ASC',
                isClubMember: 'DESC',
                createdAt: 'ASC',
            },
        });
    }

    async listByPhone(phone: string) {
        const normalizedPhone = this.normalizePhone(phone);
        if (!normalizedPhone) return [];

        return this.waitingRepo
            .createQueryBuilder('waiting')
            .leftJoinAndSelect('waiting.client', 'client')
            .leftJoinAndSelect('waiting.service', 'service')
            .where('waiting.phone = :phone', { phone: normalizedPhone })
            .orWhere('client.phone = :phone', { phone: normalizedPhone })
            .orderBy('waiting.desiredDate', 'ASC')
            .addOrderBy('waiting.desiredTime', 'ASC')
            .addOrderBy('waiting.isClubMember', 'DESC')
            .addOrderBy('waiting.createdAt', 'ASC')
            .getMany();
    }

    async remove(id: string) {
        const entry = await this.waitingRepo.findOne({ where: { id } });
        if (!entry) throw new NotFoundException('Waiting list entry not found');
        await this.waitingRepo.remove(entry);
        return { ok: true };
    }

    async removeForPhone(id: string, phone: string) {
        const normalizedPhone = this.normalizePhone(phone);
        if (!normalizedPhone) throw new BadRequestException('Phone is required');
        const entry = await this.waitingRepo
            .createQueryBuilder('waiting')
            .leftJoinAndSelect('waiting.client', 'client')
            .where('waiting.id = :id', { id })
            .andWhere('(waiting.phone = :phone OR client.phone = :phone)', { phone: normalizedPhone })
            .getOne();
        if (!entry) throw new NotFoundException('Waiting list entry not found');
        await this.waitingRepo.remove(entry);
        return { ok: true };
    }

    async assign(id: string) {
        const entry = await this.waitingRepo.findOne({ where: { id } });
        if (!entry) throw new NotFoundException('Waiting list entry not found');
        const service = entry.service
            ? entry.service
            : await this.serviceRepo.findOne({ where: { id: entry.service?.id } });
        if (!service) throw new BadRequestException('Service missing');

        const start = DateTime.fromISO(`${entry.desiredDate}T${entry.desiredTime}`, { zone: TZ });
        if (!start.isValid) throw new BadRequestException('Invalid desired slot');
        const end = start.plus({ minutes: service.durationMinutes });

        const slotStart = start.toUTC().toJSDate();
        const slotEnd = end.toUTC().toJSDate();

        const blocking = await this.blockRepo.exist({
            where: { startsAt: LessThan(slotEnd), endsAt: MoreThan(slotStart) },
        });
        if (blocking) throw new ConflictException('Slot is blocked');

        const hasOverlap = await this.apptRepo
            .createQueryBuilder('a')
            .where('a.startsAt < :slotEnd', { slotEnd })
            .andWhere('(a.endsAt IS NULL OR a.endsAt > :slotStart)', { slotStart })
            .getExists();
        if (hasOverlap) throw new ConflictException('Slot still booked');

        const phone = this.normalizePhone(entry.phone);
        let client = entry.client ?? null;
        if (!client && phone) {
            client = await this.clientRepo.findOne({ where: { phone } });
        }
        if (!client) {
            const names = this.splitName(entry.clientName);
            if (!phone || !names.first) {
                throw new BadRequestException('Client details missing');
            }
            const created = this.clientRepo.create({
                phone,
                first_name: names.first,
                last_name: names.last || '',
                is_member: Boolean(entry.isClubMember),
            } as Partial<Client>);
            client = await this.clientRepo.save(created);
        }

        const appointment = this.apptRepo.create({
            client,
            service,
            startsAt: slotStart,
            endsAt: slotEnd,
        });
        const saved = await this.apptRepo.save(appointment);

        await this.waitingRepo.remove(entry);
        return saved;
    }
}
