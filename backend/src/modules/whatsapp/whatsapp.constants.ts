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
    remainder_same_day: {
        name: 'remainder_same_day',
        params: ['clientName', 'date', 'time'] as const,
    },
    reminder_prev_day: {
        name: 'reminder_prev_day',
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

// Human-readable (Hebrew) names used in admin failure alerts.
export const WHATSAPP_TEMPLATE_LABELS: Record<WhatsAppTemplateName, string> = {
    auth_code: 'קוד התחברות',
    appointment_approved: 'אישור תור',
    remainder_same_day: 'תזכורת לתור היום',
    reminder_prev_day: 'תזכורת לתור מחר',
    appointment_canceled: 'ביטול תור',
    appointment_rescheduled: 'הזזת תור',
    general_message: 'הודעה כללית',
    admin_appointment_message: 'הודעה על תור',
    fixed_appointment: 'תור קבוע',
    delete_fixed: 'ביטול תור קבוע',
};
