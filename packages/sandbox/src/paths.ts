/**
 * Path containment for sandbox file operations.
 *
 * Generated code decides these paths. A model asked to "add a config file" can
 * emit `../../../.env`, and a model following a prompt-injected instruction in
 * an imported repository can do so deliberately. So every path is validated
 * before use and the resolved location is re-checked against the root — the
 * same belt-and-braces the storage driver uses, for the same reason: a path
 * validated at one layer and used at another is where traversal survives.
 */
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { SandboxError } from './types';

/** Paths generated code must never write, even inside its own directory. */
const FORBIDDEN_SEGMENTS = new Set(['.git', '.ssh', '.aws', '.npmrc', '.env']);

/**
 * Validate a sandbox-relative path.
 *
 * Rejects absolute paths, traversal, control characters, and dotfiles that
 * carry credentials. Returns the normalized relative path.
 */
export function assertSafeRelativePath(candidate: string): string {
  if (candidate.length === 0) {
    throw new SandboxError('UNSAFE_PATH', 'Empty path');
  }
  if (candidate.length > 400) {
    throw new SandboxError('UNSAFE_PATH', `Path is too long: ${candidate.slice(0, 60)}…`);
  }
  if (isAbsolute(candidate)) {
    throw new SandboxError('UNSAFE_PATH', `Absolute paths are not permitted: ${candidate}`);
  }
  // Backslashes and control characters have surprising behaviour across
  // platforms and are never legitimate in a generated project path.
  if (/[\u0000-\u001f\u007f\\]/.test(candidate)) {
    throw new SandboxError('UNSAFE_PATH', 'Path contains a control character or backslash');
  }

  const normalized = normalize(candidate).replace(/^\.\//, '');
  const segments = normalized.split('/');

  if (segments.some((segment) => segment === '..')) {
    throw new SandboxError('UNSAFE_PATH', `Path escapes the sandbox: ${candidate}`);
  }
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      throw new SandboxError('UNSAFE_PATH', `Path touches a protected location: ${segment}`);
    }
  }

  return normalized;
}

/**
 * Resolve a relative path inside a root, proving the result stays contained.
 *
 * The second check matters: symlinks and normalization quirks mean a path that
 * passed the string check can still resolve outside.
 */
export function resolveInside(root: string, candidate: string): string {
  const safeRelative = assertSafeRelativePath(candidate);
  const absoluteRoot = resolve(root);
  const full = resolve(absoluteRoot, safeRelative);

  const rel = relative(absoluteRoot, full);
  if (rel.startsWith('..') || rel.startsWith(sep) || isAbsolute(rel)) {
    throw new SandboxError('UNSAFE_PATH', `Resolved path escapes the sandbox root: ${candidate}`);
  }
  return full;
}

/**
 * A minimal environment for a child process.
 *
 * Reklu's own `process.env` is deliberately **not** spread in: it holds
 * provider keys, the database URL and the encryption key, and generated code
 * has no business seeing any of them (spec §36).
 */
export function isolatedEnv(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp',
    // Keeps npm from writing to the real user's cache or reading their config.
    NPM_CONFIG_CACHE: '/tmp/.npm-cache',
    NPM_CONFIG_USERCONFIG: '/tmp/.npmrc',
    CI: '1',
    NODE_ENV: 'development',
    ...extra,
  };
}
