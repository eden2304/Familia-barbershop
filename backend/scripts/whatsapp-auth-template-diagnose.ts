/* eslint-disable no-console */
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';

class LogRepoStub {
  create(entry: any) { return entry; }
  async save(entry: any) { return entry; }
  async exist() { return false; }
}

(async () => {
  const service = new WhatsAppService(new LogRepoStub() as any);

  const status = {
    WHATSAPP_TOKEN: Boolean(process.env.WHATSAPP_TOKEN),
    WHATSAPP_PHONE_NUMBER_ID: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_AUTH_TEMPLATE_NAME: Boolean(process.env.WHATSAPP_AUTH_TEMPLATE_NAME),
    WHATSAPP_AUTH_TEMPLATE_LANG: Boolean(process.env.WHATSAPP_AUTH_TEMPLATE_LANG),
  };
  console.log('WhatsApp auth config presence:');
  console.log(JSON.stringify(status, null, 2));

  const toPhone = process.env.WHATSAPP_TEST_PHONE || '';
  const otp = process.env.WHATSAPP_TEST_OTP || '1234';
  const doSend = String(process.env.WHATSAPP_DIAG_SEND || '').toLowerCase() === 'true';

  const payload = (service as any).buildVerificationCodePayload(toPhone || '972500000000', otp);
  const safePayload = (service as any).buildSafePayloadForLogging(payload);

  console.log('Final outbound payload (redacted):');
  console.log(JSON.stringify(safePayload, null, 2));

  if (!doSend) {
    console.log('Dry-run only. Set WHATSAPP_DIAG_SEND=true and WHATSAPP_TEST_PHONE to perform a real send.');
    return;
  }

  if (!toPhone) {
    console.error('WHATSAPP_TEST_PHONE is required for send mode.');
    process.exit(1);
  }

  const result = await service.sendVerificationCodeTemplate(toPhone, otp);
  console.log('Send result:');
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error('Auth template send failed. See result.error/metaError above.');
    process.exit(1);
  }
})();
