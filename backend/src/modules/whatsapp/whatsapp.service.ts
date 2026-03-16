import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { WhatsAppMessageLog } from '../../entities/whatsapp-message-log.entity';
import { WHATSAPP_TEMPLATES, WhatsAppTemplateName } from './whatsapp.constants';
import {
    formatDateForTemplate,
    formatTimeForTemplate,
    normalizeIsraeliPhoneToE164,
    sleep,
    toMetaRecipientFromE164,
} from './whatsapp.utils';

interface SendTemplateResult {
    ok: boolean;
    status: string;
    messageId: string | null;
    error: string | null;
}

interface AuthTemplateSpec {
    languageCode: string;
    hasBodyVariable: boolean;
}

@Injectable()
export class WhatsAppService {
    private readonly logger = new Logger(WhatsAppService.name);
    private readonly enabled = String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true';
    private readonly token = process.env.WHATSAPP_TOKEN || '';
    private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    private readonly wabaId = process.env.WHATSAPP_WABA_ID || '';
    private readonly defaultLang = process.env.WHATSAPP_DEFAULT_LANG || 'he';
    private readonly authTemplateName = process.env.WHATSAPP_AUTH_TEMPLATE_NAME || 'verification_code';
    private readonly authTemplateLanguage = process.env.WHATSAPP_AUTH_TEMPLATE_LANG || this.defaultLang;
    private readonly hasAuthTemplateLanguageOverride = Boolean(process.env.WHATSAPP_AUTH_TEMPLATE_LANG);
    private authTemplateSpecCache: AuthTemplateSpec | null = null;
    private readonly timeZone = process.env.WHATSAPP_TIMEZONE || 'Asia/Jerusalem';
    private readonly sendMaxAttempts = Math.max(1, Number(process.env.WHATSAPP_SEND_MAX_ATTEMPTS || 3));
    private readonly sendRequestTimeoutMs = Math.max(1000, Number(process.env.WHATSAPP_SEND_TIMEOUT_MS || 4000));
    private readonly retryBaseDelayMs = Math.max(50, Number(process.env.WHATSAPP_RETRY_BASE_DELAY_MS || 150));

    constructor(
        @InjectRepository(WhatsAppMessageLog) private readonly logRepo: Repository<WhatsAppMessageLog>,
    ) {}

    isEnabled(): boolean {
        return this.enabled;
    }

    getTimeZone(): string {
        return this.timeZone;
    }

    async sendAppointmentConfirmed(appointment: Appointment) {
        return this.sendAppointmentTemplate('appointment_approved', appointment, {
            appointmentId: appointment.id,
        });
    }

    async sendAppointmentReminderSameDay(appointment: Appointment) {
        const alreadySent = await this.logRepo.exist({
            where: { appointmentId: appointment.id, templateName: 'appointment_reminder_same_day' },
        });
        if (alreadySent) {
            return this.logSkipped('appointment_reminder_same_day', appointment, 'already_sent');
        }
        return this.sendAppointmentTemplate('appointment_reminder_same_day', appointment, {
            appointmentId: appointment.id,
        });
    }

    async sendAppointmentCanceled(appointment: Appointment) {
        return this.sendAppointmentTemplate('appointment_canceled', appointment, {
            appointmentId: appointment.id,
        });
    }

    async sendAppointmentRescheduled(appointment: Appointment, previousStart: Date) {
        const clientName = this.getClientName(appointment);
        const oldDate = formatDateForTemplate(previousStart, this.timeZone);
        const oldTime = formatTimeForTemplate(previousStart, this.timeZone);
        const newDate = formatDateForTemplate(appointment.startsAt, this.timeZone);
        const newTime = formatTimeForTemplate(appointment.startsAt, this.timeZone);

        return this.sendTemplateMessage({
            templateName: 'appointment_rescheduled',
            toPhone: this.getAppointmentPhone(appointment),
            params: [clientName, oldDate, oldTime, newDate, newTime],
            appointmentId: appointment.id,
        });
    }

    async sendAdminGeneralMessage(toPhone: string, messageText: string) {
        return this.sendTemplateMessage({
            templateName: 'general_message',
            toPhone,
            params: [messageText],
        });
    }

