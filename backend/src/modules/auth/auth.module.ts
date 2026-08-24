import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt'; // ✅
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';
import { AdminPhone } from '../../entities/admin-phone.entity';
import { Appointment } from '../../entities/appointment.entity';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { type SignOptions } from 'jsonwebtoken';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AdminPushModule } from '../push/admin-push.module';


@Module({
    imports: [
        TypeOrmModule.forFeature([Client, Setting, AdminPhone, Appointment, RefreshToken]),
        WhatsAppModule,
        AdminPushModule,
        JwtModule.registerAsync({
            // registerAsync + ConfigService: SECRET must match the one AuthService signs with.
            // JwtModule.register() reads process.env.JWT_SECRET at module-import time, which runs
            // before ConfigModule has loaded .env — verifyAsync() then always fails against a
            // stale/empty secret. registerAsync defers the read to DI-instantiation time instead.
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('JWT_SECRET'),
                signOptions: { expiresIn: '30d' },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
    ],
    exports: [AuthService, JwtModule],           // <-- חשוב! מייצאים כדי שמודולים אחרים יוכלו להזריק JwtService
})
export class AuthModule {}