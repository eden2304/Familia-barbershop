import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { Product } from '../../entities/product.entity';
import { Testimonial } from '../../entities/testimonial.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';
import { Setting } from '../../entities/setting.entity';
import { PublicContentController } from './public-content.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Product,
            Testimonial,
            GalleryVideo,
            BackgroundVideo,
            Setting,
        ]),
    ],
    controllers: [PublicContentController],
})
export class ContentModule {}
