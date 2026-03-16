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
  metaError?: Record<string, any> | null;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  private readonly enabled =
    String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true';

  private readonly token = process.env.WHATSAPP_TOKEN || '';
  private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

  private readonly defaultLang = process.env.WHATSAPP_DEFAULT_LANG || 'he';
  private readonly authTemplateName =
    process.env.WHATSAPP_AUTH_TEMPLATE_NAME || 'verification_code';
  private readonly authTemplateLanguage =
    process.env.WHATSAPP_AUTH_TEMPLATE_LANG || 'he';

  private readonly timeZone =
    process.env.WHATSAPP_TIMEZONE || 'Asia/Jerusalem';

  private readonly sendMaxAttempts = Math.max(
    1,
    Number(process.env.WHATSAPP_SEND_MAX_ATTEMPTS || 3),
  );

  private readonly sendRequestTimeoutMs = Math.max(
    1000,
    Number(process.env.WHATSAPP_SEND_TIMEOUT_MS || 4000),
  );

  private readonly retryBaseDelayMs = Math.max(
    50,
    Number(process.env.WHATSAPP_RETRY_BASE_DELAY_MS || 150),
  );

  constructor(
    @InjectRepository(WhatsAppMessageLog)
    private readonly logRepo: Repository<WhatsAppMessageLog>,
  ) {
    this.logger.log(
      `WhatsApp config: ${JSON.stringify({
        enabled: this.enabled,
        tokenPresent: Boolean(this.token),
        phoneNumberIdPresent: Boolean(this.phoneNumberId),
        authTemplateName: this.authTemplateName,
        authTemplateLanguage: this.authTemplateLanguage,
      })}`,
    );
  }

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
      where: {
        appointmentId: appointment.id,
        templateName: 'appointment_reminder_same_day',
      },
    });

    if (alreadySent) {
      return this.logSkipped(
        'appointment_reminder_same_day',
        appointment,
        'already_sent',
      );
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

  async sendAppointmentRescheduled(
    appointment: Appointment,
    previousStart: Date,
  ) {
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

  async sendAuthCode(toPhone: string, code: string) {
    return this.sendVerificationCodeTemplate(toPhone, code);
  }

  async sendVerificationCodeTemplate(
    toPhone: string,
    code: string,
  ): Promise<SendTemplateResult> {
    const normalized = normalizeIsraeliPhoneToE164(toPhone || '');
    const recipientForMeta = normalized ? toMetaRecipientFromE164(normalized) : '';

    if (!normalized) {
      await this.saveLog({
        toPhone: toPhone || '',
        templateName: this.authTemplateName,
        payloadJson: { skipped: true, reason: 'invalid_phone_auth_template' },
        status: 'failed',
        metaMessageId: null,
        error: 'invalid_phone_auth_template',
        appointmentId: null,
      });

      return {
        ok: false,
        status: 'failed',
        messageId: null,
        error: 'invalid_phone_auth_template',
      };
    }

    if (!this.enabled) {
      await this.saveLog({
        toPhone: normalized,
        templateName: this.authTemplateName,
        payloadJson: { skipped: true, reason: 'disabled_auth_template' },
        status: 'skipped',
        metaMessageId: null,
        error: 'disabled_auth_template',
        appointmentId: null,
      });

      return {
        ok: true,
        status: 'skipped',
        messageId: null,
        error: 'disabled_auth_template',
      };
    }

    if (!this.token || !this.phoneNumberId) {
      const error = 'missing_config_auth_template';

      await this.saveLog({
        toPhone: normalized,
        templateName: this.authTemplateName,
        payloadJson: { skipped: true, reason: error },
        status: 'failed',
        metaMessageId: null,
        error,
        appointmentId: null,
      });

      return {
        ok: false,
        status: 'failed',
        messageId: null,
        error,
      };
    }

    const payload = this.buildVerificationCodePayload(recipientForMeta, code);
    const safePayload = this.buildSafePayloadForLogging(payload);

    this.logger.log(
      `WhatsApp OTP send: ${JSON.stringify({
        template: this.authTemplateName,
        language: this.authTemplateLanguage,
        components: payload.template?.components?.map((c: any) => ({
          type: c.type,
          sub_type: c.sub_type || null,
          index: c.index || null,
          parameterCount: Array.isArray(c.parameters) ? c.parameters.length : 0,
          parameterTypes: Array.isArray(c.parameters) ? c.parameters.map((p: any) => p.type) : [],
        })),
      })}`,
    );

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
      this.logger.warn(
        `WhatsApp OTP send failed: ${JSON.stringify({
          error: result.error,
          metaError: result.metaError || null,
        })}`,
      );
    }

    return result;
  }

  /**
   * Fixed implementation for approved AUTHENTICATION template.
   * Sends BODY + COPY_CODE button, both with OTP text.
   */
  private buildVerificationCodePayload(toPhone: string, code: string) {
    return {
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'template',
      template: {
        name: this.authTemplateName,
        language: {
          code: this.authTemplateLanguage,
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: code ?? '',
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'copy_code',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: code ?? '',
              },
            ],
          },
        ],
      },
    };
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

  private buildTemplatePayload(
    templateName: string,
    toPhone: string,
    params: string[],
  ) {
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
            parameters: params.map((value) => ({
              type: 'text',
              text: value ?? '',
            })),
          },
        ],
      },
    };
  }

  private buildSafePayloadForLogging(payload: Record<string, any>) {
    const clone = JSON.parse(JSON.stringify(payload));
    const components = clone?.template?.components;

    if (Array.isArray(components)) {
      for (const component of components) {
        const parameters = component?.parameters;
        if (!Array.isArray(parameters)) continue;

        for (const parameter of parameters) {
          if (parameter && typeof parameter === 'object') {
            if ('text' in parameter) parameter.text = '[REDACTED]';
            if ('payload' in parameter) parameter.payload = '[REDACTED]';
            if ('coupon_code' in parameter) parameter.coupon_code = '[REDACTED]';
          }
        }
      }
    }

    return clone;
  }

  private async sendTemplateMessage(args: {
    templateName: WhatsAppTemplateName;
    toPhone: string;
    params: string[];
    appointmentId?: string | null;
  }): Promise<SendTemplateResult> {
    const template = WHATSAPP_TEMPLATES[args.templateName];
    if (!template) {
      return {
        ok: false,
        status: 'failed',
        messageId: null,
        error: 'unknown_template',
      };
    }

    if (args.params.length !== template.params.length) {
      return {
        ok: false,
        status: 'failed',
        messageId: null,
        error: 'invalid_template_params',
      };
    }

    const normalized = normalizeIsraeliPhoneToE164(args.toPhone || '');
    const recipientForMeta = normalized ? toMetaRecipientFromE164(normalized) : '';

    if (!normalized) {
      return {
        ok: false,
        status: 'failed',
        messageId: null,
        error: 'invalid_phone',
      };
    }

    if (!this.enabled) {
      return {
        ok: true,
        status: 'skipped',
        messageId: null,
        error: 'disabled',
      };
    }

    if (!this.token || !this.phoneNumberId) {
      return {
        ok: false,
        status: 'failed',
        messageId: null,
        error: 'missing_config',
      };
    }

    const payload = this.buildTemplatePayload(
      template.name,
      recipientForMeta,
      args.params,
    );

    const safePayload = this.buildSafePayloadForLogging(payload);
    const result = await this.sendWithRetries(payload);

    await this.saveLog({
      toPhone: normalized,
      templateName: template.name,
      payloadJson: safePayload,
      status: result.status,
      metaMessageId: result.messageId,
      error: result.error,
      appointmentId: args.appointmentId ?? null,
    });

    return result;
  }

  private async sendAppointmentTemplate(
    templateName: 'appointment_approved' | 'appointment_reminder_same_day' | 'appointment_canceled',
    appointment: Appointment,
    options?: { appointmentId?: string | null },
  ) {
    const clientName = this.getClientName(appointment);
    const date = formatDateForTemplate(appointment.startsAt, this.timeZone);
    const time = formatTimeForTemplate(appointment.startsAt, this.timeZone);

    return this.sendTemplateMessage({
      templateName,
      toPhone: this.getAppointmentPhone(appointment),
      params: [clientName, date, time],
      appointmentId: options?.appointmentId ?? appointment.id,
    });
  }

  private async logSkipped(
    templateName: WhatsAppTemplateName,
    appointment: Appointment,
    reason: string,
  ): Promise<SendTemplateResult> {
    const toPhone = this.getAppointmentPhone(appointment);
    const normalized = normalizeIsraeliPhoneToE164(toPhone || '') || '';

    await this.saveLog({
      toPhone: normalized || toPhone || '',
      templateName,
      payloadJson: { skipped: true, reason },
      status: 'skipped',
      metaMessageId: null,
      error: reason,
      appointmentId: appointment.id,
    });

    return {
      ok: true,
      status: 'skipped',
      messageId: null,
      error: reason,
    };
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

  private async sendWithRetries(
    payload: Record<string, any>,
  ): Promise<SendTemplateResult> {
    const maxAttempts = this.sendMaxAttempts;
    let attempt = 0;
    let lastError: string | null = null;
    let lastMetaError: Record<string, any> | null = null;

    while (attempt < maxAttempts) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.sendRequestTimeoutMs,
      );

      try {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );

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
          return {
            ok: true,
            status: 'sent',
            messageId,
            error: null,
            metaError: null,
          };
        }

        lastMetaError = data?.error || null;
        lastError = lastMetaError?.message || raw || `http_${res.status}`;

        if (!this.isRetryableHttpStatus(res.status)) {
          return {
            ok: false,
            status: 'failed',
            messageId: null,
            error: lastError,
            metaError: lastMetaError,
          };
        }
      } catch (error: any) {
        lastError =
          error?.name === 'AbortError'
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

    return {
      ok: false,
      status: 'failed',
      messageId: null,
      error: lastError || 'unknown_error',
      metaError: lastMetaError,
    };
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
