import {
    Injectable,
    ConflictException,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
    Repository,
    DataSource,
    LessThan,
    MoreThan,
    MoreThanOrEqual,
    LessThanOrEqual,
    DeepPartial,
    QueryFailedError,
} from 'typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { Client } from '../../clients/client.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { BusinessHour } from '../../entities/business-hour.entity';
import { BusinessHoursOverride } from '../../entities/business-hours-override.entity';
import { Setting } from '../../entities/setting.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { AdminPushService } from '../push/admin-push.service';

import { DateTime } from 'luxon';
const TZ = 'Asia/Jerusalem';

export interface CreateAppointmentDto {
    clientPhone: string;
    clientFirstName: string;
    clientLastName: string;
    serviceId: string;
    startsAtISO: string;
    note?: string;
    requestId?: string;
}

interface BookingRules {
    publicMaxAdvanceDays: number;
    memberMaxAdvanceDays: number;
    memberOnlyServiceIds: string[];
    memberOnlyWindows: MemberWindow[];
    memberSpecificWindows: SpecificMemberWindow[];
}

interface MemberWindow {
    weekday: number;
    start: string;
    end: string;
}

interface SpecificMemberWindow {
    date: string;
    start: string;
    end: string;
}


interface AdminUpdateEvent {
    type: 'login' | 'visit_no_booking' | 'booking';
    message: string;
    color: 'neutral' | 'red' | 'green';
    clientName: string;
    clientId?: number;
    createdAt: string;
    appointment?: {
        startsAt?: string;
        serviceName?: string;
    };
}

const DEFAULT_BOOKING_RULES: BookingRules = {
    publicMaxAdvanceDays: 7,
    memberMaxAdvanceDays: 14,
    memberOnlyServiceIds: [],
    memberOnlyWindows: [],
    memberSpecificWindows: [],
};

