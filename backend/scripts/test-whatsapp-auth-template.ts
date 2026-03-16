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
  process.env.WHATSAPP_AUTH_TEMPLATE_MODE = 'body_and_button';

  const repo = new LogRepoStub();
  const service = new WhatsAppService(repo as any);

  const payloads: any[] = [];
  let firstAttempt = true;
  (service as any).sendWithRetries = async (payload: any) => {
    payloads.push(payload);
    if (firstAttempt) {
      firstAttempt = false;
      return { ok: false, status: 'failed', messageId: null, error: '(#132000) Number of parameters does not match the expected number of params' };
    }
    return { ok: true, status: 'sent', messageId: 'wamid.test', error: null };
  };

  const result = await service.sendVerificationCodeTemplate('0501234567', '1234');
  assert.equal(result.ok, true);
  assert.equal(payloads.length, 2, 'should retry with alternate auth payload when params mismatch happens');

  const firstPayload = payloads[0];
  assert.equal(firstPayload.messaging_product, 'whatsapp');
  assert.equal(firstPayload.type, 'template');
  assert.equal(firstPayload.template.name, 'verification_code');
  assert.equal(firstPayload.template.language.code, 'he');

  const firstComponents = firstPayload.template.components;
  assert.equal(firstComponents[0].type, 'body');
  assert.equal(firstComponents[0].parameters[0].text, '1234');
  assert.equal(firstComponents[1].type, 'button');
  assert.equal(firstComponents[1].sub_type, 'copy_code');
  assert.equal(firstComponents[1].parameters[0].text, '1234');

  const secondPayload = payloads[1];
  assert.equal(secondPayload.template.components[0].type, 'button');
  assert.equal(secondPayload.template.components[0].sub_type, 'copy_code');
  assert.equal(secondPayload.template.components[0].parameters[0].text, '1234');

  const logEntry = repo.entries[0];
  assert.equal(logEntry.templateName, 'verification_code');
  assert.equal(logEntry.payloadJson.template.components[0].parameters[0].text, '[REDACTED_OTP]');

  console.log('whatsapp auth template test passed');
})();
