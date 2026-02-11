import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../../entities/product.entity';
import { Testimonial } from '../../entities/testimonial.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { Setting } from '../../entities/setting.entity';
import { BusinessHour } from '../../entities/business-hour.entity';
import { AdminContentController } from './admin-content.controller';
import { BlockedTimesController } from './blocked-times.controller';
import { SettingsController } from './settings.controller';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { Appointment } from '../../entities/appointment.entity';
import { AdminAppointmentsController } from './admin-appointments.controller';
import { AdminBusinessHoursController } from './admin-business-hours.controller';
import { Client } from '../../clients/client.entity';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AdminWhatsAppController } from './admin-whatsapp.controller';


@Module({
    imports: [
        TypeOrmModule.forFeature([
            Appointment,
            Client,
            Product,
            Testimonial,
            GalleryVideo,
            BackgroundVideo,
            BlockedTime,
            Setting,
            BusinessHour,
        ]),
        AuthModule, // מספיק! כי AuthModule מייצא JwtModule
        WhatsAppModule,
    ],
    controllers: [
        AdminAppointmentsController,
        AdminContentController,
        AdminController,
        BlockedTimesController,
        SettingsController,
        AdminBusinessHoursController,
        AdminWhatsAppController,
    ],
})
export class AdminModule {}

