import { Injectable, Logger } from '@nestjs/common';

interface VerificationSendResult {
    ok: boolean;
    messageId?: string;
    error?: string;
}

interface RateLimitBucket {
    count: number;
    windowStart: number;
}

@Injectable()
export class WhatsAppAuthService {
    private readonly logger = new Logger(WhatsAppAuthService.name);
    private readonly token = process.env.WHATSAPP_TOKEN || '';
    private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    private readonly templateName = process.env.WHATSAPP_AUTH_TEMPLATE_NAME || 'verification_code';
    private readonly templateLang = process.env.WHATSAPP_AUTH_TEMPLATE_LANG || 'he';

    private readonly endpoint = `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`;
    private readonly timeoutMs = 10_000;
    private readonly maxAttempts = 2; // first attempt + 1 automatic retry

    // Basic anti-abuse guard: max 5 sends per phone each 10 minutes.
    private readonly rateLimitMax = 5;
    private readonly rateLimitWindowMs = 10 * 60 * 1000;
    private readonly rateLimit = new Map<string, RateLimitBucket>();

    async sendVerificationCode(phone: string, code: string): Promise<VerificationSendResult> {
        if (!/^\d{4}$/.test(String(code || ''))) {
            return { ok: false, error: 'invalid_code_format' };
        }

        const normalizedPhone = this.normalizeIsraeliPhone(phone);
        if (!normalizedPhone) {
            return { ok: false, error: 'invalid_phone_format' };
        }

        if (!this.isAllowedByRateLimit(normalizedPhone)) {
            this.logger.warn(`Rate limit exceeded for ${normalizedPhone}`);
            return { ok: false, error: 'rate_limited' };
        }

        if (!this.token || !this.phoneNumberId) {
            this.logger.error('Missing WhatsApp Cloud API credentials: WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID');
            return { ok: false, error: 'missing_whatsapp_configuration' };
        }

        const payload = this.buildAuthPayload(normalizedPhone, code);
        let lastError = 'unknown_error';

        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            try {
                const response = await this.postWithTimeout(payload);
                const responseBody = await this.safeJson(response);

                if (response.ok) {
                    const messageId = responseBody?.messages?.[0]?.id;
                    return messageId ? { ok: true, messageId } : { ok: true };
                }

                lastError = this.extractError(response.status, responseBody);
                this.logger.error(
                    `WhatsApp auth template send failed (attempt ${attempt}/${this.maxAttempts}): ${lastError}`,
                );
            } catch (error: any) {
                lastError = error?.message || 'network_error';
                this.logger.error(
                    `WhatsApp auth template request error (attempt ${attempt}/${this.maxAttempts}): ${lastError}`,
                );
            }
        }

        return { ok: false, error: lastError };
    }

    private buildAuthPayload(to: string, code: string) {
        return {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
                name: this.templateName,
                language: { code: this.templateLang },
                components: [
                    {
                        type: 'button',
                        sub_type: 'copy_code',
                        index: '0',
                        parameters: [
                            {
                                type: 'text',
                                text: code,
                            },
                        ],
                    },
                ],
            },
        };
    }

    private normalizeIsraeliPhone(phone: string): string | null {
        const digits = String(phone || '').replace(/\D/g, '');
        if (!digits) return null;

        if (digits.startsWith('05') && digits.length === 10) {
            return `972${digits.slice(1)}`;
        }

        if (digits.startsWith('9725') && digits.length === 12) {
            return digits;
        }

        return null;
    }

    private isAllowedByRateLimit(phone: string): boolean {
        const now = Date.now();
        const bucket = this.rateLimit.get(phone);

        if (!bucket || now - bucket.windowStart >= this.rateLimitWindowMs) {
            this.rateLimit.set(phone, { count: 1, windowStart: now });
            return true;
        }

        if (bucket.count >= this.rateLimitMax) {
            return false;
        }

        bucket.count += 1;
        this.rateLimit.set(phone, bucket);
        return true;
    }

    private async postWithTimeout(payload: Record<string, any>): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            return await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    private async safeJson(response: Response): Promise<any> {
        const text = await response.text();
        if (!text) return null;

        try {
            return JSON.parse(text);
        } catch {
            return { raw: text };
        }
    }

    private extractError(status: number, responseBody: any): string {
        if (responseBody?.error?.message) return responseBody.error.message;
        if (responseBody?.raw) return `http_${status}: ${responseBody.raw}`;
        return `http_${status}`;
    }
}
