process.env.UPSTASH_REDIS_REST_URL = 'http://mock-redis';
process.env.UPSTASH_REDIS_REST_TOKEN = 'token';

import { strict as assert } from 'assert';
import { HttpException } from '@nestjs/common';
import { RateLimitGuard } from '../src/common/rate-limit/rate-limit.guard';
import { RedisRateLimitStore } from '../src/common/rate-limit/redis-rate-limit.store';
import { getClientIp } from '../src/common/rate-limit/rate-limit.utils';

class ReflectorStub {
  constructor(private readonly policy: string) {}
  getAllAndOverride() { return this.policy; }
}

class StoreStub {
  public consumeResult = { totalHits: 1, remaining: 0, retryAfterSeconds: 5, resetSeconds: 5, isBlocked: true };
  async consume() { return this.consumeResult; }
}

class FailingStoreStub {
  async consume() { throw new Error('redis down'); }
}

(async () => {
  assert.equal(getClientIp({ headers: { 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' }, ip: '2.2.2.2', socket: { remoteAddress: '3.3.3.3' } } as any), '8.8.8.8');
  assert.equal(getClientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }, ip: '2.2.2.2', socket: { remoteAddress: '3.3.3.3' } } as any), '1.1.1.1');
  assert.equal(getClientIp({ headers: {}, ip: '2.2.2.2', socket: { remoteAddress: '3.3.3.3' } } as any), '2.2.2.2');

  const guard = new RateLimitGuard(new ReflectorStub('otp-request') as any, new StoreStub() as any);
  const checks = (guard as any).buildChecks('otp-request', {
    body: { phone: '+972-555-111222' },
    headers: {},
    ip: '1.2.3.4',
    method: 'POST',
  });
  assert.equal(checks[0].key, 'otp-request:phone:0555111222');

  const resHeaders: Record<string, string> = {};
  try {
    await guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', body: { phone: '0501234567' }, headers: {}, ip: '1.2.3.4', originalUrl: '/auth/request-code' }),
        getResponse: () => ({ setHeader: (k: string, v: string) => { resHeaders[k] = v; } }),
      }),
      getHandler: () => null,
      getClass: () => null,
    } as any);
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof HttpException);
    const payload = (e as HttpException).getResponse() as any;
    assert.equal(payload.error, 'RATE_LIMITED');
    assert.ok(Number(resHeaders['Retry-After']) > 0);
    assert.ok(Number(resHeaders['RateLimit-Reset']) > Math.floor(Date.now() / 1000));
  }

  const failOpenGuard = new RateLimitGuard(new ReflectorStub('global') as any, new FailingStoreStub() as any);
  const failOpenResult = await failOpenGuard.canActivate({
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', body: {}, headers: {}, ip: '5.6.7.8', originalUrl: '/services' }),
      getResponse: () => ({ setHeader: () => undefined }),
    }),
    getHandler: () => null,
    getClass: () => null,
  } as any);
  assert.equal(failOpenResult, true);

  const state = new Map<string, { value: number; ttl: number }>();
  global.fetch = (async (_url: string, init: any) => {
    const parts = JSON.parse(init.body)[0] as string[];
    const cmd = parts[0].toUpperCase();
    const key = parts[1];
    let result: any = 0;
    if (cmd === 'INCR') {
      const item = state.get(key) || { value: 0, ttl: 60 };
      item.value += 1;
      state.set(key, item);
      result = item.value;
    } else if (cmd === 'EXPIRE') {
      const item = state.get(key) || { value: 0, ttl: Number(parts[2]) };
      item.ttl = Number(parts[2]);
      state.set(key, item);
      result = 1;
    } else if (cmd === 'TTL') {
      result = state.get(key)?.ttl ?? -1;
    } else if (cmd === 'SET') {
      state.set(key, { value: 1, ttl: Number(parts[4]) });
      result = 'OK';
    } else if (cmd === 'DEL') {
      state.delete(key);
      result = 1;
    }
    return { ok: true, json: async () => [{ result }] } as any;
  }) as any;

  const redisStore = new RedisRateLimitStore();
  const first = await redisStore.consume('dist:key', 3, 60);
  const second = await redisStore.consume('dist:key', 3, 60);
  assert.equal(first.totalHits, 1);
  assert.equal(second.totalHits, 2);

  await redisStore.recordFailure('fail-ip', 'lock-ip', 2, 60, 300);
  const lock = await redisStore.recordFailure('fail-ip', 'lock-ip', 2, 60, 300);
  assert.equal(lock.locked, true);

  console.log('rate-limit tests passed');
})();
