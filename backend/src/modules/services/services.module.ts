import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceEntity } from '../../entities/service.entity';
import { ServicesController } from './services.controller';
import { AdminServicesController } from './services.admin.controller';
import {Module} from "@nestjs/common";

@Module({
    imports: [TypeOrmModule.forFeature([ServiceEntity])],
    controllers: [ServicesController, AdminServicesController],
    providers: [],
    exports: [],
})
export class ServicesModule {}
