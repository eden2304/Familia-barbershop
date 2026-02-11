import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt'; // ✅
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';
import { AdminPhone } from '../../entities/admin-phone.entity';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { type SignOptions } from 'jsonwebtoken';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';


@Module({
    imports: [
        TypeOrmModule.forFeature([Client, Setting, AdminPhone, RefreshToken]),
        WhatsAppModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET,          // חובה שזה יהיה אותו SECRET של כל המערכת
            signOptions: { expiresIn: '30d' },       // או מה שבא לך
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