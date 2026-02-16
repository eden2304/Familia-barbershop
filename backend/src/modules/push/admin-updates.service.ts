import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';
import { PushService } from './push.service';

export interface AdminUpdateEvent {
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

@Injectable()
export class AdminUpdatesService {
    private readonly adminUpdatesFeedKey = 'admin.updates.feed';

    constructor(
        @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
        private readonly pushService: PushService,
    ) {}

    async append(event: AdminUpdateEvent) {
        const existing = await this.settingRepo.findOne({ where: { key: this.adminUpdatesFeedKey } });
        const current = Array.isArray(existing?.value) ? existing.value : [];
        const next = [event, ...current].slice(0, 300);
        if (existing) {
            existing.value = next;
            await this.settingRepo.save(existing);
        } else {
            await this.settingRepo.save(this.settingRepo.create({ key: this.adminUpdatesFeedKey, value: next }));
        }
        await this.pushService.sendAdminUpdatePush(event.message);
    }
}
