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
import { Setting } from '../../entities/setting.entity';

export interface CreateAppointmentDto {
    clientPhone: string;
    clientFirstName: string;
    clientLastName: string;
    serviceId: string;
    startsAtISO: string;
    note?: string;
}

interface BookingRules {
    publicMaxAdvanceDays: number;
    memberMaxAdvanceDays: number;
    memberOnlyServiceIds: string[];
}

const DEFAULT_BOOKING_RULES: BookingRules = {
    publicMaxAdvanceDays: 7,
    memberMaxAdvanceDays: 14,
    memberOnlyServiceIds: [],
};

@Injectable()
export class AppointmentsService {
    constructor(
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
        @InjectRepository(ServiceEntity) private readonly svcRepo: Repository<ServiceEntity>,
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        @InjectRepository(BlockedTime) private readonly blockRepo: Repository<BlockedTime>,
        @InjectRepository(BusinessHour) private readonly bhRepo: Repository<BusinessHour>,
        @InjectRepository(Setting) private readonly settingsRepo: Repository<Setting>,
    ) {}

    private clampAdvanceDays(value: any, fallback: number): number {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        const intVal = Math.floor(num);
        if (intVal < 0) return 0;
        if (intVal > 365) return 365;
        return intVal;
    }

    private normalizeBookingRules(raw: any): BookingRules {
        if (!raw || typeof raw !== 'object') {
            return { ...DEFAULT_BOOKING_RULES };
        }
        const source = raw as Record<string, any>;
        const publicCandidate =
            source.publicMaxAdvanceDays ??
            source.public ??
            source.publicDays ??
            source.public_days ??
            source.regular ??
            source.nonMember ??
            source.non_member;
        const memberCandidate =
            source.memberMaxAdvanceDays ??
            source.member ??
            source.members ??
            source.memberDays ??
            source.member_days ??
            source.vip ??
            source.memberAdvanceDays ??
            source.member_advance_days;
        const listCandidate =
            source.memberOnlyServiceIds ??
            source.membersOnlyServiceIds ??
            source.memberServices ??
            source.member_services ??
            source.member_only_services ??
            source.members_only_services ??
            [];

        const publicMaxAdvanceDays = this.clampAdvanceDays(publicCandidate, DEFAULT_BOOKING_RULES.publicMaxAdvanceDays);
        const memberMaxAdvanceDays = this.clampAdvanceDays(memberCandidate, DEFAULT_BOOKING_RULES.memberMaxAdvanceDays);
        const ids = Array.isArray(listCandidate)
            ? Array.from(
                  new Set(
                      listCandidate
                          .map(value => {
                              if (value === undefined || value === null) return null;
                              const str = String(value).trim();
                              return str.length > 0 ? str : null;
                          })
                          .filter((val): val is string => Boolean(val)),
                  ),
              )
            : [];

        return {
            publicMaxAdvanceDays,
            memberMaxAdvanceDays,
            memberOnlyServiceIds: ids,
        };
    }

    private async getBookingRules(): Promise<BookingRules> {
        const row = await this.settingsRepo.findOne({ where: { key: 'booking.rules' } });
        if (!row) return { ...DEFAULT_BOOKING_RULES };
        try {
            return this.normalizeBookingRules(row.value);
        } catch {
            return { ...DEFAULT_BOOKING_RULES };
        }
    }

    private isServiceAllowedForClient(service: ServiceEntity, isMember: boolean, rules: BookingRules): boolean {
        if (isMember) return true;
        const serviceId = String(service?.id ?? '').trim();
        if (!serviceId) return true;
        return !rules.memberOnlyServiceIds.includes(serviceId);
    }

    private ensureServiceAllowedForClient(service: ServiceEntity, isMember: boolean, rules: BookingRules) {
        if (!this.isServiceAllowedForClient(service, isMember, rules)) {
            throw new ForbiddenException('MEMBERS_ONLY_SERVICE');
        }
    }

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