@Injectable()
export class AppointmentsService {
    private readonly logger = new Logger(AppointmentsService.name);

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
        @InjectRepository(ServiceEntity) private readonly svcRepo: Repository<ServiceEntity>,
        @InjectRepository(Client) private readonly clientRepo: Repository<Client>,
        @InjectRepository(BlockedTime) private readonly blockRepo: Repository<BlockedTime>,
        @InjectRepository(BusinessHour) private readonly bhRepo: Repository<BusinessHour>,
        @InjectRepository(BusinessHoursOverride) private readonly bhOverrideRepo: Repository<BusinessHoursOverride>,
        @InjectRepository(Setting) private readonly settingsRepo: Repository<Setting>,
        private readonly whatsappService: WhatsAppService,
        private readonly adminPushService: AdminPushService,
    ) {}

    private async withDateLock<T>(dateStr: string, task: () => Promise<T>): Promise<T> {
        const lockKey = `booking-day:${dateStr}`;
        return this.dataSource.transaction(async (manager) => {
            await manager.query('select pg_advisory_xact_lock(hashtext($1))', [lockKey]);
            return task();
        });
    }

    private clampAdvanceDays(value: any, fallback: number): number {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        const intVal = Math.floor(num);
        if (intVal < 1) return 1;
        if (intVal > 30) return 30;
        return intVal;
    }

    private normalizeTime(value: any): string | null {
        if (value === undefined || value === null) return null;
        const str = String(value).trim();
        const match = /^(\d{1,2}):(\d{2})$/.exec(str);
        if (!match) return null;
        let hours = Number(match[1]);
        let minutes = Number(match[2]);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
        if (hours < 0) hours = 0;
        if (hours > 23) hours = 23;
        if (minutes < 0) minutes = 0;
        if (minutes > 59) minutes = 59;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    private normalizeDate(value: any): string | null {
        if (value === undefined || value === null) return null;
        const str = String(value).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const parsed = new Date(str);
        if (!Number.isFinite(parsed.getTime())) return null;
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    private isFutureSpecificWindow(date: string, endTime: string): boolean {
        const end = new Date(`${date}T${endTime}:00${this.israelOffsetForDate(date)}`);
        return Number.isFinite(end.getTime()) && end.getTime() > Date.now();
    }

    private normalizeSpecificMemberWindows(candidate: any): SpecificMemberWindow[] {
        const windows: SpecificMemberWindow[] = [];
        const seen = new Set<string>();

        const pushWindow = (date: any, start: any, end: any) => {
            const dateNorm = this.normalizeDate(date);
            const startNorm = this.normalizeTime(start);
            const endNorm = this.normalizeTime(end);
            if (!dateNorm || !startNorm || !endNorm) return;
            const startMinutes = parseInt(startNorm.slice(0, 2), 10) * 60 + parseInt(startNorm.slice(3), 10);
            const endMinutes = parseInt(endNorm.slice(0, 2), 10) * 60 + parseInt(endNorm.slice(3), 10);
            if (endMinutes <= startMinutes || !this.isFutureSpecificWindow(dateNorm, endNorm)) return;
            const key = `${dateNorm}|${startNorm}|${endNorm}`;
            if (seen.has(key)) return;
            seen.add(key);
            windows.push({ date: dateNorm, start: startNorm, end: endNorm });
        };

        const explore = (value: any, fallbackDate?: string) => {
            if (!value) return;
            if (Array.isArray(value)) {
                value.forEach((entry) => explore(entry, fallbackDate));
                return;
            }
            if (typeof value === 'object') {
                const date = value.date ?? value.day ?? value.fullDate ?? value.ymd ?? fallbackDate;
                const start = value.start ?? value.from ?? value.open ?? value.start_time ?? value.startTime;
                const end = value.end ?? value.to ?? value.close ?? value.end_time ?? value.endTime;
                if (date !== undefined || (start !== undefined && end !== undefined)) {
                    pushWindow(date, start, end);
                    return;
                }
                Object.entries(value).forEach(([maybeDate, nested]) => {
                    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(maybeDate) ? maybeDate : fallbackDate;
                    explore(nested, parsedDate);
                });
            }
        };

        explore(candidate);

        windows.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.start.localeCompare(b.start);
        });

        return windows;
    }

    private normalizeMemberWindows(candidate: any): MemberWindow[] {
        const windows: MemberWindow[] = [];
        const seen = new Set<string>();

        const pushWindow = (weekday: any, start: any, end: any) => {
            if (weekday === undefined || weekday === null) return;
            const day = Number(weekday);
            if (!Number.isInteger(day) || day < 0 || day > 6) return;
            const startNorm = this.normalizeTime(start);
            const endNorm = this.normalizeTime(end);
            if (!startNorm || !endNorm) return;
            const startMinutes = parseInt(startNorm.slice(0, 2), 10) * 60 + parseInt(startNorm.slice(3), 10);
            const endMinutes = parseInt(endNorm.slice(0, 2), 10) * 60 + parseInt(endNorm.slice(3), 10);
            if (endMinutes <= startMinutes) return;
            const key = `${day}|${startNorm}|${endNorm}`;
            if (seen.has(key)) return;
            seen.add(key);
            windows.push({ weekday: day, start: startNorm, end: endNorm });
        };

        const explore = (value: any, fallbackDay?: number) => {
            if (!value) return;
            if (Array.isArray(value)) {
                value.forEach(entry => explore(entry, fallbackDay));
                return;
            }
            if (typeof value === 'object') {
                const day = value.weekday ?? value.day ?? value.day_of_week ?? fallbackDay;
                const start = value.start ?? value.from ?? value.open ?? value.start_time ?? value.startTime;
                const end = value.end ?? value.to ?? value.close ?? value.end_time ?? value.endTime;
                if (day !== undefined || (start !== undefined && end !== undefined)) {
                    pushWindow(day, start, end);
                    return;
                }
                Object.entries(value).forEach(([maybeDay, nested]) => {
                    const parsedDay = Number.isNaN(Number(maybeDay)) ? fallbackDay : Number(maybeDay);
                    explore(nested, parsedDay);
                });
            }
        };

        explore(candidate);

        windows.sort((a, b) => {
            if (a.weekday !== b.weekday) return a.weekday - b.weekday;
            return a.start.localeCompare(b.start);
        });

        return windows;
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
        const windowCandidate =
            source.memberOnlyWindows ??
            source.member_only_windows ??
            source.memberWindows ??
            source.member_windows ??
            [];
        const specificWindowCandidate =
            source.memberSpecificWindows ??
            source.member_specific_windows ??
            source.specificMemberWindows ??
            source.specific_member_windows ??
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
        const windows = this.normalizeMemberWindows(windowCandidate);
        const specificWindows = this.normalizeSpecificMemberWindows(specificWindowCandidate);

        return {
            publicMaxAdvanceDays,
            memberMaxAdvanceDays,
            memberOnlyServiceIds: ids,
            memberOnlyWindows: windows,
            memberSpecificWindows: specificWindows,
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
        if (!isoLike) return new Date(NaN);

        // אם הגיע עם offset או Z – נקבל אותו כמו שהוא
        if (/Z$|[+-]\d\d:\d\d$/.test(isoLike)) return new Date(isoLike);

        // אם הגיע בלי אזור זמן (למשל "2026-01-04T19:00:00") – נפרש כישראל
        const dt = DateTime.fromISO(isoLike, { zone: TZ });
        return dt.toJSDate();
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

    private async getBusinessHoursForDate(dateStr: string) {
        const offset = this.israelOffsetForDate(dateStr);
        const jsDow = new Date(`${dateStr}T12:00:00${offset}`).getDay();
        const bh = await this.bhRepo.findOne({ where: { weekday: jsDow } });
        const override = await this.bhOverrideRepo.findOne({ where: { date: dateStr } });
        const effective = override
            ? {
                ...bh,
                open: override.open,
                close: override.close,
                slotIntervalMinutes: override.slotIntervalMinutes,
            }
            : bh;
        return { bh: effective, offset, jsDow };
    }

    private buildMemberWindowsForDate(
        dateStr: string,
        rules: BookingRules,
        offset: string,
        jsDow: number,
        baseWindow?: { start: Date; end: Date } | null,
    ) {
        const weeklyWindows = (rules.memberOnlyWindows || [])
            .filter(win => Number(win.weekday) === Number(jsDow))
            .map(win => ({
                start: new Date(`${dateStr}T${win.start}:00${offset}`),
                end: new Date(`${dateStr}T${win.end}:00${offset}`),
            }));

        const specificWindows = (rules.memberSpecificWindows || [])
            .filter(win => win.date === dateStr)
            .map(win => ({
                start: new Date(`${dateStr}T${win.start}:00${offset}`),
                end: new Date(`${dateStr}T${win.end}:00${offset}`),
            }));

        return [...weeklyWindows, ...specificWindows]
            .map(win => this.intersectWindow(win, baseWindow))
            .filter((win): win is { start: Date; end: Date } => Boolean(win));
    }

    private intersectWindow(
        window: { start: Date; end: Date },
        baseWindow?: { start: Date; end: Date } | null,
    ): { start: Date; end: Date } | null {
        if (
            !Number.isFinite(window.start.getTime()) ||
            !Number.isFinite(window.end.getTime()) ||
            window.end <= window.start
        ) {
            return null;
        }

        if (!baseWindow) {
            return window;
        }

        if (
            !Number.isFinite(baseWindow.start.getTime()) ||
            !Number.isFinite(baseWindow.end.getTime()) ||
            baseWindow.end <= baseWindow.start
        ) {
            return null;
        }

        const start = new Date(Math.max(window.start.getTime(), baseWindow.start.getTime()));
        const end = new Date(Math.min(window.end.getTime(), baseWindow.end.getTime()));

        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
            return null;
        }

        return { start, end };
    }

    private isSlotWithinWindow(slotStart: Date, slotEnd: Date, window: { start: Date; end: Date }): boolean {
        return slotStart >= window.start && slotEnd <= window.end;
    }

    private ensureAlignedToInterval(slotStart: Date, interval: number) {
        const step = Number(interval ?? 30) || 30;
        const minutes = slotStart.getMinutes();
        if (minutes % step !== 0) {
            throw new BadRequestException('NOT_ALIGNED_TO_INTERVAL');
        }
    }

    async create(dto: CreateAppointmentDto, options: { bypassMemberRestrictions?: boolean } = {}) {
        const startAt = this.parseLocalISO(dto.startsAtISO);
        if (Number.isNaN(startAt.getTime())) throw new BadRequestException('Invalid startsAt');
        const dateStr = DateTime.fromJSDate(startAt).setZone(TZ).toFormat('yyyy-LL-dd');

        return this.withDateLock(dateStr, async () => {
        // 1) שירות
        const service = await this.svcRepo.findOne({ where: { id: dto.serviceId } });
        if (!service) throw new NotFoundException('Service not found');

        // 2) start/end
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

        const bypassMemberRestrictions = Boolean(options.bypassMemberRestrictions);

        if (!bypassMemberRestrictions) {
            this.ensureServiceAllowedForClient(service, isMember, bookingRules);
            this.ensureWithinAdvanceWindow(startAt, isMember, bookingRules);
        }

        // 5) שעות פעילות + אינטרוול
        const { bh, offset, jsDow } = await this.getBusinessHoursForDate(dateStr);
        const interval = Number(bh?.slotIntervalMinutes ?? 30) || 30;
        const openStr = String(bh?.open ?? '').trim();
        const closeStr = String(bh?.close ?? '').trim();
        const hasBaseConfig = Boolean(openStr && closeStr && openStr !== closeStr);
        const baseWindow = hasBaseConfig
            ? {
                start: new Date(`${dateStr}T${openStr}:00${offset}`),
                end: new Date(`${dateStr}T${closeStr}:00${offset}`),
            }
            : null;
        const memberWindows = this.buildMemberWindowsForDate(dateStr, bookingRules, offset, jsDow, baseWindow);
        const isInMemberWindow = memberWindows.some(win => this.isSlotWithinWindow(startAt, endAt, win));
        const isInBaseWindow = baseWindow ? this.isSlotWithinWindow(startAt, endAt, baseWindow) : false;
        const hasBaseWindow = Boolean(
            baseWindow &&
            Number.isFinite(baseWindow.start.getTime()) &&
            Number.isFinite(baseWindow.end.getTime()) &&
            baseWindow.end > baseWindow.start,
        );
        const hasMemberWindow = memberWindows.length > 0;

        if (!hasBaseWindow && !hasMemberWindow) {
            throw new ForbiddenException('CLOSED_DAY');
        }

        if (!bypassMemberRestrictions && !isMember && isInMemberWindow) {
            throw new ForbiddenException('MEMBERS_ONLY_WINDOW');
        }

        if (!isInBaseWindow && !isInMemberWindow) {
            if (!hasBaseWindow && hasMemberWindow && !bypassMemberRestrictions) {
                throw new ForbiddenException('MEMBERS_ONLY_WINDOW');
            }
            throw new ForbiddenException({
                code: 'OUT_OF_BUSINESS_HOURS',
                message: 'השעות עודכנו ממש עכשיו, ולכן התור שבחרת כבר לא נמצא בתוך שעות הפעילות.',
                suggestedAction: 'RESELECT_SLOT',
            });
        }

        this.ensureAlignedToInterval(startAt, interval);

        // 6) חפיפות
        const hasApptOverlap = await this.apptRepo.exist({
            where: { startsAt: LessThan(endAt), endsAt: MoreThan(startAt) },
        });
        if (hasApptOverlap) {
            throw new ConflictException({
                error: 'SLOT_TAKEN',
                message: 'This slot was just booked. Please choose another time.',
                suggestedAction: 'RESELECT_SLOT',
            });
        }

        const overlappingBlocks = await this.blockRepo.find({
            where: { startsAt: LessThan(endAt), endsAt: MoreThan(startAt) },
        });
        const blocking = overlappingBlocks.some(block => !block.membersOnly || !(isMember || bypassMemberRestrictions));
        if (blocking) throw new ConflictException('Slot is blocked');

        // 7) יצירה
        const appt = this.apptRepo.create({
            client,
            service,
            startsAt: startAt,
            endsAt: endAt, // יש לך nullable: true בטבלה, אבל אנחנו ממלאים ערך
            // note: dto.note ?? null,
        });

        let saved: Appointment;
        try {
            saved = await this.apptRepo.save(appt);
        } catch (error) {
            if (error instanceof QueryFailedError && this.isSlotTakenDbError(error)) {
                this.logger.warn(
                    JSON.stringify({
                        event: 'appointment_booking_conflict',
                        conflict: true,
                        requestId: dto.requestId ?? null,
                        phone,
                        service_id: service.id,
                        starts_at: startAt.toISOString(),
                    }),
                );
                throw new ConflictException({
                    error: 'SLOT_TAKEN',
                    message: 'This slot was just booked. Please choose another time.',
                    suggestedAction: 'RESELECT_SLOT',
                });
            }
            throw error;
        }

        await this.clearPendingNoBookingForClient((saved.client as any)?.id);
        await this.appendBookingAdminUpdate(saved);

        try {
            await this.whatsappService.sendAppointmentConfirmed(saved);
        } catch (error) {
            // לא מפיל את הבקשה אם שליחת WA נכשלת
            console.warn('WhatsApp send failed (appointment_approved).');
        }
        return saved;
        });
    }


    private async clearPendingNoBookingForClient(clientId: number | string | undefined) {
        const id = Number(clientId);
        if (!Number.isFinite(id) || id <= 0) return;
        const key = 'admin.updates.pending_no_booking';
        const row = await this.settingsRepo.findOne({ where: { key } });
        if (!row || !Array.isArray(row.value)) return;
        const next = row.value.filter((item: any) => Number(item?.clientId) !== id);
        if (next.length === row.value.length) return;
        row.value = next;
        await this.settingsRepo.save(row);
    }

    private async appendBookingAdminUpdate(appointment: Appointment) {
        const key = 'admin.updates.feed';
        const apptClient: any = appointment.client as any;
        const firstName = String(apptClient?.firstName ?? apptClient?.first_name ?? '').trim();
        const lastName = String(apptClient?.lastName ?? apptClient?.last_name ?? '').trim();
        const clientName = `${firstName} ${lastName}`.trim() || String(apptClient?.phone || 'לקוח לא ידוע');
        const serviceName = String((appointment.service as any)?.name ?? 'שירות');
        const startsAtIso = appointment.startsAt instanceof Date
            ? appointment.startsAt.toISOString()
            : new Date(appointment.startsAt as any).toISOString();
        const startsAtDisplay = this.formatBookingDisplayDate(startsAtIso);

        const event: AdminUpdateEvent = {
            type: 'booking',
            message: `${clientName} קבע תור חדש (${serviceName} - ${startsAtDisplay})`,
            color: 'green',
            clientName,
            clientId: Number(apptClient?.id),
            createdAt: new Date().toISOString(),
            appointment: {
                startsAt: startsAtIso,
                serviceName,
            },
        };

        const existing = await this.settingsRepo.findOne({ where: { key } });
        const current = Array.isArray(existing?.value) ? existing.value : [];
        const next = [event, ...current].slice(0, 300);
        if (existing) {
            existing.value = next;
            await this.settingsRepo.save(existing);
        } else {
            await this.settingsRepo.save(this.settingsRepo.create({ key, value: next }));
        }

        const appointmentDate = startsAtIso.slice(0, 10);

        await this.adminPushService.sendAdminUpdateNotification({
            title: 'תור חדש',
            body: String(event.message || 'יש עדכון חדש במערכת').slice(0, 180),
            url: `/Admin?notificationTarget=appointment&date=${encodeURIComponent(appointmentDate)}`,
        });
    }

    private formatBookingDisplayDate(iso: string): string {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return String(iso || '');

        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jerusalem',
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(date);

        const dd = parts.find((part) => part.type === 'day')?.value ?? '00';
        const mm = parts.find((part) => part.type === 'month')?.value ?? '00';
        const yy = parts.find((part) => part.type === 'year')?.value ?? '00';
        const hh = parts.find((part) => part.type === 'hour')?.value ?? '00';
        const min = parts.find((part) => part.type === 'minute')?.value ?? '00';

        return `${dd}/${mm}/${yy} בשעה ${hh}:${min}`;
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

    async getAvailableSlots(
        serviceId: string,
        dateStr: string,
        opts: { isMember?: boolean } = {},
    ): Promise<Array<{ hhmm: string; memberOnly: boolean }>> {
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
        const visibilityMaxDays = Math.max(
            Number(bookingRules.publicMaxAdvanceDays ?? 0),
            Number(bookingRules.memberMaxAdvanceDays ?? 0),
        );
        if (diffDays > visibilityMaxDays) {
            return [];
        }

        const { bh: effective, offset, jsDow } = await this.getBusinessHoursForDate(dateStr);
        const dayLocalStart = new Date(`${dateStr}T00:00:00${offset}`);
        const dayLocalEnd = new Date(`${dateStr}T23:59:59${offset}`);
        const interval = Number(effective?.slotIntervalMinutes ?? 30) || 30;
        const openStr = String(effective?.open ?? '').trim();
        const closeStr = String(effective?.close ?? '').trim();
        const hasBaseWindow = Boolean(openStr && closeStr && openStr !== closeStr);
        const workStart = hasBaseWindow ? new Date(`${dateStr}T${openStr}:00${offset}`) : null;
        const workEnd = hasBaseWindow ? new Date(`${dateStr}T${closeStr}:00${offset}`) : null;
        const baseWindow = hasBaseWindow && workStart && workEnd ? { start: workStart, end: workEnd } : null;
        const memberWindows = this.buildMemberWindowsForDate(dateStr, bookingRules, offset, jsDow, baseWindow);
        if (!baseWindow && memberWindows.length === 0) return [];

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

        const slots: Array<{ hhmm: string; memberOnly: boolean }> = [];
        const fmtTime = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jerusalem',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });

        const durationMs = service.durationMinutes * 60000;
        const addSlotsForWindow = (window: { start: Date; end: Date }, memberOnly: boolean) => {
            for (
                let t = new Date(window.start);
                t.getTime() + durationMs <= window.end.getTime();
                t = new Date(t.getTime() + interval * 60000)
            ) {
                const slotStart = new Date(t);
                const slotEnd = new Date(t.getTime() + durationMs);
                if (!Number.isFinite(slotStart.getTime()) || !Number.isFinite(slotEnd.getTime())) continue;

                if (!memberOnly) {
                    const overlapsMemberWindow = memberWindows.some(win => this.isSlotWithinWindow(slotStart, slotEnd, win));
                    if (overlapsMemberWindow) continue;
                }

                const overlapsAppt = appts.some(a => !(slotEnd <= a.startsAt || slotStart >= a.endsAt));
                const overlapsBlock = relevantBlocks.some(b => !(slotEnd <= b.startsAt || slotStart >= b.endsAt));
                if (!overlapsAppt && !overlapsBlock) {
                    slots.push({ hhmm: fmtTime.format(slotStart), memberOnly });
                }
            }
        };

        if (hasBaseWindow && workStart && workEnd && workEnd.getTime() > workStart.getTime()) {
            addSlotsForWindow({ start: workStart, end: workEnd }, false);
        }

        if (memberWindows.length > 0) {
            memberWindows.forEach(win => addSlotsForWindow(win, true));
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
            return slots.filter(s => s.hhmm > nowTime);
        }

        const unique = new Map<string, { hhmm: string; memberOnly: boolean }>();
        for (const slot of slots) {
            const key = `${slot.hhmm}-${slot.memberOnly ? 'member' : 'public'}`;
            if (!unique.has(key)) unique.set(key, slot);
        }
        return Array.from(unique.values()).sort((a, b) => a.hhmm.localeCompare(b.hhmm));
    }

    async getOccupiedSlots(
        serviceId: string | undefined,
        dateStr: string,
    ): Promise<Array<{ time: string; startsAt: Date; endsAt: Date | null }>> {
        const dayStart = DateTime.fromISO(dateStr, { zone: TZ }).startOf('day').toUTC().toJSDate();
        const dayEnd = DateTime.fromISO(dateStr, { zone: TZ }).endOf('day').toUTC().toJSDate();

        const service = serviceId
            ? await this.svcRepo.findOne({ where: { id: serviceId } })
            : null;
        if (serviceId && !service) throw new NotFoundException('Service not found');

        const appts = await this.apptRepo.find({
            where: {
                startsAt: LessThanOrEqual(dayEnd),
                endsAt: MoreThanOrEqual(dayStart),
                ...(serviceId ? { service: { id: serviceId } as any } : {}),
            },
            order: { startsAt: 'ASC' },
            relations: ['client', 'service'],
        });

        const blocks = await this.blockRepo.find({
            where: {
                startsAt: LessThanOrEqual(dayEnd),
                endsAt: MoreThanOrEqual(dayStart),
            },
        });

        const fmtTime = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jerusalem',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });

        const blockedOverlaps = (start: Date, end: Date) =>
            blocks.some(block => !(end <= block.startsAt || start >= block.endsAt));

        const slots = appts
            .map(appt => {
                const start = appt.startsAt;
                const durationMinutes =
                    appt.service?.durationMinutes ?? service?.durationMinutes ?? 0;
                const end =
                    appt.endsAt ?? new Date(appt.startsAt.getTime() + durationMinutes * 60000);
                return { start, end };
            })
            .filter(({ start, end }) => !blockedOverlaps(start, end))
            .map(({ start, end }) => ({
                time: fmtTime.format(start),
                startsAt: start,
                endsAt: end,
            }));

        const unique = new Map<string, { time: string; startsAt: Date; endsAt: Date | null }>();
        for (const slot of slots) {
            if (!unique.has(slot.time)) unique.set(slot.time, slot);
        }
        return Array.from(unique.values()).sort((a, b) => a.time.localeCompare(b.time));
    }

    async getMyAppointmentsByPhone(phoneRaw: string) {
        const norm = this.normalizePhone(phoneRaw);
        return this.apptRepo.find({
            where: { client: { phone: norm } as any },
            relations: {
                client: true,
                service: true,
            },
            order: { startsAt: 'DESC' },
        });
    }
    private isSlotTakenDbError(error: QueryFailedError): boolean {
        const driverError: any = (error as any)?.driverError ?? {};
        const code = String(driverError?.code ?? '');
        const constraint = String(driverError?.constraint ?? '');
        return code === '23P01' || constraint === 'appointments_no_overlap_active';
    }

}
