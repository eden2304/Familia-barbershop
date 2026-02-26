import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminPushSubscription } from '../../entities/admin-push-subscription.entity';
import { AdminPushService } from './admin-push.service';
import { AdminPushController } from './admin-push.controller';

@Module({
    imports: [TypeOrmModule.forFeature([AdminPushSubscription])],
    providers: [AdminPushService],
    controllers: [AdminPushController],
    exports: [AdminPushService],
})
export class AdminPushModule {}
