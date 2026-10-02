import { encryptCredential, decryptCredential } from './crypto.util';

describe('integration credential encryption', () => {
  it('round trips while using a different IV for each encryption', () => {
    const first = encryptCredential('unit-test-value');
    const second = encryptCredential('unit-test-value');
    expect(first).not.toEqual(second);
    expect(decryptCredential(first)).toEqual('unit-test-value');
  });

  it('rejects tampered ciphertext', () => {
    const payload = Buffer.from(encryptCredential('unit-test-value'), 'base64');
    payload[payload.length - 1] ^= 1;
    expect(() => decryptCredential(payload.toString('base64'))).toThrow();
  });

  it('fails explicitly when the encryption key is absent', () => {
    const original = process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    try {
      expect(() => encryptCredential('unit-test-value')).toThrow('INTEGRATION_ENCRYPTION_KEY is required');
    } finally {
      process.env.INTEGRATION_ENCRYPTION_KEY = original;
    }
  });
});
