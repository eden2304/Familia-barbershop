import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { Testimonial } from '../../entities/testimonial.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';

@Controller()
export class PublicContentController {
    constructor(
        @InjectRepository(Product) private products: Repository<Product>,
        @InjectRepository(Testimonial) private testimonials: Repository<Testimonial>,
        @InjectRepository(GalleryVideo) private gallery: Repository<GalleryVideo>,
        @InjectRepository(BackgroundVideo) private backgrounds: Repository<BackgroundVideo>,
    ) {}

    @Get('products')
    listProducts() {
        // ✔ camelCase
        return this.products.find({
            where: { isActive: true },
            order: { orderIndex: 'ASC', id: 'ASC' },
        });
    }

    @Get('testimonials')
    listTestimonials() {
        return this.testimonials.find({
            where: { is_active: true },
            order: { order_index: 'ASC', id: 'ASC' },
        });
    }

    @Get('gallery-videos')
    listGallery() {
        return this.gallery.find({
            where: { isActive: true },
            order: { orderIndex: 'ASC', id: 'ASC' },
        });
    }

    @Get('background-videos')
    listBackgrounds() {
        return this.backgrounds.find({
            where: { isActive: true },
            order: { orderIndex: 'ASC', id: 'ASC' },
        });
    }
}
