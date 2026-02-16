import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Request, Response, NextFunction } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';

const logger = new Logger('Bootstrap');
const RETENTION_DAYS = 7;

function securityHeaders(req: Request, res: Response, next: NextFunction) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; object-src 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
        res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    res.removeHeader('X-Powered-By');
    next();
}



async function resolveBlockedTimesPruneSql(ds: DataSource): Promise<string> {
    const rows = await ds.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'blocked_times' ORDER BY ordinal_position",
    ) as Array<{ column_name: string }>;

    const columns = new Set(rows.map((row) => row.column_name));
    if (columns.has('ends_at')) {
        return `delete from blocked_times where coalesce(ends_at, starts_at) < now() - interval '${RETENTION_DAYS} days'`;
    }
    if (columns.has('end_at')) {
        return `delete from blocked_times where coalesce(end_at, start_at) < now() - interval '${RETENTION_DAYS} days'`;
    }
    if (columns.has('start_at')) {
        return `delete from blocked_times where start_at < now() - interval '${RETENTION_DAYS} days'`;
    }
    return `delete from blocked_times where starts_at < now() - interval '${RETENTION_DAYS} days'`;
}

async function pruneOldRecords(ds: DataSource) {
    try {
        await ds.query(`delete from appointments where ends_at < now() - interval '${RETENTION_DAYS} days'`);
        await ds.query(`delete from waiting_list where desired_starts_at < now() - interval '${RETENTION_DAYS} days'`);

        try {
            const blockedTimesPruneSql = await resolveBlockedTimesPruneSql(ds);
            await ds.query(blockedTimesPruneSql);
        } catch (error) {
            logger.warn(
                `[pruneOldRecords] blocked_times schema drift detected, falling back to start column only: ${error instanceof Error ? error.message : 'unknown'}`,
            );
            await ds.query(`delete from blocked_times where coalesce(starts_at, start_at) < now() - interval '${RETENTION_DAYS} days'`);
        }
    } catch (error) {
        logger.warn(`[pruneOldRecords] Failed to prune old data: ${error instanceof Error ? error.message : 'unknown'}`);
    }
}

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    app.enableShutdownHooks();
    app.set('trust proxy', 1);

    const uploadDir = path.resolve(process.cwd(), 'uploads');
    const fullDir = path.resolve(uploadDir, 'full');
    const previewDir = path.resolve(uploadDir, 'preview');
    if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
    }
    if (!fs.existsSync(previewDir)) {
        fs.mkdirSync(previewDir, { recursive: true });
    }

    app.enableCors({
        origin(origin, callback) {
            if (!origin) return callback(null, true);
            const allowlist = [
                'https://familia-barbershop.com',
                'https://familia-barbershop-production.up.railway.app',
                'https://heartfelt-analysis-production.up.railway.app',
                'http://localhost:5173',
                'http://localhost:3000',
            ];
            const isRailway = origin.endsWith('.up.railway.app');
            if (allowlist.includes(origin) || isRailway) return callback(null, true);
            return callback(new Error('CORS_DENIED'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Client-Phone',
            'X-Client-Name',
            'X-Admin-Phone',
            'X-Admin-Code',
        ],
    });

    app.use(securityHeaders);
    app.use('../server/uploads/Familia.png', (req, res, next) => {
        const candidates = [
            path.resolve(process.cwd(), '../server/uploads/Familia.png'),
            path.resolve(process.cwd(), 'server/uploads/Familia.png'),
        ];
        const familiaIconPath = candidates.find((candidate) => fs.existsSync(candidate));
        if (!familiaIconPath) {
            return next();
        }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(familiaIconPath);
    });
    app.useStaticAssets(uploadDir, {
        prefix: '/uploads',
        setHeaders: (res, filePath) => {
            res.setHeader('Accept-Ranges', 'bytes');
            if (filePath.endsWith('.mp4')) {
                res.setHeader('Content-Type', 'video/mp4');
            }
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
    });

    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 64) {
        logger.error('FATAL: JWT_SECRET missing or too short');
        process.exit(1);
    }

    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        forbidUnknownValues: true,
    }));

    const port = process.env.PORT || 3001;
    await app.listen(port);
    logger.log(`API listening on http://localhost:${port}`);

    const dataSource = app.get(DataSource);
    await pruneOldRecords(dataSource);
    setInterval(() => {
        void pruneOldRecords(dataSource);
    }, 6 * 60 * 60 * 1000);
}
bootstrap();