    async sendVerificationCodeTemplate(toPhone: string, code: string): Promise<SendTemplateResult> {
        const normalized = normalizeIsraeliPhoneToE164(toPhone || '');
        const recipientForMeta = normalized ? toMetaRecipientFromE164(normalized) : '';
        const authTemplateSpec = await this.resolveAuthTemplateSpec();
        const payload = this.buildAuthTemplatePayload(this.authTemplateName, recipientForMeta, code, authTemplateSpec);
        const safePayload = this.buildSafeAuthTemplatePayloadForLogging(payload);

        if (!normalized) {
            await this.saveLog({
                toPhone: toPhone || '',
                templateName: this.authTemplateName,
                payloadJson: safePayload,
                status: 'failed',
                metaMessageId: null,
                error: 'invalid_phone_auth_template',
                appointmentId: null,
            });
            this.logger.warn(`WhatsApp auth template skipped (invalid phone): template=${this.authTemplateName}, category=AUTHENTICATION`);
            return { ok: false, status: 'failed', messageId: null, error: 'invalid_phone_auth_template' };
        }

        if (!this.enabled) {
            await this.saveLog({
                toPhone: normalized,
                templateName: this.authTemplateName,
                payloadJson: safePayload,
                status: 'skipped',
                metaMessageId: null,
                error: 'disabled_auth_template',
                appointmentId: null,
            });
            this.logger.warn(`WhatsApp auth template disabled: template=${this.authTemplateName}, category=AUTHENTICATION`);
            return { ok: true, status: 'skipped', messageId: null, error: 'disabled_auth_template' };
        }

        if (!this.token || !this.phoneNumberId) {
            const error = 'missing_config_auth_template';
            await this.saveLog({
                toPhone: normalized,
                templateName: this.authTemplateName,
                payloadJson: safePayload,
                status: 'failed',
                metaMessageId: null,
                error,
                appointmentId: null,
            });
            this.logger.warn(`WhatsApp auth template config missing: template=${this.authTemplateName}, category=AUTHENTICATION`);
            return { ok: false, status: 'failed', messageId: null, error };
        }

        this.logger.log(`WhatsApp auth template send: template=${this.authTemplateName}, category=AUTHENTICATION, language=${authTemplateSpec.languageCode}, flow=COPY_CODE, bodyVariable=${authTemplateSpec.hasBodyVariable}`);

        const result = await this.sendWithRetries(payload);

        await this.saveLog({
            toPhone: normalized,
            templateName: this.authTemplateName,
            payloadJson: safePayload,
            status: result.status,
            metaMessageId: result.messageId,
            error: result.error,
            appointmentId: null,
        });

        if (!result.ok) {
            this.logger.warn(`WhatsApp auth template send failed: template=${this.authTemplateName}, category=AUTHENTICATION, error=${result.error}`);
        }

        return result;
    }

    async sendAuthCode(toPhone: string, code: string) {
        return this.sendVerificationCodeTemplate(toPhone, code);
    }

    async sendAdminAppointmentMessage(appointment: Appointment, messageText: string) {
        const clientName = this.getClientName(appointment);
        const date = formatDateForTemplate(appointment.startsAt, this.timeZone);
        const time = formatTimeForTemplate(appointment.startsAt, this.timeZone);

        return this.sendTemplateMessage({
            templateName: 'admin_appointment_message',
            toPhone: this.getAppointmentPhone(appointment),
            params: [clientName, date, time, messageText],
            appointmentId: appointment.id,
        });
    }

    async sendFixedAppointment(toPhone: string, clientName: string, frequency: string, dayOfWeek: string, time: string) {
        return this.sendTemplateMessage({
            templateName: 'fixed_appointment',
            toPhone,
            params: [clientName, frequency, dayOfWeek, time],
        });
    }

    async sendDeleteFixedAppointment(toPhone: string, clientName: string, frequency: string, dayOfWeek: string, time: string) {
        return this.sendTemplateMessage({
            templateName: 'delete_fixed',
            toPhone,
            params: [clientName, frequency, dayOfWeek, time],
        });
    }

    private async sendAppointmentTemplate(
        templateName: 'appointment_approved' | 'appointment_reminder_same_day' | 'appointment_canceled',
        appointment: Appointment,
        opts: { appointmentId?: string } = {},
    ) {
        const clientName = this.getClientName(appointment);
        const date = formatDateForTemplate(appointment.startsAt, this.timeZone);
        const time = formatTimeForTemplate(appointment.startsAt, this.timeZone);

        return this.sendTemplateMessage({
            templateName,
            toPhone: this.getAppointmentPhone(appointment),
            params: [clientName, date, time],
            appointmentId: opts.appointmentId ?? appointment.id,
        });
    }

    private getClientName(appointment: Appointment): string {
        const client: any = appointment.client || {};
        const first = client.firstName ?? client.first_name ?? '';
        const last = client.lastName ?? client.last_name ?? '';
        return [first, last].filter(Boolean).join(' ').trim();
    }

    private getAppointmentPhone(appointment: Appointment): string {
        const client: any = appointment.client || {};
        return client.phone ?? client.client_phone ?? '';
    }

