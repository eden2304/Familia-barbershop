import { BadRequestException, Body, Controller, Delete, Get, Logger, Param, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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
import { isFfmpegAvailable, transcodeFullVideo, transcodePreviewVideo } from './video-optimizer';

const mimeToExtension: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/heif': 'heif',
};

const allowedUploadMimeTypes = new Set(Object.keys(mimeToExtension));
const videoUploadMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v']);

@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminContentController {
    private readonly logger = new Logger(AdminContentController.name);

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
        fileFilter: (_req, file, cb) => {
            const mimeType = String(file.mimetype || '').toLowerCase();
            if (!allowedUploadMimeTypes.has(mimeType)) {
                cb(new BadRequestException('UNSUPPORTED_FILE_TYPE') as Error, false);
                return;
            }
            cb(null, true);
        },
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
            filename: (_req, file, cb) => {
                const id = randomUUID();
                const mimeType = String(file.mimetype || '').toLowerCase();
                const extension = mimeToExtension[mimeType] || 'bin';
                cb(null, `${id}.${extension}`);
            },
        }),
        limits: { fileSize: 1024 * 1024 * 1024 },
    }))
    async uploadFile(@UploadedFile() file?: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        const mimeType = String(file.mimetype || '').toLowerCase();
        const fullFilename = file.filename;
        const fullUrl = `/uploads/full/${fullFilename}`;

        if (!videoUploadMimeTypes.has(mimeType)) {
            return {
                ok: true,
                fullUrl,
                previewUrl: fullUrl,
                url: fullUrl,
                size: file.size,
                mime: file.mimetype,
            };
        }

        const previewDir = path.resolve(process.cwd(), 'uploads', 'preview');
        const fullDir = path.resolve(process.cwd(), 'uploads', 'full');
        const inputPath = file.path;
        const baseName = path.parse(fullFilename).name;

        // ברירת מחדל (ללא ffmpeg / כשל בהמרה): מגישים את הקובץ המקורי כמו שהוא
        let finalFullUrl = fullUrl;
        let previewUrl = fullUrl;

        if (await isFfmpegAvailable()) {
            const optimizedFilename = `${baseName}.mp4`;
            const optimizedPath = path.join(fullDir, `${baseName}.optimized.mp4`);
            try {
                await transcodeFullVideo(inputPath, optimizedPath);
                const finalPath = path.join(fullDir, optimizedFilename);
                if (finalPath !== inputPath) {
                    fs.unlinkSync(inputPath);
                }
                fs.renameSync(optimizedPath, finalPath);
                finalFullUrl = `/uploads/full/${optimizedFilename}`;
                previewUrl = finalFullUrl;
            } catch (error) {
                fs.rmSync(optimizedPath, { force: true });
                this.logger.warn(`Full video optimization failed, serving original: ${error instanceof Error ? error.message : 'unknown'}`);
            }

            const servedFullPath = path.join(fullDir, path.basename(finalFullUrl));
            const previewFilename = `${baseName}.mp4`;
            const previewPath = path.join(previewDir, previewFilename);
            try {
                await transcodePreviewVideo(servedFullPath, previewPath);
                previewUrl = `/uploads/preview/${previewFilename}`;
            } catch (error) {
                fs.rmSync(previewPath, { force: true });
                this.logger.warn(`Video preview generation failed, using full video: ${error instanceof Error ? error.message : 'unknown'}`);
            }
        }

        return {
            ok: true,
            fullUrl: finalFullUrl,
            previewUrl,
            url: finalFullUrl,
            size: file.size,
            mime: file.mimetype,
        };
    }
}
