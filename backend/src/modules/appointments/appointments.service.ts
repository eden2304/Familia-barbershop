import {
    Injectable,
    ConflictException,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
    Repository,
    LessThan,
    MoreThan,
    MoreThanOrEqual,
    LessThanOrEqual,
    DeepPartial,
} from 'typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { Client } from '../../clients/client.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { BusinessHour } from '../../entities/business-hour.entity';

export interface CreateAppointmentDto {
    clientPhone: string;
    clientFirstName: string;
    clientLastName: string;
    serviceId: string;
    startsAtISO: string;
    note?: string;
}

@Injectable()
export class AppointmentsService {
    constructor(
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
        @InjectRepository(ServiceEntity) private readonly svcRepo: Repository<ServiceEntity>,
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        @InjectRepository(BlockedTime) private readonly blockRepo: Repository<BlockedTime>,
        @InjectRepository(BusinessHour) private readonly bhRepo: Repository<BusinessHour>,
    ) {}

    private normalizePhone(raw: string) {
        if (!raw) return '';
        const digits = raw.replace(/\D/g, '');
        if (digits.startsWith('0')) return digits;
        if (digits.startsWith('972')) return '0' + digits.slice(3);
        return digits;
    }

    private parseLocalISO(isoLike: string) {
        // אם אין אזור זמן, נניח +03:00
        if (/Z$|[+-]\d\d:\d\d$/.test(isoLike)) return new Date(isoLike);
        return new Date(`${isoLike}+03:00`);
    }

    private ensureNotPast(startAt: Date) {
        const now = new Date();
        if (startAt.getTime() <= now.getTime()) {
            throw new ForbiddenException('CANNOT_BOOK_PAST');
        }
    }

    private async ensureWithinBusinessHours(dateStr: string, slotStart: Date, slotEnd: Date) {
        const jsDow = new Date(`${dateStr}T12:00:00+03:00`).getDay();
        const bh = await this.bhRepo.findOne({ where: { weekday: jsDow } });
        if (!bh) throw new ForbiddenException('CLOSED_DAY');

        const workStart = new Date(`${dateStr}T${bh.open}:00+03:00`);
        const workEnd = new Date(`${dateStr}T${bh.close}:00+03:00`);
        if (slotStart < workStart || slotEnd > workEnd) {
            throw new ForbiddenException('OUT_OF_BUSINESS_HOURS');
        }
        return bh;
    }

    private ensureAlignedToInterval(slotStart: Date, bh: BusinessHour) {
        const interval = Number(bh.slotIntervalMinutes ?? 30);
        const minutes = slotStart.getMinutes();
        if (minutes % interval !== 0) {
            throw new BadRequestException('NOT_ALIGNED_TO_INTERVAL');
        }
    }

    async create(dto: CreateAppointmentDto) {
        // 1) שירות
        const service = await this.svcRepo.findOne({ where: { id: dto.serviceId } });
        if (!service) throw new NotFoundException('Service not found');

        // 2) start/end
        const startAt = this.parseLocalISO(dto.startsAtISO);
        if (Number.isNaN(startAt.getTime())) throw new BadRequestException('Invalid startsAt');
        const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000);

        // 3) לא להזמין לעבר
        this.ensureNotPast(startAt);

        // 4) שעות פעילות + אינטרוול
        const dateStr = startAt.toISOString().slice(0, 10);
        const bh = await this.ensureWithinBusinessHours(dateStr, startAt, endAt);
        this.ensureAlignedToInterval(startAt, bh);

        // 5) קליינט
        const phone = this.normalizePhone(dto.clientPhone);
        if (!phone) throw new BadRequestException('Phone required');

        let client = await this.clientRepo.findOne({ where: { phone } });

