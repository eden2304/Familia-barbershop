import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Socket } from 'net';
import * as tls from 'tls';
import { rateLimitConfig } from './rate-limit.config';

type PendingCommand = {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
};

type ParsedResp = { value: any; nextOffset: number };

class RedisTcpClient {
    private socket: Socket | tls.TLSSocket | null = null;
    private readonly pending: PendingCommand[] = [];
    private readBuffer = Buffer.alloc(0);
    private connectPromise: Promise<void> | null = null;

    constructor(private readonly redisUrl: string) {}

    private parseResp(offset = 0): ParsedResp | null {
        if (!this.readBuffer.length || this.readBuffer.length <= offset) return null;
        const marker = String.fromCharCode(this.readBuffer[offset]);

        const readLine = (start: number): { line: string; nextOffset: number } | null => {
            const idx = this.readBuffer.indexOf('\r\n', start);
            if (idx === -1) return null;
            return {
                line: this.readBuffer.toString('utf8', start, idx),
                nextOffset: idx + 2,
            };
        };

        if (marker === '+' || marker === '-' || marker === ':') {
            const line = readLine(offset + 1);
            if (!line) return null;
            if (marker === '+') return { value: line.line, nextOffset: line.nextOffset };
            if (marker === '-') return { value: new Error(line.line), nextOffset: line.nextOffset };
            return { value: Number(line.line), nextOffset: line.nextOffset };
        }

        if (marker === '$') {
            const line = readLine(offset + 1);
            if (!line) return null;
            const len = Number(line.line);
            if (len === -1) return { value: null, nextOffset: line.nextOffset };
            const end = line.nextOffset + len;
            if (this.readBuffer.length < end + 2) return null;
            const value = this.readBuffer.toString('utf8', line.nextOffset, end);
            return { value, nextOffset: end + 2 };
        }

        if (marker === '*') {
            const line = readLine(offset + 1);
            if (!line) return null;
            const count = Number(line.line);
            if (count === -1) return { value: null, nextOffset: line.nextOffset };
            const arr: any[] = [];
            let next = line.nextOffset;
            for (let i = 0; i < count; i += 1) {
                const parsed = this.parseResp(next);
                if (!parsed) return null;
                arr.push(parsed.value);
                next = parsed.nextOffset;
            }
            return { value: arr, nextOffset: next };
        }

        throw new Error('Invalid Redis RESP response');
    }

    private flushPending() {
        while (this.pending.length > 0) {
            const parsed = this.parseResp();
            if (!parsed) break;
            this.readBuffer = this.readBuffer.subarray(parsed.nextOffset);
            const cmd = this.pending.shift();
            if (!cmd) break;
            if (parsed.value instanceof Error) {
                cmd.reject(parsed.value);
            } else {
                cmd.resolve(parsed.value);
            }
        }
    }

    private encodeCommand(args: string[]): Buffer {
        const chunks: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
        for (const arg of args) {
            const str = String(arg);
            chunks.push(Buffer.from(`$${Buffer.byteLength(str)}\r\n${str}\r\n`));
        }
        return Buffer.concat(chunks);
    }

    private async ensureConnected(): Promise<void> {
        if (this.socket && !this.socket.destroyed) return;
        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = new Promise<void>((resolve, reject) => {
            try {
                const parsed = new URL(this.redisUrl);
                const isTls = parsed.protocol === 'rediss:';
                const host = parsed.hostname;
                const port = Number(parsed.port || 6379);
                const db = parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.replace('/', '')) : 0;
                const username = decodeURIComponent(parsed.username || '');
                const password = decodeURIComponent(parsed.password || '');

                const onConnected = async () => {
                    try {
                        if (password) {
                            if (username) {
                                await this.command(['AUTH', username, password]);
                            } else {
                                await this.command(['AUTH', password]);
                            }
                        }
                        if (db > 0) {
                            await this.command(['SELECT', String(db)]);
                        }
                        resolve();
                    } catch (error) {
                        reject(error instanceof Error ? error : new Error('Redis auth/select failed'));
                    }
                };

                const socket = isTls
                    ? tls.connect({ host, port, servername: host })
                    : new Socket().connect({ host, port });
                this.socket = socket;

                socket.on('data', (data) => {
                    this.readBuffer = Buffer.concat([this.readBuffer, data]);
                    this.flushPending();
                });
                socket.on('error', (error) => {
                    while (this.pending.length > 0) {
                        this.pending.shift()?.reject(error);
                    }
                });
                socket.on('close', () => {
                    while (this.pending.length > 0) {
                        this.pending.shift()?.reject(new Error('Redis socket closed'));
                    }
                    this.socket = null;
                });

                socket.once('connect', () => {
                    void onConnected();
                });
                socket.once('error', (error) => reject(error));
            } catch (error) {
                reject(error instanceof Error ? error : new Error('Redis connection setup failed'));
            }
        }).finally(() => {
            this.connectPromise = null;
        });

        return this.connectPromise;
    }

    async command(args: string[]): Promise<any> {
        await this.ensureConnected();
        if (!this.socket || this.socket.destroyed) {
            throw new Error('Redis socket is unavailable');
        }

        return new Promise<any>((resolve, reject) => {
            this.pending.push({ resolve, reject });
            this.socket!.write(this.encodeCommand(args), (error) => {
                if (error) {
                    const pending = this.pending.pop();
                    pending?.reject(error);
                }
            });
        });
    }

    async quit(): Promise<void> {
        if (!this.socket || this.socket.destroyed) return;
        try {
            await this.command(['QUIT']);
        } catch {
            // ignore on shutdown
        }
        this.socket.end();
        this.socket.destroy();
        this.socket = null;
    }
}

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
    private static sharedClient: RedisTcpClient | null = null;

    private get enabled(): boolean {
        return Boolean(rateLimitConfig.redis.url);
    }

    constructor() {
        const hasPassword = this.hasPasswordInRedisUrl(rateLimitConfig.redis.url);
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

    private get client(): RedisTcpClient {
        if (!this.enabled) {
            throw new Error('Rate limiter REDIS_URL is not configured');
        }
        if (!RedisRateLimitStore.sharedClient) {
            RedisRateLimitStore.sharedClient = new RedisTcpClient(rateLimitConfig.redis.url);
        }
        return RedisRateLimitStore.sharedClient;
    }

    private async cmd(...command: (string | number)[]): Promise<any> {
        return this.client.command(command.map((item) => String(item)));
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
    }
}
