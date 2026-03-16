import { strict as assert } from 'assert';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';

class LogRepoStub {
  public entries: any[] = [];
  create(entry: any) { return entry; }
  async save(entry: any) { this.entries.push(entry); return entry; }
  async exist() { return false; }
}

(async () => {
  process.env.WHATSAPP_ENABLED = 'true';
  process.env.WHATSAPP_TOKEN = 'token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  process.env.WHATSAPP_AUTH_TEMPLATE_NAME = 'verification_code';
  process.env.WHATSAPP_AUTH_TEMPLATE_LANG = 'he_IL';

  const repo = new LogRepoStub();
  const service = new WhatsAppService(repo as any);

  (service as any).resolveAuthTemplateSpec = async () => ({
    languageCode: 'he_IL',
    hasBodyVariable: true,
  });

  const payloads: any[] = [];
  (service as any).sendWithRetries = async (payload: any) => {
    payloads.push(payload);
    return { ok: true, status: 'sent', messageId: 'wamid.test', error: null };
  };

  const result = await service.sendVerificationCodeTemplate('0501234567', '1234');
  assert.equal(result.ok, true);
  assert.equal(payloads.length, 1);

  const payload = payloads[0];
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.name, 'verification_code');
  assert.equal(payload.template.language.code, 'he_IL');

  const components = payload.template.components;
  assert.equal(Array.isArray(components), true);
  assert.equal(components.length, 2);

  assert.equal(components[0].type, 'body');
  assert.equal(components[0].parameters[0].type, 'text');
  assert.equal(components[0].parameters[0].text, '1234');

  assert.equal(components[1].type, 'button');
  assert.equal(components[1].sub_type, 'copy_code');
  assert.equal(components[1].index, '0');
  assert.equal(components[1].parameters[0].type, 'text');
  assert.equal(components[1].parameters[0].text, '1234');

  const hasPayloadParam = components.some((c: any) => (c.parameters || []).some((p: any) => p.type === 'payload'));
  assert.equal(hasPayloadParam, false, 'auth template OTP should not use payload parameter type');

  const logEntry = repo.entries[0];
  assert.equal(logEntry.templateName, 'verification_code');
  assert.equal(logEntry.payloadJson.template.components[0].parameters[0].text, '[REDACTED_OTP]');
  assert.equal(logEntry.payloadJson.template.components[1].parameters[0].text, '[REDACTED_OTP]');

  console.log('whatsapp auth template test passed');
})();
