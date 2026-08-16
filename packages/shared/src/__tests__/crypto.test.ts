import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createSecretBox, DecryptionError, maskSecret, randomToken, safeEqual } from '../crypto';

const key = () => randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('round-trips a secret bound to its owner', () => {
    const box = createSecretBox({ key: key() });
    const token = 'gho_averyrealisticlookinggithubtoken';
    const sealed = box.encrypt(token, 'connection:con_abc');
    expect(sealed).not.toContain(token);
    expect(box.decrypt(sealed, 'connection:con_abc')).toBe(token);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const box = createSecretBox({ key: key() });
    const a = box.encrypt('same', 'aad');
    const b = box.encrypt('same', 'aad');
    expect(a).not.toBe(b);
    expect(box.decrypt(a, 'aad')).toBe(box.decrypt(b, 'aad'));
  });

  // This is the property that stops a stolen ciphertext being replayed onto a
  // different connection row.
  it('refuses to decrypt under a different owner', () => {
    const box = createSecretBox({ key: key() });
    const sealed = box.encrypt('secret', 'connection:con_victim');
    expect(() => box.decrypt(sealed, 'connection:con_attacker')).toThrow(DecryptionError);
  });

  it('refuses to decrypt under a different key', () => {
    const sealed = createSecretBox({ key: key() }).encrypt('secret', 'aad');
    expect(() => createSecretBox({ key: key() }).decrypt(sealed, 'aad')).toThrow(DecryptionError);
  });

  it('detects tampering with the ciphertext body', () => {
    const box = createSecretBox({ key: key() });
    const sealed = box.encrypt('secret-value', 'aad');
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3]!, 'base64url');
    body[0] = body[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], body.toString('base64url')].join('.');
    expect(() => box.decrypt(tampered, 'aad')).toThrow(DecryptionError);
  });

  it('rejects malformed payloads without leaking why', () => {
    const box = createSecretBox({ key: key() });
    expect(() => box.decrypt('not-a-payload', 'aad')).toThrow(DecryptionError);
    expect(() => box.decrypt('v9.a.b.c', 'aad')).toThrow(/version/i);
  });

  describe('key rotation', () => {
    it('decrypts old ciphertext with the previous key and flags it for rewrap', () => {
      const oldKey = key();
      const newKey = key();
      const sealed = createSecretBox({ key: oldKey }).encrypt('legacy', 'aad');

      const rotated = createSecretBox({ key: newKey, previousKey: oldKey });
      const result = rotated.decryptForRotation(sealed, 'aad');

      expect(result.plaintext).toBe('legacy');
      expect(result.needsRewrap).toBe(true);
    });

    it('does not flag rewrap for ciphertext already under the current key', () => {
      const oldKey = key();
      const newKey = key();
      const box = createSecretBox({ key: newKey, previousKey: oldKey });
      const result = box.decryptForRotation(box.encrypt('fresh', 'aad'), 'aad');
      expect(result.needsRewrap).toBe(false);
    });
  });

  describe('blindIndex', () => {
    it('is deterministic for the same key and value', () => {
      const k = key();
      expect(createSecretBox({ key: k }).blindIndex('v')).toBe(
        createSecretBox({ key: k }).blindIndex('v'),
      );
    });

    it('differs across keys, so a leaked table is not searchable offline', () => {
      expect(createSecretBox({ key: key() }).blindIndex('v')).not.toBe(
        createSecretBox({ key: key() }).blindIndex('v'),
      );
    });

    it('does not contain the plaintext', () => {
      const index = createSecretBox({ key: key() }).blindIndex('super-secret');
      expect(index).not.toContain('super-secret');
    });
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => createSecretBox({ key: randomBytes(16).toString('base64') })).toThrow(/32 bytes/);
  });
});

describe('safeEqual', () => {
  it('matches identical strings and rejects others, including by length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcdef')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('randomToken', () => {
  it('is URL-safe and unique', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('maskSecret', () => {
  it('keeps a recognisable prefix and hides the rest', () => {
    const masked = maskSecret('sk-ant-api03-abcdefghijklmnop');
    expect(masked.startsWith('sk-ant')).toBe(true);
    expect(masked).not.toContain('abcdefghijklmnop');
  });

  it('reveals nothing for very short values', () => {
    expect(maskSecret('abc')).toBe('••••••••');
  });
});
