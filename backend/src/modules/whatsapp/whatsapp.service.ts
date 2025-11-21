import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';

export interface WhatsappTemplates {
    otp: string;
    bookingClient: string;
    bookingBarber: string;
    reminder: string;
}

export interface WhatsappConfig {
    accessToken: string;
    phoneNumberId: string;
    businessPhone: string;
    templateLanguage: string;
    templates: WhatsappTemplates;
}

type FetchLike = (input: any, init?: any) => Promise<any>;

@Injectable()
export class WhatsappService {
    private readonly logger = new Logger(WhatsappService.name);
    private readonly fetchFn: FetchLike = (...args: any[]) => (globalThis as any).fetch(...args);

    private readonly placeholderConfig: WhatsappConfig = {
        accessToken: '',
        phoneNumberId: '',
        businessPhone: '',
        templateLanguage: 'he',
        templates: {
            otp: 'familia_send_otp',
            bookingClient: 'familia_booking_client',
            bookingBarber: 'familia_booking_barber',
            reminder: 'familia_daily_reminder',
        },
    };

    private cachedConfig: WhatsappConfig | null = null;

    constructor(
        @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
        private readonly configService: ConfigService,
    ) {}

    private readEnvConfig(): Partial<WhatsappConfig> {
        const templates: Partial<WhatsappTemplates> = {
            otp: this.configService.get<string>('WHATSAPP_TEMPLATE_OTP') ?? '',
            bookingClient: this.configService.get<string>('WHATSAPP_TEMPLATE_BOOKING_CLIENT') ?? '',
            bookingBarber: this.configService.get<string>('WHATSAPP_TEMPLATE_BOOKING_BARBER') ?? '',
            reminder: this.configService.get<string>('WHATSAPP_TEMPLATE_REMINDER') ?? '',
        };

        return {
            accessToken: this.configService.get<string>('WHATSAPP_ACCESS_TOKEN') ?? '',
            phoneNumberId: this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID') ?? '',
            businessPhone:
                this.configService.get<string>('WHATSAPP_BUSINESS_PHONE') ??
                this.configService.get<string>('WHATSAPP_BUSINESS_NUMBER') ??
                '',
            templateLanguage: this.configService.get<string>('WHATSAPP_TEMPLATE_LANG') ?? '',
            templates: templates as WhatsappTemplates,
        } as Partial<WhatsappConfig>;
    }

    private mergeTemplates(base: WhatsappTemplates, override?: Partial<WhatsappTemplates>): WhatsappTemplates {
        return {
            otp: override?.otp || base.otp,
            bookingClient: override?.bookingClient || base.bookingClient,
            bookingBarber: override?.bookingBarber || base.bookingBarber,
            reminder: override?.reminder || base.reminder,
        };
    }

    async getConfig(): Promise<WhatsappConfig> {
        if (this.cachedConfig) return this.cachedConfig;

        const stored = await this.settingRepo.findOne({ where: { key: 'whatsapp.config' } });
        const storedValue = (stored?.value || {}) as Partial<WhatsappConfig>;
        const envConfig = this.readEnvConfig();

        const merged: WhatsappConfig = {
            ...this.placeholderConfig,
            ...storedValue,
            ...envConfig,
            templates: this.mergeTemplates(
                this.placeholderConfig.templates,
                {
                    ...storedValue.templates,
                    ...envConfig.templates,
                },
            ),
        };
        this.cachedConfig = merged;
        return merged;
    }

    isConfigured(config?: WhatsappConfig): boolean {
        const cfg = config || this.cachedConfig;
        if (!cfg) return false;
        return Boolean(cfg.accessToken && cfg.phoneNumberId && cfg.businessPhone);
    }

    clearCache() {
        this.cachedConfig = null;
    }

    normalizeToE164(phone: string): string {
        if (!phone) return '';
        const digits = phone.replace(/\D/g, '');
        if (digits.startsWith('972')) return digits;
        if (digits.startsWith('+972')) return digits.slice(1);
        if (digits.startsWith('0')) return `972${digits.slice(1)}`;
        return digits;
    }

    async sendOtp(toPhone: string, code: string) {
        const cfg = await this.getConfig();
        if (!this.isConfigured(cfg)) {
            this.logger.warn('WhatsApp not configured – OTP will stay in dev fallback mode');
            return { sent: false, reason: 'NOT_CONFIGURED' };
        }
        const templateName = cfg.templates.otp;
        const params = [code];
        return this.sendTemplate(cfg, toPhone, templateName, params);
    }

    async sendClientConfirmation(toPhone: string, payload: { clientName: string; serviceName: string; startsAt: Date }) {
        const cfg = await this.getConfig();
        if (!this.isConfigured(cfg)) return { sent: false, reason: 'NOT_CONFIGURED' };

        const message = `הזמנתך ל${payload.serviceName} נקבעה ל-${this.formatLocal(payload.startsAt)}. נתראה!`;
        return this.sendText(cfg, toPhone, message);
    }

    async sendBarberNotification(toPhone: string, payload: { clientName: string; serviceName: string; startsAt: Date }) {
        const cfg = await this.getConfig();
        if (!this.isConfigured(cfg)) return { sent: false, reason: 'NOT_CONFIGURED' };

        const message = `נקבע תור חדש: ${payload.clientName} ל-${payload.serviceName} בתאריך ${this.formatLocal(payload.startsAt)}.`;
        return this.sendText(cfg, toPhone, message);
    }

    async sendReminder(toPhone: string, payload: { clientName: string; serviceName: string; startsAt: Date }) {
        const cfg = await this.getConfig();
        if (!this.isConfigured(cfg)) return { sent: false, reason: 'NOT_CONFIGURED' };

        const templateName = cfg.templates.reminder;
        const formatted = this.formatLocal(payload.startsAt);
        return this.sendTemplate(cfg, toPhone, templateName, [payload.clientName || 'לקוח יקר', payload.serviceName, formatted]);
    }

    private formatLocal(date: Date) {
        return date
            .toLocaleString('he-IL', {
                timeZone: 'Asia/Jerusalem',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            })
            .replace(',', '');
    }

    private async sendTemplate(config: WhatsappConfig, toPhone: string, template: string, bodyParams: string[]) {
        const to = this.normalizeToE164(toPhone);
        if (!to) return { sent: false, reason: 'MISSING_PHONE' };

        const payload = {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
                name: template,
                language: { code: config.templateLanguage || 'he' },
                components: [
                    {
                        type: 'body',
                        parameters: bodyParams.map(text => ({ type: 'text', text })),
                    },
                ],
            },
        };

        return this.dispatch(config, payload);
    }

    private async sendText(config: WhatsappConfig, toPhone: string, body: string) {
        const to = this.normalizeToE164(toPhone);
        if (!to) return { sent: false, reason: 'MISSING_PHONE' };

        const payload = {
            messaging_product: 'whatsapp',
            to,
            text: { body },
        };

        return this.dispatch(config, payload);
    }

    private async dispatch(config: WhatsappConfig, payload: Record<string, any>) {
        try {
            const res = await this.fetchFn(`https://graph.facebook.com/v20.0/${config.phoneNumberId}/messages`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const text = await res.text();
                this.logger.error(`WhatsApp send failed: ${res.status} ${text}`);
                return { sent: false, reason: `HTTP_${res.status}` };
            }
            return { sent: true };
        } catch (e: any) {
            this.logger.error('WhatsApp dispatch error', e?.stack || e?.message || e);
            return { sent: false, reason: 'NETWORK_ERROR' };
        }
    }
}
