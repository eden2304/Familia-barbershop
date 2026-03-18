export const WHATSAPP_TEMPLATES = {
    auth_code: {
        name: 'auth_code',
        params: ['code'] as const,
        languageCode: 'en_US',
    },
    appointment_approved: {
        name: 'appointment_approved',
        params: ['clientName', 'date', 'time'] as const,
    },
    appointment_reminder_same_day: {
        name: 'remainder_same_day',
        params: ['clientName', 'date', 'time'] as const,
    },
    appointment_canceled: {
        name: 'appointment_canceled',
        params: ['clientName', 'date', 'time'] as const,
    },
    appointment_rescheduled: {
        name: 'appointment_rescheduled',
        params: ['clientName', 'oldDate', 'oldTime', 'newDate', 'newTime'] as const,
    },
    general_message: {
        name: 'general_message',
        params: ['messageText'] as const,
    },
    admin_appointment_message: {
        name: 'admin_appointment_message',
        params: ['clientName', 'date', 'time', 'messageText'] as const,
    },
    fixed_appointment: {
        name: 'fixed_appointment',
        params: ['clientName', 'frequency', 'dayOfWeek', 'time'] as const,
    },
    delete_fixed: {
        name: 'delete_fixed',
        params: ['clientName', 'frequency', 'dayOfWeek', 'time'] as const,
    },
} as const satisfies Record<string, {
    name: string;
    params: readonly string[];
    languageCode?: string;
}>;

export type WhatsAppTemplateName = keyof typeof WHATSAPP_TEMPLATES;
