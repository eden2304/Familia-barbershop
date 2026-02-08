/* eslint-disable no-console */

const enabled = String(process.env.WHATSAPP_ENABLED || '').toLowerCase() === 'true';

if (!enabled) {
  console.log('WHATSAPP_ENABLED is false. Skipping send.');
  process.exit(0);
}

const token = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const toPhone = process.env.WHATSAPP_TEST_PHONE;
const lang = process.env.WHATSAPP_DEFAULT_LANG || 'he';

if (!token || !phoneNumberId || !toPhone) {
  console.error('Missing WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, or WHATSAPP_TEST_PHONE.');
  process.exit(1);
}

const payload = {
  messaging_product: 'whatsapp',
  to: toPhone,
  type: 'template',
  template: {
    name: 'admin_general_message',
    language: { code: lang },
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'לקוח' },
          { type: 'text', text: 'בדיקת הודעה אוטומטית' },
        ],
      },
    ],
  },
};

(async () => {
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('WhatsApp test send failed:', text);
      process.exit(1);
    }
    console.log('WhatsApp test send success:', text);
  } catch (error) {
    console.error('WhatsApp test send error:', error?.message || error);
    process.exit(1);
  }
})();
