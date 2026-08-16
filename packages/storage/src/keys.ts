/**
 * Storage key construction and validation.
 *
 * Every key is built here from a workspace id and a server-generated file id.
 * User input never becomes a path component — the original filename is stored
 * as metadata only. This is what makes traversal (`../../secrets`) and
 * cross-tenant reads structurally impossible rather than merely unlikely.
 */
import { StorageError } from './types';

export type StorageScope = 'uploads' | 'artifacts' | 'exports' | 'builds' | 'media' | 'tmp';

/**
 * `workspaceId/scope/fileId[/suffix]`
 *
 * Leading the key with the workspace id means a misconfigured bucket policy
 * fails closed per tenant, and lets lifecycle rules target one workspace.
 */
export function buildKey(params: {
  readonly workspaceId: string;
  readonly scope: StorageScope;
  readonly fileId: string;
  /** Optional server-chosen suffix, e.g. `thumb.webp`. Never user input. */
  readonly suffix?: string;
}): string {
  const { workspaceId, scope, fileId, suffix } = params;

  for (const [label, value] of [
    ['workspaceId', workspaceId],
    ['fileId', fileId],
  ] as const) {
    if (!/^[a-z]{3}_[0-9a-z]{25}$/.test(value)) {
      throw new StorageError('INVALID_KEY', `${label} is not a valid Reklu id: ${value}`);
    }
  }

  const key = `${workspaceId}/${scope}/${fileId}${suffix ? `/${sanitizeSuffix(suffix)}` : ''}`;
  assertSafeKey(key);
  return key;
}

/** Server-chosen suffixes are still normalized, as defence in depth. */
function sanitizeSuffix(suffix: string): string {
  const cleaned = suffix.replace(/[^A-Za-z0-9._-]/g, '');
  if (cleaned.length === 0 || cleaned.startsWith('.')) {
    throw new StorageError('INVALID_KEY', `Unsafe key suffix: ${suffix}`);
  }
  return cleaned;
}

/**
 * Reject anything that could escape its prefix or confuse a filesystem.
 * Applied to every key on both read and write paths.
 */
export function assertSafeKey(key: string): void {
  if (key.length === 0 || key.length > 512) {
    throw new StorageError('INVALID_KEY', 'Key length out of range.');
  }
  if (key.startsWith('/') || key.includes('//')) {
    throw new StorageError('INVALID_KEY', `Key must be relative and single-slashed: ${key}`);
  }
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new StorageError('INVALID_KEY', `Key contains a traversal segment: ${key}`);
  }
  // Control characters, backslashes and NUL all have surprising filesystem or
  // header behaviour; none are ever legitimate in a generated key.
  if (/[\u0000-\u001f\u007f\\]/.test(key)) {
    throw new StorageError('INVALID_KEY', 'Key contains a control character or backslash.');
  }
  if (!/^[A-Za-z0-9/._-]+$/.test(key)) {
    throw new StorageError('INVALID_KEY', `Key contains an unsupported character: ${key}`);
  }
}

/** The workspace a key belongs to, for authorization checks before a read. */
export function workspaceIdFromKey(key: string): string | undefined {
  const first = key.split('/')[0];
  return first && /^wsp_[0-9a-z]{25}$/.test(first) ? first : undefined;
}

/**
 * Make a user-supplied filename safe for a Content-Disposition header.
 * Used for display and download only — never for the key.
 */
export function safeDisplayFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'download';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : 'download';
}
