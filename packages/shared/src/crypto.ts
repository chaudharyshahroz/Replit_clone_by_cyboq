/**
 * Envelope encryption for secrets held on behalf of users — GitHub / Vercel /
 * Supabase OAuth tokens, MCP server credentials, and integration API keys.
 *
 * AES-256-GCM, random 96-bit IV per record, authenticated with an associated
 * data (AAD) binding. The AAD is the critical detail: a ciphertext stolen from
 * one row cannot be replayed into another, because decryption fails unless the
 * caller supplies the same logical owner. That turns a database-write primitive
 * into something that cannot be used to move another workspace's token onto
 * your own connection row.
 *
 * Stored format (single string, safe for a text column):
 *
 *     v1.<iv b64url>.<authTag b64url>.<ciphertext b64url>
 *
 * The version prefix exists so key rotation and algorithm changes can be rolled
 * out without a destructive migration.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM-recommended size
const AUTH_TAG_LENGTH = 16;
const VERSION = 'v1';

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

function toKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('Encryption key must decode to exactly 32 bytes (openssl rand -base64 32).');
  }
  return key;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');
const fromB64url = (s: string): Buffer => Buffer.from(s, 'base64url');

export interface SecretBox {
  /**
   * Encrypt a secret bound to `aad`.
   *
   * @param plaintext the secret value
   * @param aad a stable, non-secret identifier for what this ciphertext belongs
   *            to — for example `connection:con_abc123`. It is authenticated but
   *            not stored, so the caller must supply the identical value to
   *            decrypt.
   */
  encrypt(plaintext: string, aad: string): string;
  /** Decrypt, verifying both the auth tag and the AAD binding. */
  decrypt(payload: string, aad: string): string;
  /**
   * Decrypt with the current key, transparently falling back to the previous
   * key during rotation. Returns the plaintext plus whether it needs re-writing
   * under the current key.
   */
  decryptForRotation(payload: string, aad: string): { plaintext: string; needsRewrap: boolean };
  /** Deterministic, non-reversible lookup token (see below). */
  blindIndex(value: string): string;
}

export interface SecretBoxOptions {
  readonly key: string;
  /** Set during key rotation; decryption falls back to it. */
  readonly previousKey?: string | undefined;
}

export function createSecretBox(options: SecretBoxOptions): SecretBox {
  const primary = toKey(options.key);
  const previous = options.previousKey ? toKey(options.previousKey) : undefined;

  function encryptWith(key: Buffer, plaintext: string, aad: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [VERSION, b64url(iv), b64url(authTag), b64url(ciphertext)].join('.');
  }

  function decryptWith(key: Buffer, payload: string, aad: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4) {
      throw new DecryptionError('Malformed ciphertext: expected 4 dot-separated segments.');
    }
    const [version, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
    if (version !== VERSION) {
      throw new DecryptionError(`Unsupported ciphertext version "${version}".`);
    }

    const iv = fromB64url(ivPart);
    const authTag = fromB64url(tagPart);
    const ciphertext = fromB64url(dataPart);

    if (iv.length !== IV_LENGTH) throw new DecryptionError('Malformed ciphertext: bad IV length.');
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new DecryptionError('Malformed ciphertext: bad auth tag length.');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(authTag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Deliberately opaque: distinguishing "wrong key" from "wrong AAD" from
      // "tampered ciphertext" is an oracle. The caller only needs "no".
      throw new DecryptionError(
        'Secret could not be decrypted. The key may have rotated, or the record does not belong to this owner.',
      );
    }
  }

  return {
    encrypt: (plaintext, aad) => encryptWith(primary, plaintext, aad),

    decrypt: (payload, aad) => decryptWith(primary, payload, aad),

    decryptForRotation(payload, aad) {
      try {
        return { plaintext: decryptWith(primary, payload, aad), needsRewrap: false };
      } catch (error) {
        if (!previous) throw error;
        return { plaintext: decryptWith(previous, payload, aad), needsRewrap: true };
      }
    },

    /**
     * A keyed, deterministic digest used to look a secret up without storing it
     * in a reversible form — for example, finding which connection a webhook's
     * token belongs to. Keyed with the encryption key so that a leaked database
     * alone does not permit an offline dictionary attack the way a bare SHA-256
     * would.
     */
    blindIndex(value: string): string {
      return createHmac('sha256', primary).update(value, 'utf8').digest('base64url');
    },
  };
}

/** Constant-time string comparison for tokens and signatures. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which itself leaks length. Hash
  // both to a fixed width first so the comparison is uniform.
  const hashA = createHmac('sha256', 'length-normalizer').update(bufA).digest();
  const hashB = createHmac('sha256', 'length-normalizer').update(bufB).digest();
  return timingSafeEqual(hashA, hashB);
}

/** Cryptographically random, URL-safe token — OAuth state, invite codes, API keys. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Redact a secret for display: keep a short prefix so a user can recognise
 * *which* key this is, hide everything else.
 */
export function maskSecret(secret: string, visiblePrefix = 6): string {
  if (secret.length <= visiblePrefix) return '•'.repeat(8);
  return `${secret.slice(0, visiblePrefix)}${'•'.repeat(Math.min(24, secret.length - visiblePrefix))}`;
}
