import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WaitingListEntry } from '../../entities/waiting-list.entity';
import { Client } from '../../clients/client.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { WaitingListService } from './waiting-list.service';
import { WaitingListController } from './waiting-list.controller';
import { WaitingListAdminController } from './waiting-list.admin.controller';

@Module({
    imports: [TypeOrmModule.forFeature([WaitingListEntry, Client, ServiceEntity])],
    controllers: [WaitingListController, WaitingListAdminController],
    providers: [WaitingListService],
})
export class WaitingListModule {}
