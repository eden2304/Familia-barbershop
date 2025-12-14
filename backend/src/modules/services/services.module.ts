import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceEntity } from '../../entities/service.entity';
import { ServicesController } from './services.controller';
import { AdminServicesController } from './services.admin.controller';
import { ServicesService } from './services.service';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [TypeOrmModule.forFeature([ServiceEntity]), AuthModule],
    controllers: [ServicesController, AdminServicesController],
    providers: [ServicesService],
    exports: [ServicesService],
})
export class ServicesModule {}
