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
  process.env.WHATSAPP_AUTH_TEMPLATE_LANG = 'he';

  const repo = new LogRepoStub();
  const service = new WhatsAppService(repo as any);

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
  assert.equal(payload.template.language.code, 'he');

  const components = payload.template.components;
  assert.equal(Array.isArray(components), true);
  assert.equal(components.length, 1);
  assert.equal(components[0].type, 'button');
  assert.equal(components[0].sub_type, 'copy_code');
  assert.equal(components[0].index, '0');
  assert.equal(components[0].parameters[0].type, 'payload');
  assert.equal(components[0].parameters[0].payload, '1234');

  const hasBodyInterpolation = components.some((c: any) => c.type === 'body');
  assert.equal(hasBodyInterpolation, false, 'marketing-style body interpolation must not be used for auth template OTP');

  const logEntry = repo.entries[0];
  assert.equal(logEntry.templateName, 'verification_code');
  assert.equal(logEntry.payloadJson.template.components[0].parameters[0].payload, '[REDACTED_OTP]');

  console.log('whatsapp auth template test passed');
})();
