import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../../entities/product.entity';
import { Testimonial } from '../../entities/testimonial.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { Setting } from '../../entities/setting.entity';
import { AdminContentController } from './admin-content.controller';
import { BlockedTimesController } from './blocked-times.controller';
import { SettingsController } from './settings.controller';

@Module({
    imports: [TypeOrmModule.forFeature([
        Product, Testimonial, GalleryVideo, BackgroundVideo, BlockedTime, Setting
    ])],
    controllers: [AdminContentController, BlockedTimesController, SettingsController],
})
export class AdminModule {}
