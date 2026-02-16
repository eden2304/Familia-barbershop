import { normalizePhone } from '../security.utils';

const toInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const rateLimitConfig = {
    redis: {
        url: process.env.REDIS_URL || '',
        prefix: process.env.RATE_LIMIT_PREFIX || 'familia:ratelimit',
    },
    global: {
        limit: toInt(process.env.RATE_LIMIT_GLOBAL_LIMIT, 300),
        windowSec: toInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_SEC, 60),
    },
    otpRequest: {
        phoneLimit: toInt(process.env.RATE_LIMIT_OTP_REQUEST_PHONE_LIMIT, 3),
        phoneWindowSec: toInt(process.env.RATE_LIMIT_OTP_REQUEST_PHONE_WINDOW_SEC, 600),
        ipLimit: toInt(process.env.RATE_LIMIT_OTP_REQUEST_IP_LIMIT, 10),
        ipWindowSec: toInt(process.env.RATE_LIMIT_OTP_REQUEST_IP_WINDOW_SEC, 600),
    },
    otpVerify: {
        phoneLimit: toInt(process.env.RATE_LIMIT_OTP_VERIFY_PHONE_LIMIT, 10),
        phoneWindowSec: toInt(process.env.RATE_LIMIT_OTP_VERIFY_PHONE_WINDOW_SEC, 600),
        ipLimit: toInt(process.env.RATE_LIMIT_OTP_VERIFY_IP_LIMIT, 30),
        ipWindowSec: toInt(process.env.RATE_LIMIT_OTP_VERIFY_IP_WINDOW_SEC, 600),
        failedLockThreshold: toInt(process.env.RATE_LIMIT_OTP_VERIFY_FAILED_THRESHOLD, 10),
        failedLockSec: toInt(process.env.RATE_LIMIT_OTP_VERIFY_FAILED_LOCK_SEC, 600),
    },
    availability: {
        ipLimit: toInt(process.env.RATE_LIMIT_AVAILABILITY_IP_LIMIT, 60),
        ipWindowSec: toInt(process.env.RATE_LIMIT_AVAILABILITY_IP_WINDOW_SEC, 60),
        phoneLimit: toInt(process.env.RATE_LIMIT_AVAILABILITY_PHONE_LIMIT, 120),
        phoneWindowSec: toInt(process.env.RATE_LIMIT_AVAILABILITY_PHONE_WINDOW_SEC, 300),
    },
    bookingCreate: {
        phoneBurstLimit: toInt(process.env.RATE_LIMIT_BOOKING_PHONE_BURST_LIMIT, 3),
        phoneBurstWindowSec: toInt(process.env.RATE_LIMIT_BOOKING_PHONE_BURST_WINDOW_SEC, 300),
        phoneDailyLimit: toInt(process.env.RATE_LIMIT_BOOKING_PHONE_DAILY_LIMIT, 5),
        phoneDailyWindowSec: toInt(process.env.RATE_LIMIT_BOOKING_PHONE_DAILY_WINDOW_SEC, 86400),
        ipDailyLimit: toInt(process.env.RATE_LIMIT_BOOKING_IP_DAILY_LIMIT, 20),
        ipDailyWindowSec: toInt(process.env.RATE_LIMIT_BOOKING_IP_DAILY_WINDOW_SEC, 86400),
    },
    adminVerify: {
        ipLimit: toInt(process.env.RATE_LIMIT_ADMIN_VERIFY_IP_LIMIT, 20),
        ipWindowSec: toInt(process.env.RATE_LIMIT_ADMIN_VERIFY_IP_WINDOW_SEC, 3600),
        failedLockThreshold: toInt(process.env.RATE_LIMIT_ADMIN_VERIFY_FAILED_THRESHOLD, 10),
        failedLockSec: toInt(process.env.RATE_LIMIT_ADMIN_VERIFY_FAILED_LOCK_SEC, 300),
    },
    pushSubscribe: {
        ipLimit: toInt(process.env.RATE_LIMIT_PUSH_SUBSCRIBE_IP_LIMIT, 20),
        ipWindowSec: toInt(process.env.RATE_LIMIT_PUSH_SUBSCRIBE_IP_WINDOW_SEC, 300),
        phoneLimit: toInt(process.env.RATE_LIMIT_PUSH_SUBSCRIBE_PHONE_LIMIT, 10),
        phoneWindowSec: toInt(process.env.RATE_LIMIT_PUSH_SUBSCRIBE_PHONE_WINDOW_SEC, 300),
    },
    pushUnsubscribe: {
        ipLimit: toInt(process.env.RATE_LIMIT_PUSH_UNSUBSCRIBE_IP_LIMIT, 20),
        ipWindowSec: toInt(process.env.RATE_LIMIT_PUSH_UNSUBSCRIBE_IP_WINDOW_SEC, 300),
        phoneLimit: toInt(process.env.RATE_LIMIT_PUSH_UNSUBSCRIBE_PHONE_LIMIT, 10),
        phoneWindowSec: toInt(process.env.RATE_LIMIT_PUSH_UNSUBSCRIBE_PHONE_WINDOW_SEC, 300),
    },

};

export const normalizePhoneKey = (input: unknown): string => normalizePhone(String(input ?? '')) || '';
