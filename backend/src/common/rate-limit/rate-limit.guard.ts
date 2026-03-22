import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { RATE_LIMIT_POLICY_KEY, RateLimitPolicyName } from './rate-limit.decorator';
import { RedisRateLimitStore } from './redis-rate-limit.store';
import { normalizePhoneKey, rateLimitConfig } from './rate-limit.config';
import { getCfRay, getClientIp, maskIp, maskPhone } from './rate-limit.utils';

@Injectable()
export class RateLimitGuard implements CanActivate {
    private readonly logger = new Logger(RateLimitGuard.name);

    constructor(
        private readonly reflector: Reflector,
        private readonly store: RedisRateLimitStore,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<Request & { user?: any }>();
        const res = context.switchToHttp().getResponse<Response>();

        if (req.method.toUpperCase() === 'OPTIONS') return true;

        const adminAuth = this.resolveAdminAuth(req);
        if (adminAuth.isAdmin) {
            req.user = { ...(req.user || {}), ...adminAuth.payload };
            return true;
        }

        const policy = this.reflector.getAllAndOverride<RateLimitPolicyName>(RATE_LIMIT_POLICY_KEY, [
            context.getHandler(),
            context.getClass(),
        ]) || 'global';

        const checks = this.buildChecks(policy, req);
        let maxRetry = 0;
        let minRemaining = Number.MAX_SAFE_INTEGER;
        let bestLimit = 0;

        for (const check of checks) {
            try {
                const result = await this.store.consume(check.key, check.limit, check.windowSec);
                maxRetry = Math.max(maxRetry, result.retryAfterSeconds);
                minRemaining = Math.min(minRemaining, result.remaining);
                bestLimit = Math.max(bestLimit, check.limit);
                if (result.isBlocked) {
                    this.applyHeaders(res, check.limit, 0, result.retryAfterSeconds);
                    this.logThrottleEvent(req, check.maskedPhone, check.maskedIp, result.retryAfterSeconds);
                    throw new HttpException({ error: 'RATE_LIMITED', retryAfterSeconds: result.retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
                }
            } catch (error) {
                if (error instanceof HttpException) {
                    throw error;
                }
                const message = error instanceof Error ? error.message : 'unknown';
                if (message !== 'RATE_LIMIT_REDIS_DISABLED') {
                    this.logger.error(JSON.stringify({
                        event: 'rate_limit_redis_error',
                        route: req.originalUrl,
                        method: req.method,
                        ip: maskIp(getClientIp(req)),
                        policy,
                        message,
                    }));
                }
                return true;
            }
        }

        if (checks.length > 0) {
            this.applyHeaders(res, bestLimit, minRemaining === Number.MAX_SAFE_INTEGER ? 0 : minRemaining, Math.max(1, maxRetry));
        }

        return true;
    }

    private resolveAdminAuth(req: Request & { user?: any }): { isAdmin: boolean; payload?: Record<string, any> } {
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];
        if (typeof authHeader !== 'string') return { isAdmin: false };

        const [scheme, token] = authHeader.split(' ');
        if (scheme?.toLowerCase() !== 'bearer' || !token) return { isAdmin: false };

        const secret = String(process.env.JWT_SECRET || '').trim();
        if (!secret) return { isAdmin: false };

        try {
            const decoded = jwt.verify(token, secret);
            if (!decoded || typeof decoded !== 'object') return { isAdmin: false };
            const payload = decoded as Record<string, any>;
            const roles = Array.isArray(payload.roles) ? payload.roles : [];
            const isAdmin = Boolean(payload.isAdmin) || roles.includes('admin');
            return isAdmin ? { isAdmin: true, payload } : { isAdmin: false };
        } catch {
            return { isAdmin: false };
        }
    }

    private applyHeaders(res: Response, limit: number, remaining: number, retryAfter: number) {
        const resetAtEpochSeconds = Math.floor(Date.now() / 1000) + Math.max(1, retryAfter);
        res.setHeader('Retry-After', String(retryAfter));
        res.setHeader('RateLimit-Limit', String(limit));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, remaining)));
        res.setHeader('RateLimit-Reset', String(resetAtEpochSeconds));
    }

    private logThrottleEvent(req: Request, maskedPhone: string, maskedIp: string, retryAfterSeconds: number) {
        this.logger.warn(JSON.stringify({
            event: 'rate_limited',
            route: req.originalUrl,
            method: req.method,
            maskedPhone,
            ip: maskedIp,
            userAgent: req.headers['user-agent'] || '',
            cfRay: getCfRay(req),
            retryAfterSeconds,
        }));
    }

    private buildChecks(policy: RateLimitPolicyName, req: Request & { user?: any }): Array<{ key: string; limit: number; windowSec: number; maskedPhone: string; maskedIp: string }> {
        const ip = getClientIp(req);
        const routePathRaw = String(req.path || req.originalUrl || '').split('?')[0];
        const routePath = routePathRaw.startsWith('/') ? routePathRaw : `/${routePathRaw}`;
        const maskedIp = maskIp(ip);
        const bodyPhone = normalizePhoneKey((req.body as any)?.phone ?? (req.body as any)?.clientPhone ?? (req.body as any)?.client_phone ?? (req.body as any)?.client?.phone);
        const userPhone = normalizePhoneKey(req.user?.phone);
        const phone = userPhone || bodyPhone;
        const maskedPhone = phone ? maskPhone(phone) : 'unknown';

        if (policy === 'otp-request') {
            return [
                ...(phone ? [{ key: `otp-request:phone:${phone}`, limit: rateLimitConfig.otpRequest.phoneLimit, windowSec: rateLimitConfig.otpRequest.phoneWindowSec, maskedPhone, maskedIp }] : []),
                { key: `otp-request:ip:${ip}`, limit: rateLimitConfig.otpRequest.ipLimit, windowSec: rateLimitConfig.otpRequest.ipWindowSec, maskedPhone, maskedIp },
            ];
        }

        if (policy === 'otp-verify') {
            return [
                ...(phone ? [{ key: `otp-verify:phone:${phone}`, limit: rateLimitConfig.otpVerify.phoneLimit, windowSec: rateLimitConfig.otpVerify.phoneWindowSec, maskedPhone, maskedIp }] : []),
                { key: `otp-verify:ip:${ip}`, limit: rateLimitConfig.otpVerify.ipLimit, windowSec: rateLimitConfig.otpVerify.ipWindowSec, maskedPhone, maskedIp },
            ];
        }

        if (policy === 'booking-available') {
            return [
                { key: `booking-available:ip:${ip}`, limit: rateLimitConfig.availability.ipLimit, windowSec: rateLimitConfig.availability.ipWindowSec, maskedPhone, maskedIp },
                ...(phone ? [{ key: `booking-available:phone:${phone}`, limit: rateLimitConfig.availability.phoneLimit, windowSec: rateLimitConfig.availability.phoneWindowSec, maskedPhone, maskedIp }] : []),
            ];
        }

        if (policy === 'booking-create') {
            return [
                ...(phone ? [
                    { key: `booking-create:phone-burst:${phone}`, limit: rateLimitConfig.bookingCreate.phoneBurstLimit, windowSec: rateLimitConfig.bookingCreate.phoneBurstWindowSec, maskedPhone, maskedIp },
                    { key: `booking-create:phone-daily:${phone}`, limit: rateLimitConfig.bookingCreate.phoneDailyLimit, windowSec: rateLimitConfig.bookingCreate.phoneDailyWindowSec, maskedPhone, maskedIp },
                ] : []),
                { key: `booking-create:ip-daily:${ip}`, limit: rateLimitConfig.bookingCreate.ipDailyLimit, windowSec: rateLimitConfig.bookingCreate.ipDailyWindowSec, maskedPhone, maskedIp },
            ];
        }

        if (policy === 'admin-verify') {
            return [
                { key: `admin-verify:ip:${ip}`, limit: rateLimitConfig.adminVerify.ipLimit, windowSec: rateLimitConfig.adminVerify.ipWindowSec, maskedPhone: 'unknown', maskedIp },
            ];
        }

        const isAdminUiRoute =
            routePath === '/admin' ||
            routePath.startsWith('/admin/') ||
            routePath.startsWith('/settings/admin.updates');

        if (isAdminUiRoute) {
            return [{
                key: `admin-ui:ip:${ip}:${req.method.toUpperCase()}:${routePath}`,
                limit: rateLimitConfig.adminUi.limit,
                windowSec: rateLimitConfig.adminUi.windowSec,
                maskedPhone,
                maskedIp,
            }];
        }

        return [{
            key: `global:ip:${ip}:${req.method.toUpperCase()}:${routePath}`,
            limit: rateLimitConfig.global.limit,
            windowSec: rateLimitConfig.global.windowSec,
            maskedPhone,
            maskedIp,
        }];
    }
}
