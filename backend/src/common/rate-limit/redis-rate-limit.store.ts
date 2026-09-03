import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Socket } from 'net';
import * as tls from 'tls';
import { rateLimitConfig } from './rate-limit.config';

type PendingCommand = {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
};

type ParsedResp = { value: any; nextOffset: number };

// Keep these short: rate limiting must never add meaningful latency, and when
// Redis is unreachable we want to discover that fast and fall back to fail-open.
const CONNECT_TIMEOUT_MS = 1500;
const COMMAND_TIMEOUT_MS = 1500;

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

    private rejectAllPending(error: Error) {
        while (this.pending.length > 0) {
            this.pending.shift()?.reject(error);
        }
    }

    private teardownSocket(target: Socket | tls.TLSSocket | null) {
        if (!target) return;
        target.removeAllListeners();
        target.destroy();
        if (this.socket === target) {
            this.socket = null;
        }
    }

    private async ensureConnected(): Promise<void> {
        if (this.socket && !this.socket.destroyed) return;
        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = new Promise<void>((resolve, reject) => {
            let settled = false;
            let timer: NodeJS.Timeout | null = null;

            const clearTimer = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
            };

            const fail = (error: Error) => {
                if (settled) return;
                settled = true;
                clearTimer();
                this.teardownSocket(this.socket);
                this.rejectAllPending(error);
                reject(error);
            };

            const succeed = () => {
                if (settled) return;
                settled = true;
                clearTimer();
                resolve();
            };

            try {
                const parsed = new URL(this.redisUrl);
                const isTls = parsed.protocol === 'rediss:';
                const host = parsed.hostname;
                const port = Number(parsed.port || 6379);
                const db = parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.replace('/', '')) : 0;
                const username = decodeURIComponent(parsed.username || '');
                const password = decodeURIComponent(parsed.password || '');

                timer = setTimeout(() => fail(new Error('Redis connection timeout')), CONNECT_TIMEOUT_MS);

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
                        succeed();
                    } catch (error) {
                        fail(error instanceof Error ? error : new Error('Redis auth/select failed'));
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
                    if (settled) {
                        // Error after a successful connect: drop the socket so the
                        // next command reconnects, and reject anything in flight.
                        this.rejectAllPending(error);
                        this.teardownSocket(socket);
                    } else {
                        fail(error);
                    }
                });
                socket.on('close', () => {
                    this.rejectAllPending(new Error('Redis socket closed'));
                    if (this.socket === socket) {
                        this.socket = null;
                    }
                });

                socket.once('connect', () => {
                    void onConnected();
                });
            } catch (error) {
                fail(error instanceof Error ? error : new Error('Redis connection setup failed'));
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
            let timer: NodeJS.Timeout | null = null;

            const entry: PendingCommand = {
                resolve: (value) => {
                    if (timer) clearTimeout(timer);
                    resolve(value);
                },
                reject: (error) => {
                    if (timer) clearTimeout(timer);
                    reject(error);
                },
            };

            const drop = () => {
                const idx = this.pending.indexOf(entry);
                if (idx !== -1) this.pending.splice(idx, 1);
            };

            timer = setTimeout(() => {
                drop();
                reject(new Error('Redis command timeout'));
            }, COMMAND_TIMEOUT_MS);

            this.pending.push(entry);
            this.socket!.write(this.encodeCommand(args), (error) => {
                if (error) {
                    drop();
                    if (timer) clearTimeout(timer);
                    reject(error);
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

// While Redis is unreachable we pause talking to it for this long, then let a
// single request probe it again. This keeps request latency flat during an
// outage (no per-request connect attempts) and recovers automatically.
const UNAVAILABLE_COOLDOWN_MS = 30_000;

@Injectable()
export class RedisRateLimitStore implements OnApplicationShutdown {
    private readonly logger = new Logger(RedisRateLimitStore.name);
    private static sharedClient: RedisTcpClient | null = null;
    // Permanent (until restart): the URL/credentials are wrong, retrying is pointless.
    private static disabledByAuthFailure = false;
    // Transient: Redis is down/unreachable. Auto-clears once it answers again.
    private static unavailableUntil = 0;
    private static loggedUnavailable = false;

    private get enabled(): boolean {
        return Boolean(rateLimitConfig.redis.url) && !RedisRateLimitStore.disabledByAuthFailure;
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

    private get inCooldown(): boolean {
        return Date.now() < RedisRateLimitStore.unavailableUntil;
    }

    private tripUnavailable(message: string) {
        RedisRateLimitStore.unavailableUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
        if (!RedisRateLimitStore.loggedUnavailable) {
            RedisRateLimitStore.loggedUnavailable = true;
            this.logger.warn(JSON.stringify({
                event: 'rate_limit_redis_unavailable',
                message,
                note: `pausing redis rate limiting for ${UNAVAILABLE_COOLDOWN_MS / 1000}s; requests fail-open`,
            }));
        }
    }

    private clearUnavailable() {
        if (RedisRateLimitStore.unavailableUntil || RedisRateLimitStore.loggedUnavailable) {
            this.logger.log(JSON.stringify({ event: 'rate_limit_redis_recovered' }));
        }
        RedisRateLimitStore.unavailableUntil = 0;
        RedisRateLimitStore.loggedUnavailable = false;
    }

    private async cmd(...command: (string | number)[]): Promise<any> {
        if (RedisRateLimitStore.disabledByAuthFailure) {
            throw new Error('RATE_LIMIT_REDIS_DISABLED');
        }
        if (!this.enabled) {
            throw new Error('RATE_LIMIT_REDIS_UNAVAILABLE');
        }
        if (this.inCooldown) {
            throw new Error('RATE_LIMIT_REDIS_UNAVAILABLE');
        }
        try {
            const result = await this.client.command(command.map((item) => String(item)));
            if (RedisRateLimitStore.unavailableUntil || RedisRateLimitStore.loggedUnavailable) {
                this.clearUnavailable();
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('NOAUTH') || message.includes('WRONGPASS')) {
                if (!RedisRateLimitStore.disabledByAuthFailure) {
                    this.logger.error(JSON.stringify({
                        event: 'rate_limit_redis_error',
                        action: 'auth',
                        message,
                        note: 'disabling redis limiter until restart to prevent log spam',
                    }));
                }
                RedisRateLimitStore.disabledByAuthFailure = true;
                throw new Error('RATE_LIMIT_REDIS_DISABLED');
            }
            // Connection refused / timeout / socket closed / etc: Redis is
            // effectively down. Pause and let callers fall back to fail-open.
            this.tripUnavailable(message);
            throw new Error('RATE_LIMIT_REDIS_UNAVAILABLE');
        }
    }

    private isDegraded(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        return message === 'RATE_LIMIT_REDIS_DISABLED' || message === 'RATE_LIMIT_REDIS_UNAVAILABLE';
    }

    private withPrefix(key: string): string {
        return `${rateLimitConfig.redis.prefix}:${key}`;
    }

    async consume(key: string, limit: number, windowSec: number): Promise<ConsumeResult> {
        try {
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
        } catch (error) {
            if (!this.isDegraded(error)) {
                this.logger.error(JSON.stringify({ event: 'rate_limit_redis_error', action: 'consume', message: String(error) }));
            }
            // Fail-open: never block a real user because the limiter is unavailable.
            return {
                totalHits: 0,
                remaining: limit,
                retryAfterSeconds: 0,
                resetSeconds: 0,
                isBlocked: false,
            };
        }
    }

    async isLocked(key: string): Promise<number> {
        try {
            const redisKey = this.withPrefix(key);
            const ttl = Number(await this.cmd('TTL', redisKey));
            return ttl > 0 ? ttl : 0;
        } catch (error) {
            if (!this.isDegraded(error)) {
                this.logger.error(JSON.stringify({ event: 'rate_limit_redis_error', action: 'isLocked', message: String(error) }));
            }
            return 0;
        }
    }

    async lock(key: string, lockSec: number): Promise<void> {
        try {
            const redisKey = this.withPrefix(key);
            await this.cmd('SET', redisKey, '1', 'EX', lockSec);
        } catch (error) {
            if (!this.isDegraded(error)) {
                this.logger.error(JSON.stringify({ event: 'rate_limit_redis_error', action: 'lock', message: String(error) }));
            }
        }
    }

    async recordFailure(counterKey: string, lockKey: string, threshold: number, windowSec: number, lockSec: number): Promise<{ count: number; locked: boolean; retryAfterSeconds: number }> {
        try {
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
        } catch (error) {
            if (!this.isDegraded(error)) {
                this.logger.error(JSON.stringify({ event: 'rate_limit_redis_error', action: 'recordFailure', message: String(error) }));
            }
            return { count: 0, locked: false, retryAfterSeconds: 0 };
        }
    }

    async clear(key: string): Promise<void> {
        try {
            await this.cmd('DEL', this.withPrefix(key));
        } catch (error) {
            if (!this.isDegraded(error)) {
                this.logger.error(JSON.stringify({ event: 'rate_limit_redis_error', action: 'clear', message: String(error) }));
            }
        }
    }

    async onApplicationShutdown(): Promise<void> {
        RedisRateLimitStore.unavailableUntil = 0;
        RedisRateLimitStore.loggedUnavailable = false;
        if (!RedisRateLimitStore.sharedClient) return;
        await RedisRateLimitStore.sharedClient.quit();
        RedisRateLimitStore.sharedClient = null;
        RedisRateLimitStore.disabledByAuthFailure = false;
    }
}
