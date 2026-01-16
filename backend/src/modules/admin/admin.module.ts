import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../../entities/product.entity';
import { Testimonial } from '../../entities/testimonial.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { Setting } from '../../entities/setting.entity';
import { BusinessHour } from '../../entities/business-hour.entity';
import { WaitingList } from '../../entities/waiting-list.entity';
import { RecurringAppointment } from '../../entities/recurring-appointment.entity';
import { AdminContentController } from './admin-content.controller';
import { BlockedTimesController } from './blocked-times.controller';
import { SettingsController } from './settings.controller';
import { AuthModule } from '../auth/auth.module';
import {AdminController} from "./admin.controller";
import { Appointment } from '../../entities/appointment.entity';
import { AdminAppointmentsController } from './admin-appointments.controller';
import { AdminBusinessHoursController } from './admin-business-hours.controller';
import { AdminWaitingListController } from './admin-waiting-list.controller';
import { AdminUploadController } from './admin-upload.controller';


@Module({
    imports: [
        TypeOrmModule.forFeature([
            Appointment,
            Product,
            Testimonial,
            GalleryVideo,
            BackgroundVideo,
            BlockedTime,
            Setting,
            BusinessHour,
            WaitingList,
            RecurringAppointment,
        ]),
        AuthModule, // מספיק! כי AuthModule מייצא JwtModule
    ],
    controllers: [
        AdminAppointmentsController,
        AdminContentController,
        AdminController,
        BlockedTimesController,
        SettingsController,
        AdminBusinessHoursController,
        AdminWaitingListController,
        AdminUploadController,
    ],
})
export class AdminModule {}


