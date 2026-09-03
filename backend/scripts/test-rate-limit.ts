process.env.REDIS_URL = 'redis://localhost:6379/0';

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

  // Authenticated admins must never be throttled, whatever the policy or store state.
  const adminBypassGuard = new RateLimitGuard(new ReflectorStub('booking-create') as any, new StoreStub() as any);
  for (const user of [{ roles: ['admin'] }, { isAdmin: true }, { roles: ['client', 'admin'] }]) {
    const adminResult = await adminBypassGuard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', body: { phone: '0501234567' }, headers: {}, ip: '1.2.3.4', originalUrl: '/appointments', user }),
        getResponse: () => ({ setHeader: () => undefined }),
      }),
      getHandler: () => null,
      getClass: () => null,
    } as any);
    assert.equal(adminResult, true, 'admin request must bypass rate limiting');
  }

  // A plain authenticated client is still subject to the limiter.
  try {
    await adminBypassGuard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', body: { phone: '0501234567' }, headers: {}, ip: '1.2.3.4', originalUrl: '/appointments', user: { roles: ['client'] } }),
        getResponse: () => ({ setHeader: () => undefined }),
      }),
      getHandler: () => null,
      getClass: () => null,
    } as any);
    assert.fail('client should still be throttled');
  } catch (e) {
    assert.ok(e instanceof HttpException);
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

  const redisStore = new RedisRateLimitStore();
  const state = new Map<string, { value: number; ttl: number; expireCalls: number }>();
  (redisStore as any).cmd = async (...command: string[]) => {
    const cmd = command[0].toUpperCase();
    const key = command[1];
    if (cmd === 'INCR') {
      const item = state.get(key) || { value: 0, ttl: -1, expireCalls: 0 };
      item.value += 1;
      state.set(key, item);
      return item.value;
    }
    if (cmd === 'EXPIRE') {
      const item = state.get(key) || { value: 0, ttl: -1, expireCalls: 0 };
      item.ttl = Number(command[2]);
      item.expireCalls += 1;
      state.set(key, item);
      return 1;
    }
    if (cmd === 'TTL') {
      return state.get(key)?.ttl ?? -1;
    }
    if (cmd === 'SET') {
      state.set(key, { value: 1, ttl: Number(command[4]), expireCalls: 0 });
      return 'OK';
    }
    if (cmd === 'DEL') {
      state.delete(key);
      return 1;
    }
    throw new Error(`Unsupported command: ${command.join(' ')}`);
  };

  const first = await redisStore.consume('dist:key', 2, 60);
  const second = await redisStore.consume('dist:key', 2, 60);
  const third = await redisStore.consume('dist:key', 2, 60);
  assert.equal(first.totalHits, 1);
  assert.equal(second.totalHits, 2);
  assert.equal(third.isBlocked, true);
  assert.equal(state.get('familia:ratelimit:dist:key')?.expireCalls, 1, 'EXPIRE should be called only on first hit');

  await redisStore.recordFailure('fail-ip', 'lock-ip', 2, 60, 300);
  const lock = await redisStore.recordFailure('fail-ip', 'lock-ip', 2, 60, 300);
  assert.equal(lock.locked, true);

  // Redis unreachable: every store method must degrade gracefully (fail-open)
  // instead of throwing, so clients and the admin never hit a 500/limiter error.
  const downStore = new RedisRateLimitStore();
  // Mirrors what the real cmd() throws to callers once it has tripped its
  // "redis is unreachable" breaker on a connection error.
  (downStore as any).cmd = async () => { throw new Error('RATE_LIMIT_REDIS_UNAVAILABLE'); };

  const downConsume = await downStore.consume('any:key', 5, 60);
  assert.equal(downConsume.isBlocked, false, 'consume must not block when redis is down');
  assert.equal(downConsume.remaining, 5, 'consume should report full budget when redis is down');

  assert.equal(await downStore.isLocked('admin-verify:lock:1.2.3.4'), 0, 'isLocked must return 0 when redis is down');

  const downFailure = await downStore.recordFailure('c', 'l', 2, 60, 300);
  assert.equal(downFailure.locked, false, 'recordFailure must not lock when redis is down');

  await downStore.lock('l', 10); // must not throw
  await downStore.clear('c'); // must not throw

  // Guard must let the request through when the store degrades.
  const degradedGuard = new RateLimitGuard(new ReflectorStub('admin-verify') as any, downStore as any);
  const degradedResult = await degradedGuard.canActivate({
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', body: {}, headers: {}, ip: '9.9.9.9', originalUrl: '/admin/verify-code' }),
      getResponse: () => ({ setHeader: () => undefined }),
    }),
    getHandler: () => null,
    getClass: () => null,
  } as any);
  assert.equal(degradedResult, true, 'guard must fail-open when redis is down');

  console.log('redis-down fail-open tests passed');

  console.log('rate-limit tests passed');
})();
