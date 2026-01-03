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


@Module({
    imports: [
        TypeOrmModule.forFeature([Client, Setting, AdminPhone, RefreshToken]),
        JwtModule.register({
            secret: process.env.JWT_SECRET, // ✅ חייב להיות מוגדר בפרודקשן
            signOptions: { expiresIn: (process.env.ACCESS_TOKEN_TTL || '15m') as SignOptions['expiresIn'] },
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
    ],
    exports: [
        AuthService,
        JwtModule, // ✅ זה מה שפותח ל-AdminModule את JwtService
    ],
})
export class AuthModule {}
