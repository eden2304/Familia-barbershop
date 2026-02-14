import { Injectable, Logger } from '@nestjs/common';
import { rateLimitConfig } from './rate-limit.config';

export type ConsumeResult = {
    totalHits: number;
    remaining: number;
    retryAfterSeconds: number;
    resetSeconds: number;
    isBlocked: boolean;
};

@Injectable()
export class RedisRateLimitStore {
    private readonly logger = new Logger(RedisRateLimitStore.name);

    private get enabled(): boolean {
        return Boolean(rateLimitConfig.redis.restUrl && rateLimitConfig.redis.restToken);
    }

    private async cmd(...command: (string | number)[]): Promise<any> {
        if (!this.enabled) throw new Error('Redis REST is not configured');
        const response = await fetch(rateLimitConfig.redis.restUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${rateLimitConfig.redis.restToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify([command.map((c) => String(c))]),
        });
        if (!response.ok) {
            throw new Error(`Redis REST request failed (${response.status})`);
        }
        const json = await response.json() as Array<{ result?: any; error?: string }>;
        if (json?.[0]?.error) {
            throw new Error(json[0].error);
        }
        return json?.[0]?.result;
    }

    private withPrefix(key: string): string {
        return `${rateLimitConfig.redis.prefix}:${key}`;
    }

    async consume(key: string, limit: number, windowSec: number): Promise<ConsumeResult> {
        if (!this.enabled) {
            this.logger.error('RATE_LIMIT_REDIS_MISSING_CONFIG');
            throw new Error('Rate limiter Redis config missing');
        }

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
}
