import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type AuthTemplateMode = 'body_only' | 'button_only' | 'body_and_button';
type ButtonParamMode = 'text' | 'coupon_code' | 'payload';

interface VerificationSendResult {
    ok: boolean;
    messageId?: string;
    error?: string;
    metaError?: string;
    code?: number;
}

interface RateLimitBucket {
    count: number;
    windowStart: number;
}

interface MetaErrorDetails {
    message: string;
    code?: number;
}

interface ComponentBuildResult {
    components: Array<Record<string, any>>;
    included: Array<'body' | 'button'>;
    mode: AuthTemplateMode;
}

const DEFAULT_TEMPLATE_MODE: AuthTemplateMode = 'body_and_button';
const DEFAULT_BUTTON_PARAM_MODE: ButtonParamMode = 'text';

function resolveTemplateMode(rawMode: string | undefined): AuthTemplateMode {
    const mode = String(rawMode || DEFAULT_TEMPLATE_MODE).trim().toLowerCase();
    if (mode === 'body_only' || mode === 'button_only' || mode === 'body_and_button') {
        return mode;
    }
    return DEFAULT_TEMPLATE_MODE;
}

function resolveButtonParamMode(rawMode: string | undefined): ButtonParamMode {
    const mode = String(rawMode || DEFAULT_BUTTON_PARAM_MODE).trim().toLowerCase();
    if (mode === 'text' || mode === 'coupon_code' || mode === 'payload') {
        return mode;
    }
    return DEFAULT_BUTTON_PARAM_MODE;
}

function getModeCandidates(preferredMode: AuthTemplateMode): AuthTemplateMode[] {
    const allModes: AuthTemplateMode[] = ['body_and_button', 'body_only', 'button_only'];
    return [preferredMode, ...allModes.filter(mode => mode !== preferredMode)];
}

function getButtonParamCandidates(preferred: ButtonParamMode): ButtonParamMode[] {
    const all: ButtonParamMode[] = ['text', 'coupon_code', 'payload'];
    return [preferred, ...all.filter(mode => mode !== preferred)];
}

function usesButton(mode: AuthTemplateMode): boolean {
    return mode === 'button_only' || mode === 'body_and_button';
}

function createButtonParameter(code: string, paramMode: ButtonParamMode): Record<string, any> {
    if (paramMode === 'coupon_code') {
        return { type: 'coupon_code', coupon_code: code };
    }

    if (paramMode === 'payload') {
        return { type: 'payload', payload: code };
    }

    return { type: 'text', text: code };
}

export function buildAuthComponents(code: string, mode: AuthTemplateMode, buttonParamMode: ButtonParamMode): ComponentBuildResult {
    const components: Array<Record<string, any>> = [];
    const included: Array<'body' | 'button'> = [];

    if (mode === 'body_only' || mode === 'body_and_button') {
        components.push({
            type: 'body',
            parameters: [{ type: 'text', text: code }],
        });
        included.push('body');
    }

    if (mode === 'button_only' || mode === 'body_and_button') {
        components.push({
            type: 'button',
            sub_type: 'copy_code',
            index: '0',
            parameters: [createButtonParameter(code, buttonParamMode)],
        });
        included.push('button');
    }

    return { components, included, mode };
}

@Injectable()
export class WhatsAppAuthService {
    private readonly logger = new Logger(WhatsAppAuthService.name);
    private readonly timeoutMs = 10_000;
    private readonly maxAttempts = 2;
    private readonly rateLimitMax = 5;
    private readonly rateLimitWindowMs = 10 * 60 * 1000;
    private readonly rateLimit = new Map<string, RateLimitBucket>();

    constructor(private readonly configService: ConfigService) {}

