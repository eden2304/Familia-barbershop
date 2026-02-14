import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';
import { RedisRateLimitStore } from './redis-rate-limit.store';

@Global()
@Module({
    providers: [
        RedisRateLimitStore,
        { provide: APP_GUARD, useClass: RateLimitGuard },
    ],
    exports: [RedisRateLimitStore],
})
export class RateLimitModule {}
