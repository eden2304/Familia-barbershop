import { strict as assert } from 'assert';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';

class LogRepoStub {
  public entries: any[] = [];
  create(entry: any) { return entry; }
  async save(entry: any) { this.entries.push(entry); return entry; }
  async exist() { return false; }
}

function makeService(env: Record<string, string>) {
  Object.assign(process.env, env);
  return new WhatsAppService(new LogRepoStub() as any);
}

(async () => {
  const buttonOnlyService = makeService({
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_TOKEN: 'token',
    WHATSAPP_PHONE_NUMBER_ID: '123',
    WHATSAPP_WABA_ID: 'waba-1',
    WHATSAPP_AUTH_TEMPLATE_NAME: 'verification_code',
  });
  (buttonOnlyService as any).fetchWabaTemplatesByName = async () => ([{
    name: 'verification_code',
    status: 'APPROVED',
    category: 'AUTHENTICATION',
    language: 'en_US',
    components: [
      { type: 'BODY', text: 'Your code is hidden' },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
    ],
  }]);
  const specButtonOnly = await (buttonOnlyService as any).resolveAuthTemplateSpec();
  const payloadButtonOnly = (buttonOnlyService as any).buildAuthTemplatePayload(specButtonOnly, '972500000000', '1234');
  assert.equal(payloadButtonOnly.template.language.code, 'en_US');
  assert.equal(payloadButtonOnly.template.components.length, 1);
  assert.equal(payloadButtonOnly.template.components[0].type, 'button');
  assert.equal(payloadButtonOnly.template.components[0].parameters[0].type, 'text');

  const bodyAndButtonService = makeService({
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_TOKEN: 'token',
    WHATSAPP_PHONE_NUMBER_ID: '123',
    WHATSAPP_WABA_ID: 'waba-1',
    WHATSAPP_AUTH_TEMPLATE_NAME: 'verification_code',
  });
  (bodyAndButtonService as any).fetchWabaTemplatesByName = async () => ([{
    name: 'verification_code',
    status: 'APPROVED',
    category: 'AUTHENTICATION',
    language: 'he_IL',
    components: [
      { type: 'BODY', text: 'הקוד שלך הוא {{1}}' },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'העתק קוד' }] },
    ],
  }]);
  const specBodyAndButton = await (bodyAndButtonService as any).resolveAuthTemplateSpec();
  const payloadBodyAndButton = (bodyAndButtonService as any).buildAuthTemplatePayload(specBodyAndButton, '972500000000', '1234');
  assert.equal(payloadBodyAndButton.template.language.code, 'he_IL');
  assert.equal(payloadBodyAndButton.template.components.length, 2);
  assert.equal(payloadBodyAndButton.template.components[0].type, 'body');
  assert.equal(payloadBodyAndButton.template.components[1].type, 'button');
  assert.equal(payloadBodyAndButton.template.components[0].parameters.length, 1);
  assert.equal(payloadBodyAndButton.template.components[1].parameters.length, 1);

  const localeOverrideService = makeService({
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_TOKEN: 'token',
    WHATSAPP_PHONE_NUMBER_ID: '123',
    WHATSAPP_WABA_ID: 'waba-1',
    WHATSAPP_AUTH_TEMPLATE_NAME: 'verification_code',
    WHATSAPP_AUTH_TEMPLATE_LANG: 'fr',
  });
  (localeOverrideService as any).fetchWabaTemplatesByName = async () => ([{
    name: 'verification_code',
    status: 'APPROVED',
    category: 'AUTHENTICATION',
    language: 'he_IL',
    components: [
      { type: 'BODY', text: 'Votre code est {{1}}' },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copier' }] },
    ],
  }]);
  const specLocaleOverride = await (localeOverrideService as any).resolveAuthTemplateSpec();
  assert.equal(specLocaleOverride.languageCode, 'fr');

  delete process.env.WHATSAPP_AUTH_TEMPLATE_LANG;

  const repo = new LogRepoStub();
  const sendService = new WhatsAppService(repo as any);
  (sendService as any).fetchWabaTemplatesByName = async () => ([{
    name: 'verification_code',
    status: 'APPROVED',
    category: 'AUTHENTICATION',
    language: 'he_IL',
    components: [
      { type: 'BODY', text: 'הקוד שלך הוא {{1}}' },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'העתק קוד' }] },
    ],
  }]);
  (sendService as any).sendWithRetries = async () => ({ ok: true, status: 'sent', messageId: 'wamid.test', error: null, metaError: null });

  const sendResult = await sendService.sendVerificationCodeTemplate('0501234567', '1234');
  assert.equal(sendResult.ok, true);

  const logged = repo.entries[0];
  assert.equal(logged.templateName, 'verification_code');
  assert.equal(logged.payloadJson.template.components[0].parameters[0].text, '[REDACTED_OTP]');
  assert.equal(logged.payloadJson.template.components[1].parameters[0].text, '[REDACTED_OTP]');

  console.log('whatsapp auth template tests passed');
})();
