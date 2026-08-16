/**
 * Result type for operations whose failure is an expected outcome rather than
 * an exception — provider fallback, partial research retrieval, tool execution.
 *
 * Reklu deliberately does not use this everywhere. Exceptions remain correct for
 * programmer error and for genuinely exceptional conditions. `Result` is for the
 * cases where the caller must be *forced* to consider failure, most importantly
 * anywhere partial success has to be reported honestly to the user.
 */
import type { RekluError } from './errors';

export type Result<T, E = RekluError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}
export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export function mapResult<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/**
 * The outcome of a batch where some members may fail — research source fetching
 * is the canonical case. Keeping failures alongside successes is what lets the
 * UI say "14 of 18 sources retrieved" instead of rounding up to success.
 */
export interface PartialResult<T, E = RekluError> {
  readonly succeeded: readonly T[];
  readonly failed: readonly { readonly input: string; readonly error: E }[];
  readonly attempted: number;
}

export function partial<T, E>(
  succeeded: readonly T[],
  failed: readonly { input: string; error: E }[],
): PartialResult<T, E> {
  return { succeeded, failed, attempted: succeeded.length + failed.length };
}

/** True when at least one member failed — the signal to report partial success. */
export function isPartial<T, E>(r: PartialResult<T, E>): boolean {
  return r.failed.length > 0;
}

/** Run `fn`, converting a throw into an `err`. */
export async function attempt<T>(
  fn: () => Promise<T>,
  onError: (thrown: unknown) => RekluError,
): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (thrown) {
    return err(onError(thrown));
  }
}
