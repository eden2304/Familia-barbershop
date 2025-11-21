import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';
import { AdminPhone } from '../../entities/admin-phone.entity';
import { JwtAuthGuard } from './jwt-auth.guard';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
    imports: [TypeOrmModule.forFeature([Client, Setting, AdminPhone]), WhatsappModule],
    controllers: [AuthController],
    providers: [AuthService, JwtAuthGuard],
    exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
