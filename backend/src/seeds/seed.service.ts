import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceEntity } from '../entities/service.entity';
import { BusinessHour } from '../entities/business-hour.entity';
import { AdminPhone } from '../entities/admin-phone.entity';

@Injectable()
export class SeedService implements OnModuleInit {
    constructor(
        @InjectRepository(ServiceEntity) private readonly svcRepo: Repository<ServiceEntity>,
        @InjectRepository(BusinessHour)  private readonly bhRepo:  Repository<BusinessHour>,
        @InjectRepository(AdminPhone)    private readonly adminRepo: Repository<AdminPhone>,
    ) {}

    async onModuleInit() {
        if (process.env.SEED !== 'true') return;

        // Services (אם ריק)
        if (await this.svcRepo.count() === 0) {
            await this.svcRepo.save([
                this.svcRepo.create({ name: 'תספורת קלאסית', durationMinutes: 30, price: 70, orderIndex: 0, isActive: true }),
                this.svcRepo.create({ name: 'תספורת קלאסית חיילים בלבד', durationMinutes: 30, price: 50, orderIndex: 1, isActive: true }),
            ]);
        }

        // Business hours (א׳–ה׳ 10–19, ו׳ 8–15, ריווח 30 דק)
        if (await this.bhRepo.count() === 0) {
            const days = [
                { weekday: 0, open: '10:00', close: '19:00' },
                { weekday: 1, open: '10:00', close: '19:00' },
                { weekday: 2, open: '10:00', close: '19:00' },
                { weekday: 3, open: '10:00', close: '19:00' },
                { weekday: 4, open: '10:00', close: '19:00' },
                { weekday: 5, open: '08:00', close: '15:00' },
                // שבת (6) סגור
            ];
            await this.bhRepo.save(days.map(d => this.bhRepo.create({ ...d, slotIntervalMinutes: 30 })));
        }

        // Admin phones (ENV: ADMIN_PHONES=0537002171,0523767851)
        if (await this.adminRepo.count() === 0) {
            const phones = (process.env.ADMIN_PHONES || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            if (phones.length) {
                await this.adminRepo.save(phones.map(p => this.adminRepo.create({ phone: p })));
            }
        }

        // eslint-disable-next-line no-console
        console.log('[Seed] done');
    }
}
