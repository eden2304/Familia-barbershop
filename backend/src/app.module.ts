import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

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
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { WaitingListModule } from './modules/waiting-list/waiting-list.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '.env.development'] }),
        ScheduleModule.forRoot(),
        TypeOrmModule.forRootAsync({
            useFactory: (): TypeOrmModuleOptions => {
                const hasUrl = !!process.env.DATABASE_URL;
                const username = process.env.DB_USERNAME || 'familia_app';
                const password = process.env.DB_PASSWORD || 'change_me_strong';
                const database = process.env.DB_NAME || 'familia';
                const host = process.env.DB_HOST || 'localhost';
                const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;
                return {
                    type: 'postgres',
                    ...(hasUrl
                        ? { url: process.env.DATABASE_URL }
                        : { host, port, username, password, database }),
                    autoLoadEntities: true,
                    synchronize: false,
                    logging: ['error', 'warn'],
                    namingStrategy: new SnakeNamingStrategy(),
                };
            },
        }),
        ServicesModule,
        AppointmentsModule,
        AdminModule,
        ContentModule,
        SeedModule,
        AuthModule,
        ClientsModule,
        WaitingListModule,
    ],
})
export class AppModule {}
