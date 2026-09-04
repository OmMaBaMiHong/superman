import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeSecretKey,
  encodeSecretKey,
  generateSecretKey,
  isSameSecretKey,
  isSealed,
  open,
  seal,
  SECRET_BOX_VERSION,
  SECRET_KEY_BYTES,
  SecretBoxError,
} from '@/server/infra/crypto/secretBox';

const KEY = Buffer.from('a'.repeat(64), 'hex');
const OTHER_KEY = Buffer.from('b'.repeat(64), 'hex');
const PLAINTEXT = 'ghp_1234567890abcdefghijklmnopqrstuvwx';

function splitSealed(sealed: string): [string, string, string, string] {
  const segments = sealed.split(':');
  expect(segments).toHaveLength(4);
  return segments as [string, string, string, string];
}

describe('secretBox.seal/open', () => {
  it('round-trips plaintext', () => {
    const sealed = seal(PLAINTEXT, KEY);

    expect(sealed).not.toContain(PLAINTEXT);
    expect(open(sealed, KEY)).toBe(PLAINTEXT);
  });

  it('round-trips unicode and empty plaintext', () => {
    expect(open(seal('中文 Token · 🔐', KEY), KEY)).toBe('中文 Token · 🔐');
    expect(open(seal('', KEY), KEY)).toBe('');
  });

  it('produces a different ciphertext on every call (random iv)', () => {
    const first = seal(PLAINTEXT, KEY);
    const second = seal(PLAINTEXT, KEY);

    expect(first).not.toBe(second);
    expect(open(first, KEY)).toBe(open(second, KEY));
  });

  it('uses the versioned v1:iv:tag:ciphertext format', () => {
    const [version, iv, tag, ciphertext] = splitSealed(seal(PLAINTEXT, KEY));

    expect(version).toBe(SECRET_BOX_VERSION);
    expect(Buffer.from(iv, 'base64url')).toHaveLength(12);
    expect(Buffer.from(tag, 'base64url')).toHaveLength(16);
    expect(Buffer.from(ciphertext, 'base64url').byteLength).toBeGreaterThan(0);
    // base64url 不含 + / =，可安全存进 text 列
    expect(sealedSegmentsAreBase64Url([iv, tag, ciphertext])).toBe(true);
  });
});

function sealedSegmentsAreBase64Url(segments: string[]): boolean {
  return segments.every((segment) => /^[A-Za-z0-9_-]*$/.test(segment));
}

describe('secretBox tamper detection', () => {
  it('throws when the ciphertext is tampered with', () => {
    const [version, iv, tag, ciphertext] = splitSealed(seal(PLAINTEXT, KEY));
    const tamperedBytes = Buffer.from(ciphertext, 'base64url');
    tamperedBytes[0] ^= 0xff;
    const tampered = [version, iv, tag, tamperedBytes.toString('base64url')].join(':');

    expect(() => open(tampered, KEY)).toThrow(SecretBoxError);
    expect(() => open(tampered, KEY)).toThrow(/Failed to decrypt/);
  });

  it('throws when the auth tag is tampered with', () => {
    const [version, iv, tag, ciphertext] = splitSealed(seal(PLAINTEXT, KEY));
    const tamperedTag = Buffer.from(tag, 'base64url');
    tamperedTag[0] ^= 0xff;
    const tampered = [version, iv, tamperedTag.toString('base64url'), ciphertext].join(':');

    expect(() => open(tampered, KEY)).toThrow(SecretBoxError);
  });

  it('throws when the iv is tampered with', () => {
    const [version, iv, tag, ciphertext] = splitSealed(seal(PLAINTEXT, KEY));
    const tamperedIv = Buffer.from(iv, 'base64url');
    tamperedIv[0] ^= 0xff;
    const tampered = [version, tamperedIv.toString('base64url'), tag, ciphertext].join(':');

    expect(() => open(tampered, KEY)).toThrow(SecretBoxError);
  });

  it('throws when opened with a wrong key', () => {
    const sealed = seal(PLAINTEXT, KEY);

    try {
      open(sealed, OTHER_KEY);
      expect.unreachable('open() should reject a wrong key');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretBoxError);
      expect((err as SecretBoxError).code).toBe('decrypt_failed');
    }
  });
});

