import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { ServiceEntity } from '../../entities/service.entity';
import { Client } from '../../clients/client.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { BusinessHour } from '../../entities/business-hour.entity';
import { WaitingList } from '../../entities/waiting-list.entity';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { ClientsController } from './clients.controller';
import { Setting } from '../../entities/setting.entity';
import { AuthModule } from '../auth/auth.module';
import { WaitingListController } from './waiting-list.controller';

@Module({
    imports: [TypeOrmModule.forFeature([Appointment, ServiceEntity, Client, BlockedTime, BusinessHour, WaitingList, Setting]), AuthModule],
    providers: [AppointmentsService],
    controllers: [AppointmentsController, ClientsController, WaitingListController],
})
export class AppointmentsModule {}
