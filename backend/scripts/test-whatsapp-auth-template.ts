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

  const payload = (service as any).buildVerificationCodePayload('972500000000', '1234');
  assert.equal(payload.template.name, 'verification_code');
  assert.equal(payload.template.language.code, 'he');
  assert.equal(payload.template.components.length, 2);
  assert.equal(payload.template.components[0].type, 'body');
  assert.equal(payload.template.components[0].parameters[0].type, 'text');
  assert.equal(payload.template.components[0].parameters[0].text, '1234');
  assert.equal(payload.template.components[1].type, 'button');
  assert.equal(payload.template.components[1].sub_type, 'copy_code');
  assert.equal(payload.template.components[1].index, '0');
  assert.equal(payload.template.components[1].parameters[0].type, 'text');
  assert.equal(payload.template.components[1].parameters[0].text, '1234');

  const safePayload = (service as any).buildSafePayloadForLogging(payload);
  assert.equal(safePayload.template.components[0].parameters[0].text, '[REDACTED]');
  assert.equal(safePayload.template.components[1].parameters[0].text, '[REDACTED]');

  (service as any).sendWithRetries = async () => ({ ok: true, status: 'sent', messageId: 'wamid.test', error: null, metaError: null });
  const sendResult = await service.sendVerificationCodeTemplate('0501234567', '1234');
  assert.equal(sendResult.ok, true);
  assert.equal(repo.entries.length > 0, true);
  assert.equal(repo.entries[0].templateName, 'verification_code');

  console.log('whatsapp auth template tests passed');
})();
