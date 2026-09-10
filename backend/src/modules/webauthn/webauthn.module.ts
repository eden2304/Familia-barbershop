import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';
import { WebauthnCredential } from '../../entities/webauthn-credential.entity';
import { AuthModule } from '../auth/auth.module';
import { WebauthnController } from './webauthn.controller';
import { WebauthnService } from './webauthn.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([WebauthnCredential, Client, Setting]),
        AuthModule,
    ],
    controllers: [WebauthnController],
    providers: [WebauthnService],
    exports: [WebauthnService],
})
export class WebauthnModule {}
