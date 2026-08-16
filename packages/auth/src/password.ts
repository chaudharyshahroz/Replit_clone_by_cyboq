/**
 * Password hashing.
 *
 * scrypt from node:crypto — memory-hard, in the standard library, and with no
 * native build step that can break a deployment. Parameters and the algorithm
 * are encoded in the stored string so they can be raised over time and old
 * hashes transparently upgraded on next sign-in.
 *
 * Stored format:  scrypt$N$r$p$<salt b64url>$<derived key b64url>
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Current cost. Raise N over time; existing hashes carry their own parameters. */
const PARAMS = { N: 2 ** 16, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** scrypt needs roughly 128 * N * r bytes; give headroom or it throws. */
const maxmemFor = (N: number, r: number): number => 256 * N * r;

const b64 = (buf: Buffer): string => buf.toString('base64url');

/**
 * Minimum length only. Composition rules (a digit, a symbol, …) measurably
 * reduce real-world password strength by pushing users to predictable patterns;
 * length is what matters.
 */
export const PASSWORD_MIN_LENGTH = 10;
/** Bound the input so a huge body cannot be used to burn CPU. */
export const PASSWORD_MAX_LENGTH = 512;

export function validatePasswordStrength(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Passwords must be shorter than ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return undefined;
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error('Password exceeds maximum length.');
  }
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: maxmemFor(PARAMS.N, PARAMS.r),
  });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${b64(salt)}$${b64(derived)}`;
}

export interface PasswordVerification {
  readonly valid: boolean;
  /** True when the stored hash used weaker parameters than the current policy. */
  readonly needsRehash: boolean;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<PasswordVerification> {
  const fail: PasswordVerification = { valid: false, needsRehash: false };

  if (password.length > PASSWORD_MAX_LENGTH) return fail;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return fail;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return fail;
  // Refuse absurd parameters from a tampered row rather than allocating GBs.
  if (N < 2 ** 12 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return fail;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'base64url');
    expected = Buffer.from(parts[5]!, 'base64url');
  } catch {
    return fail;
  }
  if (salt.length === 0 || expected.length === 0) return fail;

  let actual: Buffer;
  try {
    actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    });
  } catch {
    return fail;
  }

  const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
  return {
    valid,
    needsRehash: valid && (N < PARAMS.N || r < PARAMS.r || p < PARAMS.p),
  };
}

/**
 * Burn comparable CPU when no account exists for an email.
 *
 * Without this, a sign-in attempt for an unknown address returns measurably
 * faster than one for a known address, which turns the login form into an
 * account-enumeration oracle.
 */
export async function fakeVerifyDelay(): Promise<void> {
  const salt = randomBytes(SALT_LENGTH);
  await scrypt('decoy-password-comparison', salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: maxmemFor(PARAMS.N, PARAMS.r),
  }).catch(() => undefined);
}
