import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';
import { AdminPhone } from '../../entities/admin-phone.entity';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RefreshToken } from '../../entities/refresh-token.entity';
import {APP_GUARD} from "@nestjs/core";
import {RolesGuard} from "./roles.guard";

@Module({
    imports: [TypeOrmModule.forFeature([Client, Setting, AdminPhone, RefreshToken])],
    controllers: [AuthController],
    providers: [
        AuthService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
    ],
    exports: [AuthService],
})
export class AuthModule {}
