import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WaitingList } from '../../entities/waiting-list.entity';
import { Client } from '../../clients/client.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { Appointment } from '../../entities/appointment.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { WaitingListController } from './waiting-list.controller';
import { WaitingListService } from './waiting-list.service';

@Module({
    imports: [TypeOrmModule.forFeature([WaitingList, Client, ServiceEntity, Appointment, BlockedTime])],
    controllers: [WaitingListController],
    providers: [WaitingListService],
})
export class WaitingListModule {}
