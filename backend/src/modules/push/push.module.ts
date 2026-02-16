import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushSubscription } from '../../entities/push-subscription.entity';
import { AdminPhone } from '../../entities/admin-phone.entity';
import { Setting } from '../../entities/setting.entity';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { AdminUpdatesService } from './admin-updates.service';

@Module({
    imports: [TypeOrmModule.forFeature([PushSubscription, AdminPhone, Setting])],
    controllers: [PushController],
    providers: [PushService, AdminUpdatesService],
    exports: [PushService, AdminUpdatesService],
})
export class PushModule {}
