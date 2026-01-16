import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

function ensureUploadsDir() {
    if (!existsSync(UPLOAD_DIR)) {
        mkdirSync(UPLOAD_DIR, { recursive: true });
    }
}

function safeFileName(original: string) {
    const stamp = Date.now();
    const ext = extname(original || '').toLowerCase() || '.bin';
    return `${stamp}-${Math.random().toString(36).slice(2, 10)}${ext}`;
}

@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminUploadController {
    @Post('upload')
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: (req, file, cb) => {
                ensureUploadsDir();
                cb(null, UPLOAD_DIR);
            },
            filename: (req, file, cb) => {
                cb(null, safeFileName(file.originalname));
            },
        }),
        limits: { fileSize: 50 * 1024 * 1024 },
    }))
    async upload(@UploadedFile() file?: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        return {
            ok: true,
            url: `/uploads/${file.filename}`,
            size: file.size,
            mime: file.mimetype,
        };
    }
}
