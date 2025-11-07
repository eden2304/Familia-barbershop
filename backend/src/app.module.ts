import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

import { DataSourceOptions } from 'typeorm';


import { Client } from './clients/client.entity';
import { ServiceEntity } from './entities/service.entity';
import { BusinessHour } from './entities/business-hour.entity';
import { Appointment } from './entities/appointment.entity';
import { BlockedTime } from './entities/blocked-time.entity';
import { WaitingList } from './entities/waiting-list.entity';
import { Testimonial } from './entities/testimonial.entity';
import { Product } from './entities/product.entity';
import { GalleryVideo } from './entities/gallery-video.entity';
import { BackgroundVideo } from './entities/background-video.entity';
import { Setting } from './entities/setting.entity';
import { AdminPhone } from './entities/admin-phone.entity';

import { ServicesModule } from './modules/services/services.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { AdminModule } from './modules/admin/admin.module';
import { ContentModule } from './modules/content/content.module';
import { SeedModule } from './seeds/seed.module';
import {SnakeNamingStrategy} from "typeorm-naming-strategies";
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './clients/clients.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '.env.development'] }),
        TypeOrmModule.forRootAsync({
            useFactory: (): TypeOrmModuleOptions => {
                const hasUrl = !!process.env.DATABASE_URL;
                return {
                    type: 'postgres', // ליטרל תקין
                    ...(hasUrl
                        ? { url: process.env.DATABASE_URL }
                        : {
                            host: 'localhost',
                            port: 5432,
                            username: 'familia',
                            password: 'familia',
                            database: 'familia',
                        }),
                    autoLoadEntities: true,
                    synchronize: false, // DEV בלבד
                    logging: true, // <<< להדליק לוגים כדי לראות את ה-SQL והטעויות
                    namingStrategy: new SnakeNamingStrategy(), // <<< מיפוי camelCase <-> snake_case
                };
            },
        }),
        // אין צורך ב-TypeOrmModule.forFeature(...) ברמת AppModule
        // תשאיר את ה-forFeature רק בתוך המודולים (Services/Appointments/Admin/Content/Seed)
        ServicesModule,
        AppointmentsModule,
        AdminModule,
        ContentModule,
        SeedModule,
        AuthModule,
        ClientsModule,
    ],
})
export class AppModule {}