        if (!client) {
            const partial: DeepPartial<Client> = {
                phone,
                firstName: (dto.clientFirstName || '').trim(),
                lastName: (dto.clientLastName || '').trim(),
            };
            if (!partial.firstName || !partial.lastName) {
                throw new BadRequestException('NAME_REQUIRED');
            }
            client = this.clientRepo.create(partial);
            client = await this.clientRepo.save(client);
        } else {
            const needSave =
                (!client.firstName || !client.firstName.trim()) ||
                (!client.lastName || !client.lastName.trim());
            if (needSave) {
                client.firstName = client.firstName && client.firstName.trim() ? client.firstName : (dto.clientFirstName || '').trim();
                client.lastName = client.lastName && client.lastName.trim() ? client.lastName : (dto.clientLastName || '').trim();
                if (!client.firstName || !client.lastName) {
                    throw new BadRequestException('NAME_REQUIRED');
                }
                await this.clientRepo.save(client);
            }
        }

        // 6) חפיפות
        const hasApptOverlap = await this.apptRepo.exist({
            where: { startsAt: LessThan(endAt), endsAt: MoreThan(startAt) },
        });
        if (hasApptOverlap) throw new ConflictException('Slot overlaps with another appointment');

        const hasBlockOverlap = await this.blockRepo.exist({
            where: { startsAt: LessThan(endAt), endsAt: MoreThan(startAt) },
        });
        if (hasBlockOverlap) throw new ConflictException('Slot is blocked');

        // 7) יצירה
        const appt = this.apptRepo.create({
            client,
            service,
            startsAt: startAt,
            endsAt: endAt, // יש לך nullable: true בטבלה, אבל אנחנו ממלאים ערך
            // note: dto.note ?? null,
        });

        return this.apptRepo.save(appt);
    }

    async getAvailableSlots(serviceId: string, dateStr: string): Promise<string[]> {
        const service = await this.svcRepo.findOne({ where: { id: serviceId } });
        if (!service) throw new NotFoundException('Service not found');

        const dayLocalStart = new Date(`${dateStr}T00:00:00+03:00`);
        const dayLocalEnd = new Date(`${dateStr}T23:59:59+03:00`);

        const jsDow = new Date(`${dateStr}T12:00:00+03:00`).getDay();
        const bh = await this.bhRepo.findOne({ where: { weekday: jsDow } });
        if (!bh) return [];

        const interval = Number(bh.slotIntervalMinutes ?? 30);
        const workStart = new Date(`${dateStr}T${bh.open}:00+03:00`);
        const workEnd = new Date(`${dateStr}T${bh.close}:00+03:00`);

        const appts = await this.apptRepo.find({
            where: {
                startsAt: LessThanOrEqual(dayLocalEnd),
                endsAt: MoreThanOrEqual(dayLocalStart),
            },
            order: { startsAt: 'ASC' },
        });

        const blocks = await this.blockRepo.find({
            where: {
                startsAt: LessThanOrEqual(dayLocalEnd),
                endsAt: MoreThanOrEqual(dayLocalStart),
            },
            order: { startsAt: 'ASC' },
        });

        const slots: string[] = [];
        for (
            let t = new Date(workStart);
            t.getTime() + service.durationMinutes * 60000 <= workEnd.getTime();
            t = new Date(t.getTime() + interval * 60000)
        ) {
            const slotStart = t;
            const slotEnd = new Date(t.getTime() + service.durationMinutes * 60000);

            const overlapsAppt = appts.some(a => !(slotEnd <= a.startsAt || slotStart >= a.endsAt));
            const overlapsBlock = blocks.some(b => !(slotEnd <= b.startsAt || slotStart >= b.endsAt));

            if (!overlapsAppt && !overlapsBlock) {
                const hh = String(slotStart.getHours()).padStart(2, '0');
                const mm = String(slotStart.getMinutes()).padStart(2, '0');
                slots.push(`${hh}:${mm}`);
            }
        }

        // לא להציע עבר ביום הנוכחי
        const now = new Date();
        if (now.toISOString().slice(0, 10) === dateStr) {
            const nowHH = now.getHours();
            const nowMM = now.getMinutes();
            return slots.filter(s => {
                const [h, m] = s.split(':').map(Number);
                return h > nowHH || (h === nowHH && m > nowMM);
            });
        }

        return slots;
    }

    async getMyAppointmentsByPhone(phoneRaw: string) {
        const norm = this.normalizePhone(phoneRaw);
        return this.apptRepo.find({
            where: { client: { phone: norm } as any },
            order: { startsAt: 'DESC' },
        });
    }
}
