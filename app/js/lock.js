// PIN-код и вход по Face ID / Touch ID.
// Это защита от человека, который взял твой разблокированный телефон, а не
// шифрование: данные на устройстве лежат открыто. PIN нигде не хранится —
// только его хэш PBKDF2 с солью (PIN часто совпадает с PIN карты).

export const PIN_LENGTH = 4;
const ITERATIONS = 250_000;

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64Url = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const isValidPin = (pin) => typeof pin === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

// 0000, 1234, 4321 угадываются с первой попытки
export function isWeakPin(pin) {
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  return Math.abs(step) <= 1 && d.every((x, i) => i === 0 || x - d[i - 1] === step);
}

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toB64(bits);
}

export async function createPinRecord(pin, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: await derive(pin, salt, iterations), iterations };
}

export async function checkPin(pin, record) {
  if (!isValidPin(pin) || !record?.hash) return false;
  const hash = await derive(pin, fromB64(record.salt), record.iterations);
  // Сравнение за постоянное время
  let diff = hash.length ^ record.hash.length;
  for (let i = 0; i < Math.min(hash.length, record.hash.length); i++) diff |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
  return diff === 0;
}

// Первые 4 ошибки бесплатно, дальше пауза 30 с, 1 мин, 2 мин… но не больше часа
export function lockoutMs(failures) {
  if (failures < 5) return 0;
  return Math.min(30_000 * 2 ** (failures - 5), 3_600_000);
}

export function formatWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} мин ${s % 60} с` : `${m} мин`;
}

// ---------- Face ID / Touch ID через ключ входа (passkey, WebAuthn) ----------
// Сервера нет, подпись проверять некому. Нам достаточно, что система
// подтвердила личность (флаг UV) именно на наш одноразовый запрос.

export const webauthnSupported = () =>
  typeof window !== 'undefined' && 'PublicKeyCredential' in window && typeof navigator.credentials?.create === 'function';

export async function biometricAvailable() {
  try {
    return webauthnSupported() && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

// Для фраз «вход по …»
export function biometricName(ua = navigator.userAgent) {
  if (/iPhone|iPad/.test(ua)) return 'Face ID';
  if (/Macintosh/.test(ua)) return 'Touch ID';
  if (/Windows/.test(ua)) return 'Windows Hello';
  if (/Android/.test(ua)) return 'отпечатку';
  return 'биометрии';
}

export function describeBiometricError(err) {
  const name = err?.name ?? 'Error';
  const text =
    {
      NotAllowedError: 'отменено или система не разрешила',
      NotSupportedError: 'устройство или браузер не поддерживают вход по биометрии',
      SecurityError: 'браузер запретил биометрию для этого адреса (нужен https)',
      InvalidStateError: 'ключ входа уже есть — выключи и включи снова',
      AbortError: 'отменено',
    }[name] ?? (err?.message || 'неизвестная ошибка');
  return `${text} (${name})`;
}

// Вызывать прямо из обработчика нажатия — Safari требует жест пользователя.
// userId постоянный: повторное включение перезапишет ключ, а не наплодит новых.
export async function registerBiometric(userId) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Трекер расходов' },
      user: { id: fromB64(userId), name: 'Трекер расходов', displayName: 'Трекер расходов' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none',
      timeout: 60_000,
    },
  });
  if (!cred) throw new DOMException('Ключ не создан', 'NotAllowedError');
  return toB64(cred.rawId);
}

export const newBiometricUserId = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Проверка ответа без сервера: тот же запрос, тот же сайт, личность подтверждена
export async function checkAssertion({ clientDataJSON, authenticatorData }, challenge, { origin, rpId }) {
  const client = JSON.parse(new TextDecoder().decode(clientDataJSON));
  const auth = new Uint8Array(authenticatorData);
  const rpHash = await sha256(rpId);
  const sameRp = rpHash.every((b, i) => auth[i] === b);
  const userVerified = (auth[32] & 0x04) !== 0;
  return client.type === 'webauthn.get' && client.challenge === toB64Url(challenge) && client.origin === origin && sameRp && userVerified;
}

export async function verifyBiometric(credentialId) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ type: 'public-key', id: fromB64(credentialId) }],
      userVerification: 'required',
      timeout: 60_000,
    },
  });
  if (!assertion) return false;
  return checkAssertion(assertion.response, challenge, { origin: location.origin, rpId: location.hostname });
}
