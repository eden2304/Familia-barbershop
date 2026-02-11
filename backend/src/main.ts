import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Request, Response, NextFunction } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';

const logger = new Logger('Bootstrap');
const RETENTION_DAYS = 7;

interface Bucket { count: number; reset: number; }
type RateLimitKey = { key: string; type: 'ip' | 'user' | 'unknown'; masked: string };
type RateLimitOptions = {
    limit: number;
    windowMs: number;
    name: string;
    keyGenerator?: (req: Request) => RateLimitKey;
    skip?: (req: Request) => boolean;
};

function extractBearerToken(req: Request): string | null {
    const auth = req.headers['authorization'] || req.headers['Authorization'];
    if (typeof auth !== 'string') return null;
    const [scheme, token] = auth.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return token;
}

function getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
        return String(forwarded[0]).trim();
    }
    return req.ip || (req.connection as any)?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

function maskIp(ip: string): string {
    if (!ip) return 'unknown';
    if (ip.includes('.')) {
        const parts = ip.split('.');
        if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
    }
    if (ip.includes(':')) {
        const parts = ip.split(':').filter(Boolean);
        return parts.slice(0, 3).join(':') + '::';
    }
    return 'unknown';
}

function maskUser(value: string): string {
    if (!value) return 'unknown';
    const tail = value.slice(-3);
    return `***${tail}`;
}

function createMemoryRateLimiter(options: RateLimitOptions) {
    const buckets = new Map<string, Bucket>();
    return (req: Request, res: Response, next: NextFunction) => {
        if (options.skip?.(req)) return next();

        const keyInfo = options.keyGenerator?.(req) ?? {
            key: getClientIp(req),
            type: 'ip' as const,
            masked: maskIp(getClientIp(req)),
        };
        const now = Date.now();
        const bucketKey = `${options.name}:${keyInfo.key}`;
        const bucket = buckets.get(bucketKey) || { count: 0, reset: now + options.windowMs };
        if (now > bucket.reset) {
            bucket.count = 0;
            bucket.reset = now + options.windowMs;
        }
        bucket.count += 1;
        buckets.set(bucketKey, bucket);

        if (bucket.count > options.limit) {
            const retry = Math.max(1, Math.ceil((bucket.reset - now) / 1000));
            const remaining = Math.max(0, options.limit - bucket.count);
            res.setHeader('Retry-After', retry.toString());
            res.setHeader('RateLimit-Limit', options.limit.toString());
            res.setHeader('RateLimit-Remaining', remaining.toString());
            res.setHeader('RateLimit-Reset', Math.ceil(bucket.reset / 1000).toString());

            logger.warn(
                `[RateLimit:${options.name}] blocked ${req.method} ${req.originalUrl} ` +
                `keyType=${keyInfo.type} key=${keyInfo.masked} count=${bucket.count} windowMs=${options.windowMs}`,
            );
            res.status(429).json({ message: 'Too Many Requests' });
            return;
        }
        next();
    };
}

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

async function pruneOldRecords(ds: DataSource) {
    try {
        await ds.query(`delete from appointments where ends_at < now() - interval '${RETENTION_DAYS} days'`);
        await ds.query(`delete from waiting_list where desired_starts_at < now() - interval '${RETENTION_DAYS} days'`);
        await ds.query(
            `delete from blocked_times where coalesce(end_at, start_at) < now() - interval '${RETENTION_DAYS} days'`,
        );
    } catch (error) {
        logger.error('[pruneOldRecords] Failed to prune old data', error);
    }
}

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    app.set('trust proxy', true);

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
            // לאפשר קריאות ללא Origin (למשל curl/postman)
            if (!origin) return callback(null, true);

            // דומיינים מותרים
            const allowlist = [
                'https://familia-barbershop.com',
                'https://familia-barbershop-production.up.railway.app',
                'https://heartfelt-analysis-production.up.railway.app',
                'http://localhost:5173',
                'http://localhost:3000',
            ];

            // לאפשר גם כל *.up.railway.app (במיוחד כשיש לך שני סרוויסים שונים)
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

    const authKeyGenerator = (req: Request): RateLimitKey => {
        const token = extractBearerToken(req);
        if (token) {
            try {
                const payload = jwt.verify(token, secret) as { sub?: string | number; phone?: string };
                const userKey = payload?.sub ? String(payload.sub) : String(payload?.phone || '');
                if (userKey) {
                    return { key: userKey, type: 'user', masked: maskUser(userKey) };
                }
            } catch {
                // ignore invalid token
            }
        }
        const ip = getClientIp(req);
        return { key: ip, type: 'ip', masked: maskIp(ip) };
    };

    const isOptions = (req: Request) => req.method.toUpperCase() === 'OPTIONS';
    const isStaticReadOnly = (req: Request) => {
        if (req.method.toUpperCase() !== 'GET') return false;
        const path = req.path || '';
        return (
            path === '/services' ||
            path === '/products' ||
            path === '/gallery-videos' ||
            path === '/background-videos' ||
            path === '/testimonials' ||
            path === '/business-hours' ||
            path.startsWith('/settings/')
        );
    };

    const globalLimiter = createMemoryRateLimiter({
        limit: 300,
        windowMs: 60_000,
        name: 'global',
        keyGenerator: authKeyGenerator,
        skip: (req) => isOptions(req) || isStaticReadOnly(req),
    });

    const staticLimiter = createMemoryRateLimiter({
        limit: 1200,
        windowMs: 60_000,
        name: 'static-get',
        keyGenerator: (req) => {
            const ip = getClientIp(req);
            return { key: ip, type: 'ip', masked: maskIp(ip) };
        },
        skip: (req) => isOptions(req) || !isStaticReadOnly(req),
    });

    const authLimiter = createMemoryRateLimiter({
        limit: 20,
        windowMs: 60_000,
        name: 'auth',
        keyGenerator: (req) => {
            const ip = getClientIp(req);
            return { key: ip, type: 'ip', masked: maskIp(ip) };
        },
        skip: isOptions,
    });

    const otpLimiter = createMemoryRateLimiter({
        limit: 8,
        windowMs: 10 * 60_000,
        name: 'otp-request',
        keyGenerator: (req) => {
            const rawPhone = String((req.body as any)?.phone || '').replace(/\D/g, '');
            if (rawPhone) {
                return { key: `phone:${rawPhone}`, type: 'user', masked: maskUser(rawPhone) };
            }
            const ip = getClientIp(req);
            return { key: ip, type: 'ip', masked: maskIp(ip) };
        },
        skip: isOptions,
    });

    const appointmentLimiter = createMemoryRateLimiter({
        limit: 20,
        windowMs: 60_000,
        name: 'appointment',
        keyGenerator: authKeyGenerator,
        skip: (req) => isOptions(req) || req.method.toUpperCase() === 'GET',
    });

    app.use(staticLimiter);
    app.use(globalLimiter);
    app.use(['/auth', '/users'], authLimiter);
    app.use('/admin/verify-code', authLimiter);
    app.use('/appointments', appointmentLimiter);
    app.use(['/admin/appointments', '/admin/recurring-appointments'], appointmentLimiter);
    app.use([
        '/auth/request-code',
        '/auth/request-code-login',
        '/users/request-code',
        '/users/request-code-login',
    ], otpLimiter);

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
