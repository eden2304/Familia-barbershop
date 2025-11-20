import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { Testimonial } from '../../entities/testimonial.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminContentController {
    constructor(
        @InjectRepository(Product) private products: Repository<Product>,
        @InjectRepository(Testimonial) private testimonials: Repository<Testimonial>,
        @InjectRepository(GalleryVideo) private gallery: Repository<GalleryVideo>,
        @InjectRepository(BackgroundVideo) private backgrounds: Repository<BackgroundVideo>,
    ) {}

    // ----- Products -----
    @Get('products')
    listProducts() {
        return this.products.find({ order: { orderIndex: 'ASC', id: 'ASC' } }); // ✔
    }

    @Post('products')
    createProduct(@Body() dto: Partial<Product>) {
        return this.products.save(this.products.create(dto));
    }

    @Put('products/:id')
    async updateProduct(@Param('id') id: string, @Body() dto: Partial<Product>) {
        await this.products.update({ id }, dto); // ✔ בלי Number
        return this.products.findOne({ where: { id } });
    }

    @Delete('products/:id')
    async deleteProduct(@Param('id') id: string) {
        await this.products.delete({ id }); // ✔
        return { ok: true };
    }

    // ----- Testimonials -----
    @Get('testimonials')
    listTestimonials() {
        return this.testimonials.find({ order: { order_index: 'ASC', id: 'ASC' } });
    }

    @Post('testimonials')
    createTestimonial(@Body() dto: Partial<Testimonial>) {
        return this.testimonials.save(this.testimonials.create(dto));
    }

    @Put('testimonials/:id')
    async updateTestimonial(@Param('id') id: string, @Body() dto: Partial<Testimonial>) {
        const testimonialId = Number(id);
        await this.testimonials.update({ id: testimonialId }, dto);
        return this.testimonials.findOne({ where: { id: testimonialId } });
    }

    @Delete('testimonials/:id')
    async deleteTestimonial(@Param('id') id: string) {
        const testimonialId = Number(id);
        await this.testimonials.delete({ id: testimonialId });
        return { ok: true };
    }

    // ----- Gallery Videos (Stories) -----
    @Get('gallery-videos')
    listGallery() {
        return this.gallery.find({ order: { orderIndex: 'ASC', id: 'ASC' } }); // ✔
    }

    @Post('gallery-videos')
    createGallery(@Body() dto: Partial<GalleryVideo>) {
        return this.gallery.save(this.gallery.create(dto));
    }

    @Put('gallery-videos/:id')
    async updateGallery(@Param('id') id: string, @Body() dto: Partial<GalleryVideo>) {
        await this.gallery.update({ id }, dto); // ✔
        return this.gallery.findOne({ where: { id } });
    }

    @Delete('gallery-videos/:id')
    async deleteGallery(@Param('id') id: string) {
        await this.gallery.delete({ id }); // ✔
        return { ok: true };
    }

    // ----- Background Videos -----
    @Get('background-videos')
    listBackgrounds() {
        return this.backgrounds.find({ order: { orderIndex: 'ASC', id: 'ASC' } }); // ✔
    }

    @Post('background-videos')
    async createBackground(@Body() dto: Partial<BackgroundVideo>) {
        const created = await this.backgrounds.save(this.backgrounds.create(dto));
        if (dto.isActive) { // ✔ camelCase
            await this.backgrounds.createQueryBuilder()
                .update(BackgroundVideo)
                .set({ isActive: false })
                .where('id <> :id', { id: created.id })
                .execute();
            await this.backgrounds.update({ id: created.id }, { isActive: true });
        }
        return created;
    }

    @Put('background-videos/:id')
    async updateBackground(@Param('id') id: string, @Body() dto: Partial<BackgroundVideo>) {
        await this.backgrounds.update({ id }, dto); // ✔
        if (dto.isActive) {
            await this.backgrounds.createQueryBuilder()
                .update(BackgroundVideo)
                .set({ isActive: false })
                .where('id <> :id', { id })
                .execute();
            await this.backgrounds.update({ id }, { isActive: true });
        }
        return this.backgrounds.findOne({ where: { id } });
    }

    @Delete('background-videos/:id')
    async deleteBackground(@Param('id') id: string) {
        await this.backgrounds.delete({ id }); // ✔
        return { ok: true };
    }
}
