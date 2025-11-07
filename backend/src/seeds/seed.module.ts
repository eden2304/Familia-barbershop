import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceEntity } from '../entities/service.entity';
import { BusinessHour } from '../entities/business-hour.entity';
import { AdminPhone } from '../entities/admin-phone.entity';
import { SeedService } from './seed.service';

@Module({
    imports: [TypeOrmModule.forFeature([ServiceEntity, BusinessHour, AdminPhone])],
    providers: [SeedService],
})
export class SeedModule {}
