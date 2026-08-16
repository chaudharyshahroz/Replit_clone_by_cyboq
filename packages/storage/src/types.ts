/**
 * Object storage abstraction (spec §8).
 *
 * Two drivers: `s3` for anything S3-compatible (AWS, R2, MinIO) and `local` for
 * development. The interface is deliberately narrow — put, get, delete, signed
 * URL, exists — so a third driver never needs to reimplement semantics the
 * callers depend on.
 *
 * Keys are always **server-generated**. User-supplied filenames are metadata,
 * never path components: a filename like `../../etc/passwd` must be
 * structurally incapable of escaping its prefix.
 */

export interface PutOptions {
  readonly key: string;
  readonly body: Buffer | Uint8Array;
  readonly contentType: string;
  /** Original filename, echoed back in Content-Disposition on download. */
  readonly filename?: string;
  /** Additional non-sensitive metadata stored alongside the object. */
  readonly metadata?: Record<string, string>;
}

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
  readonly checksum: string;
}

export interface GetResult {
  readonly body: Buffer;
  readonly contentType: string;
  readonly size: number;
}

export interface SignedUrlOptions {
  readonly key: string;
  readonly expiresInSeconds?: number;
  /** Forces a download with this filename rather than inline rendering. */
  readonly downloadFilename?: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  /** True when objects survive a process restart and are safe for production. */
  readonly isDurable: boolean;

  put(options: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<GetResult>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * A time-limited URL. Reklu never serves user uploads from its own origin
   * with a permanent public URL — that would make an object's key its
   * permission.
   */
  signedUrl(options: SignedUrlOptions): Promise<string>;
}

export class StorageError extends Error {
  readonly code: 'NOT_FOUND' | 'INVALID_KEY' | 'TOO_LARGE' | 'DRIVER_ERROR';
  constructor(code: StorageError['code'], message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'StorageError';
    this.code = code;
  }
}
