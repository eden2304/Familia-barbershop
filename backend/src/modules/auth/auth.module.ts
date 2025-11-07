import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Client, Setting])],
    controllers: [AuthController],
    providers: [AuthService],
})
export class AuthModule {}