    async sendVerificationCode(phone: string, code: string): Promise<VerificationSendResult> {
        try {
            if (!/^\d{4}$/.test(String(code || ''))) {
                return { ok: false, error: 'invalid_code_format' };
            }

            const normalizedPhone = this.normalizeIsraeliPhone(phone);
            if (!normalizedPhone) {
                return { ok: false, error: 'invalid_phone_format' };
            }

            if (!this.isAllowedByRateLimit(normalizedPhone)) {
                this.logger.warn(`WhatsApp auth rate limit exceeded: ${normalizedPhone}`);
                return { ok: false, error: 'rate_limited' };
            }

            const enabled = String(this.configService.get<string>('WHATSAPP_ENABLED') || '').toLowerCase() === 'true';
            if (!enabled) {
                this.logger.warn('WhatsApp auth send skipped because WHATSAPP_ENABLED is false');
                return { ok: true };
            }

            const token = this.configService.get<string>('WHATSAPP_TOKEN') || '';
            const phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID') || '';
            const templateName = this.configService.get<string>('WHATSAPP_AUTH_TEMPLATE_NAME') || 'verification_code';
            const templateLang = this.configService.get<string>('WHATSAPP_AUTH_TEMPLATE_LANG') || 'he';
            const mode = resolveTemplateMode(this.configService.get<string>('WHATSAPP_AUTH_TEMPLATE_MODE'));
            const buttonParamMode = resolveButtonParamMode(this.configService.get<string>('WHATSAPP_AUTH_BUTTON_PARAM_TYPE'));

            if (!token || !phoneNumberId) {
                this.logger.error('Missing WhatsApp auth config: WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID');
                return { ok: false, error: 'missing_whatsapp_configuration' };
            }

            const endpoint = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
            const modeCandidates = getModeCandidates(mode);
            let metaError: MetaErrorDetails = { message: 'unknown_error' };

            for (let modeIndex = 0; modeIndex < modeCandidates.length; modeIndex += 1) {
                const activeMode = modeCandidates[modeIndex];
                const buttonParamCandidates = usesButton(activeMode)
                    ? getButtonParamCandidates(buttonParamMode)
                    : [buttonParamMode];

                for (let paramIndex = 0; paramIndex < buttonParamCandidates.length; paramIndex += 1) {
                    const activeParamMode = buttonParamCandidates[paramIndex];
                    const payload = this.buildAuthPayload(
                        normalizedPhone,
                        code,
                        templateName,
                        templateLang,
                        activeMode,
                        activeParamMode,
                    );

                    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
                        try {
                            const response = await this.postWithTimeout(endpoint, token, payload);
                            const responseBody = await this.safeJson(response);

                            if (response.ok) {
                                const messageId = responseBody?.messages?.[0]?.id;
                                return messageId ? { ok: true, messageId } : { ok: true };
                            }

                            metaError = this.extractError(response.status, responseBody);
                            this.logger.error(
                                `WhatsApp auth send failed mode=${activeMode} buttonParam=${activeParamMode} (${attempt}/${this.maxAttempts}) code=${metaError.code ?? 'n/a'} error=${metaError.message}`,
                            );

                            if (this.isTemplateParamError(metaError.code)) {
                                const hasNextParam = paramIndex < buttonParamCandidates.length - 1;
                                const hasNextMode = modeIndex < modeCandidates.length - 1;

                                if (hasNextParam) {
                                    this.logger.warn(`Template parameter mismatch with buttonParam=${activeParamMode}. Trying next button parameter mode.`);
                                    break;
                                }

                                if (hasNextMode) {
                                    this.logger.warn(`Template parameter mismatch in mode=${activeMode}. Trying next template mode.`);
                                    break;
                                }
                            }
                        } catch (error: any) {
                            metaError = {
                                message: error?.name === 'AbortError' ? 'request_timeout' : error?.message || 'network_error',
                            };
                            this.logger.error(
                                `WhatsApp auth request failed mode=${activeMode} buttonParam=${activeParamMode} (${attempt}/${this.maxAttempts}): ${metaError.message}`,
                            );
                        }
                    }
                }
            }

            return { ok: false, error: 'whatsapp_send_failed', metaError: metaError.message, code: metaError.code };
        } catch (error: any) {
            const err = error?.message || 'unexpected_error';
            this.logger.error(`Unexpected WhatsApp auth service error: ${err}`);
            return { ok: false, error: 'whatsapp_send_failed', metaError: err };
        }
    }

    private buildAuthPayload(
        to: string,
        code: string,
        templateName: string,
        templateLang: string,
        mode: AuthTemplateMode,
        buttonParamMode: ButtonParamMode,
    ) {
        const { components, included } = buildAuthComponents(code, mode, buttonParamMode);
        this.logger.log(`WhatsApp auth payload mode=${mode} buttonParam=${buttonParamMode} components=${included.join('+') || 'none'}`);

        return {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
                name: templateName,
                language: { code: templateLang },
                components,
            },
        };
    }

    private normalizeIsraeliPhone(phone: string): string | null {
        const digits = String(phone || '').replace(/\D/g, '');
        if (!digits) return null;

        if (digits.startsWith('009725') && digits.length === 14) return digits.slice(2);
        if (digits.startsWith('9725') && digits.length === 12) return digits;
        if (digits.startsWith('05') && digits.length === 10) return `972${digits.slice(1)}`;
        if (digits.startsWith('5') && digits.length === 9) return `972${digits}`;
        return null;
    }

    private isAllowedByRateLimit(phone: string): boolean {
        const now = Date.now();
        const bucket = this.rateLimit.get(phone);

        if (!bucket || now - bucket.windowStart >= this.rateLimitWindowMs) {
            this.rateLimit.set(phone, { count: 1, windowStart: now });
            return true;
        }

        if (bucket.count >= this.rateLimitMax) return false;

        bucket.count += 1;
        this.rateLimit.set(phone, bucket);
        return true;
    }

    private async postWithTimeout(endpoint: string, token: string, payload: Record<string, any>): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            return await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
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

    private isTemplateParamError(code?: number): boolean {
        return code === 132000 || code === 132018 || code === 131008;
    }

    private extractError(status: number, responseBody: any): MetaErrorDetails {
        if (responseBody?.error?.message) {
            return {
                message: responseBody.error.message,
                code: Number.isFinite(Number(responseBody?.error?.code)) ? Number(responseBody.error.code) : undefined,
            };
        }
        if (responseBody?.raw) return { message: `http_${status}: ${responseBody.raw}` };
        return { message: `http_${status}` };
    }
}
