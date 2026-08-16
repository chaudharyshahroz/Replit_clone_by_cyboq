import { describe, expect, it } from 'vitest';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import {
  hashPassword,
  PASSWORD_MIN_LENGTH,
  validatePasswordStrength,
  verifyPassword,
} from '../password';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

describe('hashPassword / verifyPassword', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    const result = await verifyPassword('correct horse battery staple', hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect((await verifyPassword('Correct horse battery staple', hash)).valid).toBe(false);
    expect((await verifyPassword('', hash)).valid).toBe(false);
  });

  it('never stores the plaintext', async () => {
    const hash = await hashPassword('my-secret-password');
    expect(hash).not.toContain('my-secret-password');
  });

  it('salts, so identical passwords produce different hashes', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
    expect((await verifyPassword('same-password', a)).valid).toBe(true);
    expect((await verifyPassword('same-password', b)).valid).toBe(true);
  });

  it('encodes its parameters so cost can be raised later', async () => {
    const hash = await hashPassword('whatever-goes-here');
    const [algorithm, N, r, p] = hash.split('$');
    expect(algorithm).toBe('scrypt');
    expect(Number(N)).toBeGreaterThanOrEqual(2 ** 16);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it('verifies a genuinely weaker legacy hash and flags it for upgrade', async () => {
    // Build a real hash under an older, cheaper policy so the derived key is
    // actually valid — otherwise the assertion would pass for the wrong reason.
    const legacyN = 2 ** 14;
    const salt = randomBytes(16);
    const key = await scryptAsync('legacy-password-value', salt, 64, {
      N: legacyN,
      r: 8,
      p: 1,
      maxmem: 256 * legacyN * 8,
    });
    const legacy = [
      'scrypt',
      legacyN,
      8,
      1,
      salt.toString('base64url'),
      key.toString('base64url'),
    ].join('$');

    const result = await verifyPassword('legacy-password-value', legacy);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it('normalizes unicode so the same rendered password verifies', async () => {
    // U+00E9 vs e + U+0301 look identical to a user but differ byte-for-byte.
    const composed = 'passw\u00e9rd-long-enough';
    const decomposed = 'passwe\u0301rd-long-enough';
    expect(composed).not.toBe(decomposed);
    expect(composed.normalize('NFKC')).toBe(decomposed.normalize('NFKC'));

    const hash = await hashPassword(composed);
    expect((await verifyPassword(decomposed, hash)).valid).toBe(true);
  });

  describe('malformed stored hashes', () => {
    it.each([
      ['empty', ''],
      ['not our format', 'plaintext-password'],
      ['wrong algorithm', 'bcrypt$1$2$3$c2FsdA$a2V5'],
      ['too few segments', 'scrypt$65536$8$c2FsdA'],
      ['non-numeric params', 'scrypt$abc$8$1$c2FsdA$a2V5'],
      ['empty salt', 'scrypt$65536$8$1$$a2V5'],
    ])('rejects %s without throwing', async (_label, stored) => {
      await expect(verifyPassword('any-password', stored)).resolves.toEqual({
        valid: false,
        needsRehash: false,
      });
    });

    // A tampered row must not be able to make the server allocate gigabytes.
    it('refuses absurd cost parameters', async () => {
      const result = await verifyPassword('pw', 'scrypt$1073741824$32$16$c2FsdA$a2V5');
      expect(result.valid).toBe(false);
    });
  });
});

describe('validatePasswordStrength', () => {
  it('requires a minimum length', () => {
    expect(validatePasswordStrength('short')).toMatch(/at least/);
    expect(validatePasswordStrength('a'.repeat(PASSWORD_MIN_LENGTH))).toBeUndefined();
  });

  it('rejects absurdly long input', () => {
    expect(validatePasswordStrength('a'.repeat(1000))).toMatch(/shorter/);
  });

  // Composition rules push users toward predictable patterns; length is the
  // property that actually matters.
  it('accepts a long passphrase with no symbols or digits', () => {
    expect(validatePasswordStrength('correct horse battery staple')).toBeUndefined();
  });
});
