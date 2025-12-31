import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Request, Response, NextFunction } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';

const logger = new Logger('Bootstrap');

interface Bucket { count: number; reset: number; }

function createMemoryRateLimiter(limit: number, windowMs: number, name: string) {
    const buckets = new Map<string, Bucket>();
    return (req: Request, res: Response, next: NextFunction) => {
        const ip = req.ip || (req.connection as any)?.remoteAddress || 'unknown';
        const now = Date.now();
        const bucket = buckets.get(ip) || { count: 0, reset: now + windowMs };
        if (now > bucket.reset) {
            bucket.count = 0;
            bucket.reset = now + windowMs;
        }
        bucket.count += 1;
        buckets.set(ip, bucket);
        if (bucket.count > limit) {
            const retry = Math.ceil((bucket.reset - now) / 1000);
            res.setHeader('Retry-After', retry.toString());
            logger.warn(`[RateLimit:${name}] blocked request from ${ip}`);
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

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    app.set('trust proxy', 1);

    const isProd = process.env.NODE_ENV === 'production';

    const allowedOrigins = isProd
        ? [
            'https://familia-barbershop.com',
            'https://heartfelt-analysis-production.up.railway.app', // הדומיין של הפרונט שלך כרגע
        ]
        : [
            'http://localhost:5173',
            'http://localhost:3000',
            'https://heartfelt-analysis-production.up.railway.app',
            'https://familia-barbershop.com',
        ];

    app.enableCors({
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) callback(null, true);
            else callback(new Error('CORS_DENIED'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'x-client-phone',
            'x-client-name',
            'x-admin-phone',
            'x-admin-code',
        ],
    });


    app.use(securityHeaders);

    const globalLimiter = createMemoryRateLimiter(100, 60_000, 'global');
    const authLimiter = createMemoryRateLimiter(10, 60_000, 'auth');
    const otpLimiter = createMemoryRateLimiter(10, 60_000, 'otp');

    app.use(globalLimiter);
    app.use(['/auth', '/users', '/clients'], authLimiter);
    app.use([
        '/auth/request-code',
        '/auth/verify-code',
        '/auth/request-code-login',
        '/auth/verify',
        '/users/request-code',
        '/users/verify-code',
    ], otpLimiter);

    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        forbidUnknownValues: true,
    }));

    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
        logger.error('FATAL: JWT_SECRET missing or too short');
        process.exit(1);
    }

    const port = process.env.PORT || 3001;
    await app.listen(port);
    logger.log(`API listening on http://localhost:${port}`);
}
bootstrap();