    private ensureWithinAdvanceWindow(startAt: Date, isMember: boolean, rules: BookingRules) {
        const windowBase = new Date();
        const todayUTC = Date.UTC(windowBase.getFullYear(), windowBase.getMonth(), windowBase.getDate());
        const startIso = startAt.toISOString().slice(0, 10);
        const [y, m, d] = startIso.split('-').map(Number);
        const startUTC = Date.UTC(y, m - 1, d);
        const diffDays = Math.floor((startUTC - todayUTC) / 86_400_000);
        const maxDays = isMember ? rules.memberMaxAdvanceDays : rules.publicMaxAdvanceDays;
        if (diffDays > maxDays) {
            throw new ForbiddenException(isMember ? 'MEMBER_ADVANCE_LIMIT' : 'PUBLIC_ADVANCE_LIMIT');
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

        const bookingRules = await this.getBookingRules();

        // 4) קליינט
        const phone = this.normalizePhone(dto.clientPhone);
        if (!phone) throw new BadRequestException('Phone required');

        let client = await this.clientRepo.findOne({ where: { phone } });

        if (!client) {
            const firstName = (dto.clientFirstName || '').trim();
            const lastName = (dto.clientLastName || '').trim();
            if (!firstName || !lastName) {
                throw new BadRequestException('NAME_REQUIRED');
            }
            const partial: DeepPartial<Client> = {
                phone,
                first_name: firstName,
                last_name: lastName,
            } as any;
            (partial as any).firstName = firstName;
            (partial as any).lastName = lastName;
            client = this.clientRepo.create(partial);
            client = await this.clientRepo.save(client);
        } else {
            const clientAny = client as any;
            const needSave =
                (!clientAny.firstName || !String(clientAny.firstName).trim()) ||
                (!clientAny.lastName || !String(clientAny.lastName).trim());
            if (needSave) {
                const nextFirst = clientAny.firstName && String(clientAny.firstName).trim()
                    ? String(clientAny.firstName).trim()
                    : (dto.clientFirstName || '').trim();
                const nextLast = clientAny.lastName && String(clientAny.lastName).trim()
                    ? String(clientAny.lastName).trim()
                    : (dto.clientLastName || '').trim();
                if (!nextFirst || !nextLast) {
                    throw new BadRequestException('NAME_REQUIRED');
                }
                clientAny.firstName = nextFirst;
                clientAny.lastName = nextLast;
                client.first_name = nextFirst;
                client.last_name = nextLast;
                await this.clientRepo.save(client);
            }
        }

        const clientAny = client as any;
        const isMember = Boolean(clientAny?.isMember ?? clientAny?.is_member ?? false);

        this.ensureServiceAllowedForClient(service, isMember, bookingRules);
        this.ensureWithinAdvanceWindow(startAt, isMember, bookingRules);

        // 5) שעות פעילות + אינטרוול
        const dateStr = startAt.toISOString().slice(0, 10);
        const bh = await this.ensureWithinBusinessHours(dateStr, startAt, endAt);
        this.ensureAlignedToInterval(startAt, bh);

        // 6) חפיפות
        const hasApptOverlap = await this.apptRepo.exist({
            where: { startsAt: LessThan(endAt), endsAt: MoreThan(startAt) },
        });
        if (hasApptOverlap) throw new ConflictException('Slot overlaps with another appointment');

        const overlappingBlocks = await this.blockRepo.find({
            where: { startsAt: LessThan(endAt), endsAt: MoreThan(startAt) },
        });
        const blocking = overlappingBlocks.some(block => !block.membersOnly || !isMember);
        if (blocking) throw new ConflictException('Slot is blocked');

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

    private israelOffsetForDate(dateStr: string): string {
        const d = new Date(`${dateStr}T12:00:00Z`);
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Jerusalem',
            timeZoneName: 'shortOffset',
            hour: '2-digit',
            minute: '2-digit',
        }).formatToParts(d);

        const tz = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+2';
        const m = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
        if (!m) return '+02:00';

        const signHour = Number(m[1]);
        const sign = signHour >= 0 ? '+' : '-';
        const hh = String(Math.abs(signHour)).padStart(2, '0');
        const mm = String(m[2] ? Number(m[2]) : 0).padStart(2, '0');
        return `${sign}${hh}:${mm}`;
    }

    async getAvailableSlots(serviceId: string, dateStr: string, opts: { isMember?: boolean } = {}): Promise<string[]> {
        const service = await this.svcRepo.findOne({ where: { id: serviceId } });
        if (!service) throw new NotFoundException('Service not found');

        const isMember = Boolean(opts.isMember);
        const bookingRules = await this.getBookingRules();
        if (!this.isServiceAllowedForClient(service, isMember, bookingRules)) {
            return [];
        }

        const now = new Date();
        const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const [yearStr, monthStr, dayStr] = dateStr.split('-');
        const targetUTC = Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
        const diffDays = Math.floor((targetUTC - todayUTC) / 86_400_000);
        const maxDays = isMember ? bookingRules.memberMaxAdvanceDays : bookingRules.publicMaxAdvanceDays;
        if (diffDays > maxDays) {
            return [];
        }

        const offset = this.israelOffsetForDate(dateStr);

        const dayLocalStart = new Date(`${dateStr}T00:00:00${offset}`);
        const dayLocalEnd = new Date(`${dateStr}T23:59:59${offset}`);

        const jsDow = new Date(`${dateStr}T12:00:00${offset}`).getDay();
        const bh = await this.bhRepo.findOne({ where: { weekday: jsDow } });
        if (!bh) return [];

        const interval = Number(bh.slotIntervalMinutes ?? 30);

        const openStr = String(bh.open ?? '').trim();
        const closeStr = String(bh.close ?? '').trim();
        if (!openStr || !closeStr) return [];
        if (openStr === '00:00' && closeStr === '00:00') return [];

        const workStart = new Date(`${dateStr}T${openStr}:00${offset}`);
        const workEnd = new Date(`${dateStr}T${closeStr}:00${offset}`);
        if (!Number.isFinite(workStart.getTime()) || !Number.isFinite(workEnd.getTime())) return [];
        if (workEnd.getTime() <= workStart.getTime()) return [];

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
        const relevantBlocks = blocks.filter(b => !b.membersOnly || !isMember);

        const slots: string[] = [];
        const fmtTime = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jerusalem',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });

        for (
            let t = new Date(workStart);
            t.getTime() + service.durationMinutes * 60000 <= workEnd.getTime();
            t = new Date(t.getTime() + interval * 60000)
        ) {
            const slotStart = t;
            const slotEnd = new Date(t.getTime() + service.durationMinutes * 60000);

            const overlapsAppt = appts.some(a => !(slotEnd <= a.startsAt || slotStart >= a.endsAt));
            const overlapsBlock = relevantBlocks.some(b => !(slotEnd <= b.startsAt || slotStart >= b.endsAt));

            if (!overlapsAppt && !overlapsBlock) {
                slots.push(fmtTime.format(slotStart)); // ✅ תמיד HH:mm
            }
        }

        // לא להציע עבר ביום הנוכחי (לפי ישראל)
        const nowILDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jerusalem',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());

        if (nowILDate === dateStr) {
            const nowTime = fmtTime.format(new Date()); // "HH:mm"
            return slots.filter(s => s > nowTime);
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
