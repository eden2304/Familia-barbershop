import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { Testimonial } from '../../entities/testimonial.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';
import {Public} from "../auth/public.decorator";
import {Setting} from "../../entities/setting.entity";

@Controller()
export class PublicContentController {
    constructor(
        @InjectRepository(Product) private products: Repository<Product>,
        @InjectRepository(Testimonial) private testimonials: Repository<Testimonial>,
        @InjectRepository(GalleryVideo) private gallery: Repository<GalleryVideo>,
        @InjectRepository(BackgroundVideo) private backgrounds: Repository<BackgroundVideo>,
        @InjectRepository(Setting) private setRepo: Repository<Setting>,
    ) {}

    @Public()
    @Get('products')
    listProducts() {
        // ✔ camelCase
        return this.products.find({
            where: { isActive: true },
            order: { orderIndex: 'ASC', id: 'ASC' },
        });
    }

    @Public()
    @Get('testimonials')
    listTestimonials() {
        return this.testimonials.find({
            where: { is_active: true },
            order: { order_index: 'ASC', id: 'ASC' },
        });
    }

    @Public()
    @Get('gallery-videos')
    listGallery() {
        return this.gallery.find({
            where: { isActive: true },
            order: { orderIndex: 'ASC', id: 'ASC' },
        });
    }

    @Public()
    @Get('background-videos')
    listBackgrounds() {
        return this.backgrounds.find({
            where: { isActive: true },
            order: { orderIndex: 'ASC', id: 'ASC' },
        });
    }

    // Business Hours (public)
// אם אין ב-DB -> יוצר ברירת מחדל ב-settings תחת key=business_hours ומחזיר אותה
    @Public()
    @Get('business-hours')
    async getBusinessHours() {
        const key = 'business_hours';

        const DEFAULT_HOURS = [
            { day: 'sunday',    open: '10:00', close: '19:00', closed: false },
            { day: 'monday',    open: '10:00', close: '19:00', closed: false },
            { day: 'tuesday',   open: '10:00', close: '19:00', closed: false },
            { day: 'wednesday', open: '10:00', close: '19:00', closed: false },
            { day: 'thursday',  open: '10:00', close: '19:00', closed: false },
            { day: 'friday',    open: '08:00', close: '15:00', closed: false },
            { day: 'saturday',  open: '00:00', close: '00:00', closed: true  },
        ];

        // נסה להביא מה-DB
        let row = await this.setRepo.findOneBy({ key });

        // אם אין, צור
        if (!row) {
            row = await this.setRepo.save({ key, value: DEFAULT_HOURS } as any);
            return DEFAULT_HOURS;
        }

        // אם value נשמר כמחרוזת או כאובייקט
        const v: any = (row as any).value;
        if (Array.isArray(v)) return v;

        if (typeof v === 'string') {
            try {
                const parsed = JSON.parse(v);
                if (Array.isArray(parsed)) return parsed;
            } catch {}
        }

        // fallback אם משהו לא תקין
        return DEFAULT_HOURS;
    }


}
