export const WHATSAPP_TEMPLATES = {
    appointment_confirmed: {
        name: 'appointment_confirmed',
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
    admin_general_message: {
        name: 'admin_general_message',
        params: ['clientNameOrEmpty', 'messageText'] as const,
    },
    admin_appointment_message: {
        name: 'admin_appointment_message',
        params: ['clientName', 'date', 'time', 'messageText'] as const,
    },
} as const;

export type WhatsAppTemplateName = keyof typeof WHATSAPP_TEMPLATES;
