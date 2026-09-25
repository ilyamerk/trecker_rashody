import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAssertion, checkPin, createPinRecord, formatWait, isValidPin, isWeakPin, lockoutMs } from '../app/js/lock.js';

test('PIN: хэш с солью, верный проходит, неверный — нет', async () => {
  const rec = await createPinRecord('2580', 1000);
  assert.notEqual(rec.hash, '2580');
  assert.equal(await checkPin('2580', rec), true);
  assert.equal(await checkPin('2581', rec), false);
  assert.equal(await checkPin('abc', rec), false);
  const rec2 = await createPinRecord('2580', 1000);
  assert.notEqual(rec.hash, rec2.hash); // разная соль — разный хэш
});

test('isValidPin и isWeakPin', () => {
  assert.equal(isValidPin('1234'), true);
  assert.equal(isValidPin('123'), false);
  assert.equal(isValidPin('12a4'), false);
  for (const weak of ['0000', '1111', '1234', '4321', '6789']) assert.equal(isWeakPin(weak), true, weak);
  for (const ok of ['2580', '1357', '9021', '1122']) assert.equal(isWeakPin(ok), false, ok);
});

test('пауза после неверных попыток растёт, но не больше часа', () => {
  assert.equal(lockoutMs(4), 0);
  assert.equal(lockoutMs(5), 30_000);
  assert.equal(lockoutMs(6), 60_000);
  assert.equal(lockoutMs(50), 3_600_000);
  assert.equal(formatWait(30_000), '30 с');
  assert.equal(formatWait(90_000), '1 мин 30 с');
});

async function fakeAssertion({ challenge, origin = 'https://me.github.io', rpId = 'me.github.io', uv = true, type = 'webauthn.get' }) {
  const b64url = Buffer.from(challenge).toString('base64url');
  const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type, challenge: b64url, origin }));
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(rpHash, 0);
  authenticatorData[32] = uv ? 0x05 : 0x01;
  return { clientDataJSON: clientDataJSON.buffer, authenticatorData: authenticatorData.buffer };
}

test('Face ID: принимаем только наш запрос, наш сайт и подтверждённую личность', async () => {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const site = { origin: 'https://me.github.io', rpId: 'me.github.io' };
  assert.equal(await checkAssertion(await fakeAssertion({ challenge }), challenge, site), true);
  assert.equal(await checkAssertion(await fakeAssertion({ challenge, uv: false }), challenge, site), false);
  assert.equal(await checkAssertion(await fakeAssertion({ challenge, origin: 'https://evil.io' }), challenge, site), false);
  assert.equal(await checkAssertion(await fakeAssertion({ challenge, rpId: 'evil.io' }), challenge, site), false);
  assert.equal(await checkAssertion(await fakeAssertion({ challenge, type: 'webauthn.create' }), challenge, site), false);
  const other = crypto.getRandomValues(new Uint8Array(32));
  assert.equal(await checkAssertion(await fakeAssertion({ challenge: other }), challenge, site), false);
});
