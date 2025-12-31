import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from '../clients/client.entity';
import { Appointment } from '../entities/appointment.entity';
import {Module} from "@nestjs/common";
import {ClientsController} from "./clients.controller";
import {ClientsService} from "./clients.service";
import { AuthModule } from '../modules/auth/auth.module';
import {PublicClientsController} from "./public-clients.controller";

@Module({
    imports: [TypeOrmModule.forFeature([Client, Appointment]), AuthModule],
    controllers: [ClientsController, PublicClientsController],
    providers: [ClientsService],
    exports: [ClientsService],
})
export class ClientsModule {}
