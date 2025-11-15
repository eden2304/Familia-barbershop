import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WaitingListEntry, WaitingStatus } from '../../entities/waiting-list.entity';
import { Client } from '../../clients/client.entity';
import { ServiceEntity } from '../../entities/service.entity';

export interface CreateWaitingListDto {
    clientId?: number;
    clientName?: string;
    phone: string;
    serviceId: string;
    desiredStartsAt: Date;
    status?: WaitingStatus;
}

export interface UpdateWaitingListDto {
    clientId?: number | null;
    clientName?: string;
    phone?: string;
    serviceId?: string | null;
    desiredStartsAt?: Date;
    status?: WaitingStatus;
}

export interface WaitingListFilters {
    statuses?: WaitingStatus[];
    date?: string;
    serviceId?: string;
}

export interface WaitingListResponse {
    id: string;
    client_id: number | null;
    client_name: string;
    phone: string;
    service_id: string | null;
    desired_starts_at: string;
    status: WaitingStatus;
    created_at?: string;
    updated_at?: string;
    service_name?: string;
    service_duration_minutes?: number;
}

@Injectable()
export class WaitingListService {
    constructor(
        @InjectRepository(WaitingListEntry) private readonly repo: Repository<WaitingListEntry>,
        @InjectRepository(Client) private readonly clientsRepo: Repository<Client>,
        @InjectRepository(ServiceEntity) private readonly servicesRepo: Repository<ServiceEntity>,
    ) {}

    async create(dto: CreateWaitingListDto): Promise<WaitingListResponse> {
        if (!dto?.serviceId) throw new BadRequestException('serviceId is required');
        if (!dto?.desiredStartsAt) throw new BadRequestException('desired_starts_at is required');
        if (!dto?.phone) throw new BadRequestException('phone is required');

        const normalizedPhone = this.normalizePhone(dto.phone);
        if (!normalizedPhone) throw new BadRequestException('phone is required');

        const entry = new WaitingListEntry();
        entry.phone = normalizedPhone;
        entry.clientName = (dto.clientName ?? '').trim();
        entry.desiredStartsAt = dto.desiredStartsAt;
        entry.status = this.normalizeStatus(dto.status);

        if (dto.clientId) {
            entry.client = await this.clientsRepo.findOne({ where: { id: dto.clientId } });
        } else {
            entry.client = await this.clientsRepo.findOne({ where: { phone: normalizedPhone } });
        }

        entry.service = dto.serviceId ? await this.servicesRepo.findOne({ where: { id: dto.serviceId } }) : null;

        if (!entry.clientName) {
            const fromClient = entry.client ? `${entry.client.first_name} ${entry.client.last_name}`.trim() : '';
            entry.clientName = fromClient || normalizedPhone;
        }

        const saved = await this.repo.save(entry);
        return this.serialize(saved);
    }

    async list(filters: WaitingListFilters = {}): Promise<WaitingListResponse[]> {
        const qb = this.repo.createQueryBuilder('waiting')
            .leftJoinAndSelect('waiting.service', 'service')
            .leftJoinAndSelect('waiting.client', 'client');

        const statuses = filters.statuses?.length ? filters.statuses : ['waiting', 'notified'];
        qb.andWhere('waiting.status IN (:...statuses)', { statuses });

        if (filters.date) {
            const { start, end } = this.getDateBounds(filters.date);
            qb.andWhere('waiting.desiredStartsAt >= :start AND waiting.desiredStartsAt < :end', { start, end });
        }

        if (filters.serviceId) {
            qb.andWhere('service.id = :serviceId', { serviceId: filters.serviceId });
        }

        qb.orderBy('waiting.createdAt', 'DESC');

        const entries = await qb.getMany();
        return entries.map((entry) => this.serialize(entry));
    }

    async update(id: string, patch: UpdateWaitingListDto): Promise<WaitingListResponse> {
        const entry = await this.repo.findOne({ where: { id } });
        if (!entry) throw new NotFoundException('WAITING_ENTRY_NOT_FOUND');

        if (patch.clientId !== undefined) {
            entry.client = patch.clientId ? await this.clientsRepo.findOne({ where: { id: patch.clientId } }) : null;
        }

        if (patch.clientName !== undefined) {
            entry.clientName = patch.clientName?.trim?.() ?? '';
        }

        if (patch.phone !== undefined) {
            const normalized = this.normalizePhone(patch.phone);
            if (!normalized) throw new BadRequestException('phone is required');
            entry.phone = normalized;
        }

        if (patch.serviceId !== undefined) {
            entry.service = patch.serviceId ? await this.servicesRepo.findOne({ where: { id: patch.serviceId } }) : null;
        }

        if (patch.desiredStartsAt) {
            entry.desiredStartsAt = patch.desiredStartsAt;
        }

        if (patch.status) {
            entry.status = this.normalizeStatus(patch.status);
        }

        const saved = await this.repo.save(entry);
        return this.serialize(saved);
    }

    async remove(id: string): Promise<void> {
        await this.repo.delete({ id });
    }

    serialize(entry: WaitingListEntry): WaitingListResponse {
        return {
            id: entry.id,
            client_id: entry.client?.id ?? null,
            client_name: entry.clientName ?? '',
            phone: entry.phone,
            service_id: entry.service?.id ?? null,
            desired_starts_at: entry.desiredStartsAt?.toISOString?.() ?? new Date(entry.desiredStartsAt).toISOString(),
            status: entry.status,
            created_at: entry.createdAt?.toISOString?.(),
            updated_at: entry.updatedAt?.toISOString?.(),
            service_name: entry.service?.name,
            service_duration_minutes: entry.service?.durationMinutes,
        };
    }

    private normalizeStatus(status?: WaitingStatus): WaitingStatus {
        const allowed: WaitingStatus[] = ['waiting', 'notified', 'booked', 'canceled'];
        return allowed.includes(status as WaitingStatus) ? status : 'waiting';
    }

    private normalizePhone(phone: string): string {
        if (!phone) return '';
        const digits = String(phone).replace(/\D/g, '');
        if (!digits) return '';
        if (digits.startsWith('972')) return '0' + digits.slice(3);
        if (digits.length === 9 && digits.startsWith('5')) return '0' + digits;
        if (digits.length === 10 && digits.startsWith('0')) return digits;
        return digits.startsWith('0') ? digits : '0' + digits;
    }

    private getDateBounds(date: string): { start: Date; end: Date } {
        const parsed = new Date(date);
        if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid date');
        const start = new Date(parsed);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { start, end };
    }
}
