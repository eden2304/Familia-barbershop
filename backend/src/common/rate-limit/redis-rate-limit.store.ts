import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { rateLimitConfig } from './rate-limit.config';

export type ConsumeResult = {
    totalHits: number;
    remaining: number;
    retryAfterSeconds: number;
    resetSeconds: number;
    isBlocked: boolean;
};

@Injectable()
export class RedisRateLimitStore implements OnApplicationShutdown {
    private readonly logger = new Logger(RedisRateLimitStore.name);
    private static sharedClient: Redis | null = null;
    private static pingPromise: Promise<void> | null = null;

    private get enabled(): boolean {
        return Boolean(process.env.REDIS_URL);
    }

    constructor() {
        const hasPassword = this.hasPasswordInRedisUrl(process.env.REDIS_URL);
        this.logger.log(`RateLimit redis enabled=${this.enabled} hasPassword=${hasPassword}`);
    }

    private hasPasswordInRedisUrl(redisUrl: string | undefined): boolean {
        if (!redisUrl) return false;
        try {
            const parsed = new URL(redisUrl);
            return Boolean(parsed.password);
        } catch {
            return false;
        }
    }

    private async ensureRedisPing(): Promise<void> {
        if (!this.enabled || !RedisRateLimitStore.sharedClient) return;
        if (!RedisRateLimitStore.pingPromise) {
            RedisRateLimitStore.pingPromise = RedisRateLimitStore.sharedClient.ping()
                .then(() => undefined)
                .catch((error) => {
                    this.logger.error(JSON.stringify({
                        event: 'rate_limit_redis_error',
                        action: 'ping',
                        message: error instanceof Error ? error.message : 'unknown',
                    }));
                });
        }
        await RedisRateLimitStore.pingPromise;
    }

    private get client(): Redis {
        if (!this.enabled) {
            throw new Error('Rate limiter REDIS_URL is not configured');
        }
        if (!RedisRateLimitStore.sharedClient) {
            const redis = new Redis(process.env.REDIS_URL, {
                lazyConnect: false,
                maxRetriesPerRequest: null,
                enableReadyCheck: true,
            });
            RedisRateLimitStore.sharedClient = redis;
        }
        return RedisRateLimitStore.sharedClient;
    }

    private async cmd(...command: (string | number)[]): Promise<any> {
        const args = command.map((item) => String(item));
        const client = this.client;
        await this.ensureRedisPing();
        return client.call(...args);
    }

    private withPrefix(key: string): string {
        return `${rateLimitConfig.redis.prefix}:${key}`;
    }

    async consume(key: string, limit: number, windowSec: number): Promise<ConsumeResult> {
        const redisKey = this.withPrefix(key);
        const totalHits = Number(await this.cmd('INCR', redisKey));
        if (totalHits === 1) {
            await this.cmd('EXPIRE', redisKey, windowSec);
        }
        const ttl = Math.max(1, Number(await this.cmd('TTL', redisKey)));
        const remaining = Math.max(0, limit - totalHits);
        const isBlocked = totalHits > limit;

        return {
            totalHits,
            remaining,
            retryAfterSeconds: ttl,
            resetSeconds: ttl,
            isBlocked,
        };
    }

    async isLocked(key: string): Promise<number> {
        const redisKey = this.withPrefix(key);
        const ttl = Number(await this.cmd('TTL', redisKey));
        return ttl > 0 ? ttl : 0;
    }

    async lock(key: string, lockSec: number): Promise<void> {
        const redisKey = this.withPrefix(key);
        await this.cmd('SET', redisKey, '1', 'EX', lockSec);
    }

    async recordFailure(counterKey: string, lockKey: string, threshold: number, windowSec: number, lockSec: number): Promise<{ count: number; locked: boolean; retryAfterSeconds: number }> {
        const failRedisKey = this.withPrefix(counterKey);
        const count = Number(await this.cmd('INCR', failRedisKey));
        if (count === 1) {
            await this.cmd('EXPIRE', failRedisKey, windowSec);
        }

        if (count >= threshold) {
            await this.lock(lockKey, lockSec);
            return { count, locked: true, retryAfterSeconds: lockSec };
        }

        return { count, locked: false, retryAfterSeconds: 0 };
    }

    async clear(key: string): Promise<void> {
        await this.cmd('DEL', this.withPrefix(key));
    }

    async onApplicationShutdown(): Promise<void> {
        if (!RedisRateLimitStore.sharedClient) return;
        await RedisRateLimitStore.sharedClient.quit();
        RedisRateLimitStore.sharedClient = null;
        RedisRateLimitStore.pingPromise = null;
    }
}
