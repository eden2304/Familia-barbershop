import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Testimonial } from '../../entities/testimonial.entity';
import { Product } from '../../entities/product.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';
import { Setting } from '../../entities/setting.entity';
import { Repository } from 'typeorm';

@Controller()
export class ContentController {
    constructor(
        @InjectRepository(Testimonial) private testiRepo: Repository<Testimonial>,
        @InjectRepository(Product) private prodRepo: Repository<Product>,
        @InjectRepository(GalleryVideo) private galRepo: Repository<GalleryVideo>,
        @InjectRepository(BackgroundVideo) private bgRepo: Repository<BackgroundVideo>,
        @InjectRepository(Setting) private setRepo: Repository<Setting>,
    ) {}

    // Public lists
    @Get('testimonials')
    listTestimonials() {
        return this.testiRepo.find({ where: { is_active: true }, order: { order_index: 'ASC' } });
    }
    @Get('products') listProducts() { return this.prodRepo.find({ where: { isActive: true }, order: { orderIndex: 'ASC' } }); }
    @Get('gallery-videos') listGallery() { return this.galRepo.find({ where: { isActive: true }, order: { orderIndex: 'ASC' } }); }
    @Get('background-videos')
    async listBackgroundVideos() {
        const rows = await this.bgRepo.find({ order: { orderIndex: 'ASC' } });
        // החזר גם url וגם videoUrl כדי להתאים לכל פרונט
        return rows.map(v => ({
            id: v.id,
            url: v.videoUrl,        // תאימות לפרונט ישן
            videoUrl: v.videoUrl,   // השם החדש והעדכני
            imageUrl: v.imageUrl,
            image_url: v.imageUrl,
            fullUrl: v.fullUrl,
            full_url: v.fullUrl,
            isActive: v.isActive,
            orderIndex: v.orderIndex,
        }));
    }    @Get('settings/:key') getSetting(@Param('key') key: string) { return this.setRepo.findOneBy({ key }); }

    // Admin CRUD (פשוט)
    @Post('admin/testimonials')
    addTestimonial(@Body() b: Partial<Testimonial>) {
        return this.testiRepo.save(this.testiRepo.create(b));
    }

    @Put('admin/testimonials/:id')
    updTestimonial(@Param('id') id: string, @Body() b: Partial<Testimonial>) {
        const testimonialId = Number(id);
        return this.testiRepo.update({ id: testimonialId }, b);
    }

    @Delete('admin/testimonials/:id')
    delTestimonial(@Param('id') id: string) {
        const testimonialId = Number(id);
        return this.testiRepo.delete({ id: testimonialId });
    }

    @Post('admin/products') addProduct(@Body() b: Partial<Product>) { return this.prodRepo.save(this.prodRepo.create(b)); }
    @Put('admin/products/:id') updProduct(@Param('id') id: string, @Body() b: Partial<Product>) { return this.prodRepo.update(id, b); }
    @Delete('admin/products/:id') delProduct(@Param('id') id: string) { return this.prodRepo.delete(id); }

    @Post('admin/gallery-videos') addGallery(@Body() b: Partial<GalleryVideo>) { return this.galRepo.save(this.galRepo.create(b)); }
    @Put('admin/gallery-videos/:id') updGallery(@Param('id') id: string, @Body() b: Partial<GalleryVideo>) { return this.galRepo.update(id, b); }
    @Delete('admin/gallery-videos/:id') delGallery(@Param('id') id: string) { return this.galRepo.delete(id); }

    @Post('admin/background-videos') addBG(@Body() b: Partial<BackgroundVideo>) { return this.bgRepo.save(this.bgRepo.create(b)); }
    @Put('admin/background-videos/:id') updBG(@Param('id') id: string, @Body() b: Partial<BackgroundVideo>) { return this.bgRepo.update(id, b); }
    @Delete('admin/background-videos/:id') delBG(@Param('id') id: string) { return this.bgRepo.delete(id); }

    @Post('admin/settings/:key') setSetting(@Param('key') key: string, @Body() b: { value: any }) {
        return this.setRepo.save({ key, value: b.value });
    }
}
