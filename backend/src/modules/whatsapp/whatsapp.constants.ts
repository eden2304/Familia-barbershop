export const WHATSAPP_TEMPLATES = {
    login_and_register: {
        name: 'login_and_register',
        params: ['code'] as const,
    },
    appointment_approved: {
        name: 'appointment_approved',
        params: ['clientName', 'date', 'time'] as const,
    },
    appointment_reminder_same_day: {
        name: 'appointment_reminder_same_day',
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
} as const;

export type WhatsAppTemplateName = keyof typeof WHATSAPP_TEMPLATES;