    private async logSkipped(templateName: WhatsAppTemplateName, appointment: Appointment, reason: string) {
        const toPhone = this.getAppointmentPhone(appointment);
        const normalized = normalizeIsraeliPhoneToE164(toPhone || '') || '';
        const log = this.logRepo.create({
            toPhone: normalized || toPhone || '',
            templateName,
            payloadJson: { skipped: true, reason },
            status: 'skipped',
            metaMessageId: null,
            error: reason,
            appointmentId: appointment.id,
        });
        await this.logRepo.save(log);
        return { ok: true, status: 'skipped', messageId: null, error: reason };
    }

    private async sendTemplateMessage(params: {
        templateName: WhatsAppTemplateName;
        toPhone: string;
        params: string[];
        appointmentId?: string | null;
    }): Promise<SendTemplateResult> {
        const template = WHATSAPP_TEMPLATES[params.templateName];
        if (!template) {
            return { ok: false, status: 'failed', messageId: null, error: 'unknown_template' };
        }

        if (params.params.length !== template.params.length) {
            return { ok: false, status: 'failed', messageId: null, error: 'invalid_template_params' };
        }

        const normalized = normalizeIsraeliPhoneToE164(params.toPhone || '');
        const recipientForMeta = normalized ? toMetaRecipientFromE164(normalized) : '';
        const payload = this.buildTemplatePayload(template.name, recipientForMeta, params.params);

        if (!normalized) {
            await this.saveLog({
                toPhone: params.toPhone || '',
                templateName: template.name,
                payloadJson: payload,
                status: 'failed',
                metaMessageId: null,
                error: 'invalid_phone',
                appointmentId: params.appointmentId ?? null,
            });
            this.logger.warn(`WhatsApp skipped (invalid phone): template=${template.name}`);
            return { ok: false, status: 'failed', messageId: null, error: 'invalid_phone' };
        }

        if (!this.enabled) {
            await this.saveLog({
                toPhone: normalized,
                templateName: template.name,
                payloadJson: payload,
                status: 'skipped',
                metaMessageId: null,
                error: 'disabled',
                appointmentId: params.appointmentId ?? null,
            });
            this.logger.warn(`WhatsApp disabled: template=${template.name}`);
            return { ok: true, status: 'skipped', messageId: null, error: 'disabled' };
        }

        if (!this.token || !this.phoneNumberId) {
            const error = 'missing_config';
            await this.saveLog({
                toPhone: normalized,
                templateName: template.name,
                payloadJson: payload,
                status: 'failed',
                metaMessageId: null,
                error,
                appointmentId: params.appointmentId ?? null,
            });
            this.logger.warn(`WhatsApp config missing: template=${template.name}`);
            return { ok: false, status: 'failed', messageId: null, error };
        }

        const result = await this.sendWithRetries(payload);
        await this.saveLog({
            toPhone: normalized,
            templateName: template.name,
            payloadJson: payload,
            status: result.status,
            metaMessageId: result.messageId,
            error: result.error,
            appointmentId: params.appointmentId ?? null,
        });

        if (!result.ok) {
            this.logger.warn(`WhatsApp send failed: template=${template.name}, error=${result.error}`);
        }

        return result;
    }

    private buildTemplatePayload(templateName: string, toPhone: string, params: string[]) {
        return {
            messaging_product: 'whatsapp',
            to: toPhone,
            type: 'template',
            template: {
                name: templateName,
                language: { code: this.defaultLang },
                components: [
                    {
                        type: 'body',
                        parameters: params.map(value => ({
                            type: 'text',
                            text: value ?? '',
                        })),
                    },
                ],
            },
        };
    }

    private buildAuthTemplatePayload(templateName: string, toPhone: string, code: string, spec: AuthTemplateSpec) {
        const components: any[] = [];
        if (spec.hasBodyVariable) {
            components.push({
                type: 'body',
                parameters: [
                    {
                        type: 'text',
                        text: code ?? '',
                    },
                ],
            });
        }

        components.push({
            type: 'button',
            sub_type: 'copy_code',
            index: '0',
            parameters: [
                {
                    type: 'text',
                    text: code ?? '',
                },
            ],
        });

        return {
            messaging_product: 'whatsapp',
            to: toPhone,
            type: 'template',
            template: {
                name: templateName,
                language: { code: spec.languageCode },
                components,
            },
        };
    }

