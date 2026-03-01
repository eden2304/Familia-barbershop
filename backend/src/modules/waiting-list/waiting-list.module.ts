import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WaitingList } from '../../entities/waiting-list.entity';
import { Client } from '../../clients/client.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { Appointment } from '../../entities/appointment.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { Setting } from '../../entities/setting.entity';
import { WaitingListController } from './waiting-list.controller';
import { WaitingListService } from './waiting-list.service';
import { AuthModule } from '../auth/auth.module';
import { AdminPushModule } from '../push/admin-push.module';

@Module({
    imports: [TypeOrmModule.forFeature([WaitingList, Client, ServiceEntity, Appointment, BlockedTime, Setting]), AuthModule, AdminPushModule],
    controllers: [WaitingListController],
    providers: [WaitingListService],
})
export class WaitingListModule {}
