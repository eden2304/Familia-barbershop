import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_POLICY_KEY = 'rate_limit_policy';

export type RateLimitPolicyName =
  | 'otp-request'
  | 'otp-verify'
  | 'booking-available'
  | 'booking-create'
  | 'admin-verify'
  | 'push-subscribe'
  | 'push-unsubscribe'
  | 'global';

export const RateLimitPolicy = (policy: RateLimitPolicyName) => SetMetadata(RATE_LIMIT_POLICY_KEY, policy);
