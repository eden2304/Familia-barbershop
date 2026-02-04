import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { Testimonial } from '../../entities/testimonial.entity';
import { GalleryVideo } from '../../entities/gallery-video.entity';
import { BackgroundVideo } from '../../entities/background-video.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import type { Express } from 'express';
import { randomUUID } from 'crypto';
import { execFile, execFileSync } from 'child_process';

let ffmpegAvailable: boolean | null = null;

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

    // ----- Upload (Stories/Backgrounds) -----
    @Post('upload')
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: (_req, _file, cb) => {
                const fullDir = path.resolve(process.cwd(), 'uploads', 'full');
                const previewDir = path.resolve(process.cwd(), 'uploads', 'preview');
                if (!fs.existsSync(fullDir)) {
                    fs.mkdirSync(fullDir, { recursive: true });
                }
                if (!fs.existsSync(previewDir)) {
                    fs.mkdirSync(previewDir, { recursive: true });
                }
                cb(null, fullDir);
            },
            filename: (_req, _file, cb) => {
                const id = randomUUID();
                cb(null, `${id}.mp4`);
            },
        }),
        limits: { fileSize: 1024 * 1024 * 1024 },
    }))
    async uploadFile(@UploadedFile() file?: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }
        const fullFilename = file.filename;
        const previewDir = path.resolve(process.cwd(), 'uploads', 'preview');
        const previewPath = path.join(previewDir, fullFilename);
        const inputPath = file.path;

        let previewUrl = `/uploads/preview/${fullFilename}`;
        if (ffmpegAvailable === null) {
            try {
                execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
                ffmpegAvailable = true;
            } catch {
                ffmpegAvailable = false;
            }
        }
        if (ffmpegAvailable) {
            try {
                execFile('ffmpeg', [
                    '-y',
                    '-i', inputPath,
                    '-vf', 'scale=360:640,fps=15',
                    '-c:v', 'libx264',
                    '-profile:v', 'baseline',
                    '-preset', 'veryfast',
                    '-b:v', '300k',
                    '-maxrate', '350k',
                    '-bufsize', '600k',
                    '-movflags', '+faststart',
                    '-an',
                    previewPath,
                ], (error) => {
                    if (error && fs.existsSync(previewPath)) {
                        fs.unlinkSync(previewPath);
                    }
                });
            } catch {
                if (fs.existsSync(previewPath)) {
                    fs.unlinkSync(previewPath);
                }
            }
        } else {
            previewUrl = `/uploads/full/${fullFilename}`;
        }

        const fullUrl = `/uploads/full/${fullFilename}`;
        return {
            ok: true,
            fullUrl,
            previewUrl,
            url: previewUrl,
            size: file.size,
            mime: file.mimetype,
        };
    }
}
