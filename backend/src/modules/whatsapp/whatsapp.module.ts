import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from '../../entities/setting.entity';
import { WhatsappService } from './whatsapp.service';

@Module({
    imports: [TypeOrmModule.forFeature([Setting])],
    providers: [WhatsappService],
    exports: [WhatsappService],
})
export class WhatsappModule {}