describe('secretBox format validation', () => {
  it('rejects malformed sealed values', () => {
    const cases = ['', 'plain-token', 'v1:only:three', 'v1:a:b:c:d'];

    for (const value of cases) {
      expect(() => open(value, KEY)).toThrow(SecretBoxError);
    }
  });

  it('rejects unsupported versions', () => {
    const sealed = seal(PLAINTEXT, KEY);
    const upgraded = sealed.replace(/^v1:/, 'v2:');

    try {
      open(upgraded, KEY);
      expect.unreachable('open() should reject an unknown version');
    } catch (err) {
      expect((err as SecretBoxError).code).toBe('unsupported_version');
    }
  });

  it('rejects invalid iv/tag lengths', () => {
    const shortIv = ['v1', Buffer.alloc(4).toString('base64url'), Buffer.alloc(16).toString('base64url'), 'AAAA'].join(':');
    const shortTag = ['v1', Buffer.alloc(12).toString('base64url'), Buffer.alloc(4).toString('base64url'), 'AAAA'].join(':');

    expect(() => open(shortIv, KEY)).toThrow(/Invalid iv length/);
    expect(() => open(shortTag, KEY)).toThrow(/Invalid authTag length/);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => seal(PLAINTEXT, Buffer.alloc(16))).toThrow(SecretBoxError);
    expect(() => open(seal(PLAINTEXT, KEY), Buffer.alloc(31))).toThrow(SecretBoxError);
  });
});

describe('secretBox.isSealed', () => {
  it('recognises values produced by seal()', () => {
    expect(isSealed(seal(PLAINTEXT, KEY))).toBe(true);
    expect(isSealed(seal('', KEY))).toBe(true);
  });

  it('rejects empty, plaintext and legacy values', () => {
    expect(isSealed('')).toBe(false);
    expect(isSealed('ghp_plain_text_token')).toBe(false);
    expect(isSealed('v1:short')).toBe(false);
    expect(isSealed('v2:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAA')).toBe(false);
  });

  it('rejects segments with non base64url characters', () => {
    const [, iv, tag, ciphertext] = splitSealed(seal(PLAINTEXT, KEY));

    expect(isSealed(['v1', `${iv}+`, tag, ciphertext].join(':'))).toBe(false);
  });
});

describe('secret key material encoding', () => {
  it('generates 32-byte keys', () => {
    const key = generateSecretKey();

    expect(key).toHaveLength(SECRET_KEY_BYTES);
    expect(open(seal(PLAINTEXT, key), key)).toBe(PLAINTEXT);
  });

  it('round-trips hex encoded keys', () => {
    const key = generateSecretKey();
    const decoded = decodeSecretKey(encodeSecretKey(key));

    expect(isSameSecretKey(key, decoded)).toBe(true);
  });

  it('accepts base64 and base64url key material', () => {
    const key = randomBytes(SECRET_KEY_BYTES);

    expect(isSameSecretKey(decodeSecretKey(key.toString('base64')), key)).toBe(true);
    expect(isSameSecretKey(decodeSecretKey(key.toString('base64url')), key)).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const key = randomBytes(SECRET_KEY_BYTES);

    expect(isSameSecretKey(decodeSecretKey(`  ${key.toString('hex')}\n`), key)).toBe(true);
  });

  it('rejects material that does not decode to 32 bytes', () => {
    expect(() => decodeSecretKey('')).toThrow(SecretBoxError);
    expect(() => decodeSecretKey('too-short')).toThrow(SecretBoxError);
    expect(() => decodeSecretKey('zz'.repeat(32))).toThrow(SecretBoxError);
    expect(() => decodeSecretKey(randomBytes(16).toString('hex'))).toThrow(SecretBoxError);
    expect(() => decodeSecretKey(randomBytes(64).toString('base64'))).toThrow(SecretBoxError);
  });

  it('reports mismatching keys', () => {
    expect(isSameSecretKey(KEY, OTHER_KEY)).toBe(false);
    expect(isSameSecretKey(KEY, Buffer.alloc(16))).toBe(false);
  });
});
