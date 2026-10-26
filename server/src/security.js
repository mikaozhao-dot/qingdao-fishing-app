import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

function readHexKey(value, name) {
  if (!/^[a-f\d]{64}$/i.test(value)) {
    throw new Error(`${name} must be a 32-byte hex value.`);
  }
  return Buffer.from(value, 'hex');
}

export function createSecurity(config) {
  const encryptionKey = () => readHexKey(config.piiEncryptionKeyHex, 'PII_ENCRYPTION_KEY_HEX');
  const hashKey = () => readHexKey(config.phoneHashKeyHex, 'PHONE_HASH_KEY_HEX');

  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
    },
    decrypt(value) {
      const bytes = Buffer.from(value);
      if (bytes.length < 30 || bytes[0] !== 1) throw new Error('Unsupported encrypted value.');
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(1, 13));
      decipher.setAuthTag(bytes.subarray(13, 29));
      return Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8');
    },
    phoneHash(phone) {
      return createHmac('sha256', hashKey()).update(`phone:${phone}`).digest();
    },
    identityHash(identityNumber) {
      return createHmac('sha256', hashKey())
        .update(`identity-number:${String(identityNumber ?? '').toUpperCase().trim()}`).digest();
    },
    newPromotionVisitorToken() {
      const visitorId = randomBytes(24).toString('base64url');
      const signature = createHmac('sha256', hashKey())
        .update(`promotion-visitor:${visitorId}`).digest('base64url');
      return `${visitorId}.${signature}`;
    },
    promotionVisitorId(token) {
      const [visitorId, signature, extra] = String(token ?? '').split('.');
      if (!visitorId || !signature || extra !== undefined) return null;
      const expected = createHmac('sha256', hashKey())
        .update(`promotion-visitor:${visitorId}`).digest('base64url');
      return this.safeEqual(signature, expected) ? visitorId : null;
    },
    promotionVisitorHash(visitorId) {
      return createHmac('sha256', hashKey()).update(`promotion-key:${visitorId}`).digest();
    },
    tokenHash(token) {
      return createHmac('sha256', hashKey()).update(`session:${token}`).digest();
    },
    smsCodeHash(code) {
      return createHmac('sha256', hashKey()).update(`sms:${code}`).digest();
    },
    safeEqual(left, right) {
      const a = Buffer.from(left);
      const b = Buffer.from(right);
      return a.length === b.length && timingSafeEqual(a, b);
    },
    newToken() {
      return randomBytes(32).toString('base64url');
    },
    newSmsCode() {
      return String(randomBytes(4).readUInt32BE() % 1000000).padStart(6, '0');
    },
  };
}

export function verifyChineseIdentityNumber(value) {
  const identity = String(value ?? '').toUpperCase();
  if (!/^\d{17}[\dX]$/.test(identity)) return false;
  const birthDate = identity.slice(6, 14);
  const year = Number(birthDate.slice(0, 4));
  const month = Number(birthDate.slice(4, 6));
  const day = Number(birthDate.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return false;
  }
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = [...identity.slice(0, 17)].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return checks[sum % 11] === identity[17];
}

export function makeSandboxIdentityNumber(sequence = '001') {
  const body = `99000019900101${String(sequence).padStart(3, '0').slice(-3)}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  return `${body}${checks[sum % 11]}`;
}
