import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminPushSubscription } from '../../entities/admin-push-subscription.entity';
import { Setting } from '../../entities/setting.entity';
import { AdminPushService } from './admin-push.service';
import { AdminPushController } from './admin-push.controller';

@Module({
    imports: [TypeOrmModule.forFeature([AdminPushSubscription, Setting])],
    providers: [AdminPushService],
    controllers: [AdminPushController],
    exports: [AdminPushService],
})
export class AdminPushModule {}