    private async resolveAuthTemplateSpec(): Promise<AuthTemplateSpec> {
        if (this.authTemplateSpecCache) {
            return this.authTemplateSpecCache;
        }

        const fallback: AuthTemplateSpec = {
            languageCode: this.authTemplateLanguage,
            hasBodyVariable: false,
        };

        if (!this.token || !this.wabaId) {
            this.authTemplateSpecCache = fallback;
            return fallback;
        }

        try {
            const url = new URL(`https://graph.facebook.com/v19.0/${this.wabaId}/message_templates`);
            url.searchParams.set('name', this.authTemplateName);
            url.searchParams.set('fields', 'name,status,category,language,components');
            url.searchParams.set('limit', '50');

            const res = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });

            if (!res.ok) {
                this.authTemplateSpecCache = fallback;
                return fallback;
            }

            const data = await res.json() as { data?: Array<Record<string, any>> };
            const approvedTemplate = (data?.data || []).find(item =>
                String(item?.name || '') === this.authTemplateName
                && String(item?.status || '').toUpperCase() === 'APPROVED'
                && String(item?.category || '').toUpperCase() === 'AUTHENTICATION'
            ) || null;

            if (!approvedTemplate) {
                this.authTemplateSpecCache = fallback;
                return fallback;
            }

            const hasBodyVariable = this.templateHasBodyVariable(approvedTemplate.components);
            const languageCode = this.hasAuthTemplateLanguageOverride
                ? this.authTemplateLanguage
                : String(approvedTemplate.language || this.authTemplateLanguage || this.defaultLang);

            this.authTemplateSpecCache = {
                languageCode,
                hasBodyVariable,
            };
            return this.authTemplateSpecCache;
        } catch (error: any) {
            this.logger.warn(`WhatsApp auth template definition lookup failed: ${error?.message || error}`);
            this.authTemplateSpecCache = fallback;
            return fallback;
        }
    }

    private templateHasBodyVariable(components: any): boolean {
        if (!Array.isArray(components)) return false;
        const body = components.find(c => String(c?.type || '').toUpperCase() === 'BODY');
        if (!body) return false;

        const text = String(body?.text || '');
        if (/\{\{\s*1\s*\}\}/.test(text)) {
            return true;
        }

        const examples = body?.example?.body_text;
        return Array.isArray(examples) && examples.length > 0;
    }

    private buildSafeAuthTemplatePayloadForLogging(payload: Record<string, any>) {
        const clone = JSON.parse(JSON.stringify(payload));
        const components = clone?.template?.components;
        if (Array.isArray(components)) {
            for (const component of components) {
                const parameters = component?.parameters;
                if (!Array.isArray(parameters)) continue;
                for (const parameter of parameters) {
                    if (parameter && typeof parameter === 'object') {
                        if ('text' in parameter) parameter.text = '[REDACTED_OTP]';
                        if ('payload' in parameter) parameter.payload = '[REDACTED_OTP]';
                    }
                }
            }
        }
        return clone;
    }

    private async sendWithRetries(payload: Record<string, any>): Promise<SendTemplateResult> {
        const maxAttempts = this.sendMaxAttempts;
        let attempt = 0;
        let lastError: string | null = null;

        while (attempt < maxAttempts) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.sendRequestTimeoutMs);
            try {
                const res = await fetch(`https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });

                const raw = await res.text();
                let data: any = null;
                if (raw) {
                    try {
                        data = JSON.parse(raw);
                    } catch {
                        data = null;
                    }
                }

                if (res.ok) {
                    const messageId = data?.messages?.[0]?.id ?? null;
                    return { ok: true, status: 'sent', messageId, error: null };
                }

                lastError = data?.error?.message || raw || `http_${res.status}`;

                if (!this.isRetryableHttpStatus(res.status)) {
                    return { ok: false, status: 'failed', messageId: null, error: lastError };
                }
            } catch (error: any) {
                lastError = error?.name === 'AbortError'
                    ? `request_timeout_${this.sendRequestTimeoutMs}ms`
                    : error?.message || 'network_error';
            } finally {
                clearTimeout(timeout);
            }

            attempt += 1;
            if (attempt < maxAttempts) {
                const delayMs = this.retryBaseDelayMs * Math.pow(2, attempt - 1);
                await sleep(delayMs);
            }
        }

        return { ok: false, status: 'failed', messageId: null, error: lastError || 'unknown_error' };
    }

    private isRetryableHttpStatus(status: number): boolean {
        return status === 408 || status === 429 || status >= 500;
    }

    private async saveLog(entry: {
        toPhone: string;
        templateName: string;
        payloadJson: Record<string, any>;
        status: string;
        metaMessageId: string | null;
        error: string | null;
        appointmentId: string | null;
    }) {
        const log = this.logRepo.create(entry);
        await this.logRepo.save(log);
    }
}
