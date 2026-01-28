import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WaitingList } from '../../entities/waiting-list.entity';
import { Client } from '../../clients/client.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { WaitingListController } from './waiting-list.controller';

@Module({
    imports: [TypeOrmModule.forFeature([WaitingList, Client, ServiceEntity])],
    controllers: [WaitingListController],
})
export class WaitingListModule {}
