import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { Product } from '../../entities/product.entity';
import { Testimonial } from '../../entities/testimonial.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';
import { PublicContentController } from './public-content.controller';
import { Setting } from '../../entities/setting.entity';
import { BusinessHoursPublicController } from './business-hours.public.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([Product, Testimonial, GalleryVideo, BackgroundVideo, Setting]),
    ],
    controllers: [PublicContentController, BusinessHoursPublicController],
})
export class ContentModule {}
