/**
 * Sandbox abstraction (spec §36).
 *
 * The non-negotiable rule, restated because everything here exists to serve it:
 *
 *   **Generated code never executes in the Reklu app or worker process.**
 *
 * User prompts produce arbitrary code. Arbitrary code inside the application
 * process is a full compromise — provider keys, the database URL, the
 * encryption key, and every workspace's data live in that process. So execution
 * always crosses a boundary, and the only question is how strong the boundary
 * is.
 *
 * Three drivers, in increasing order of isolation:
 *
 *   local   — a subprocess in a scratch directory. **No real isolation.**
 *             Development only; `loadServerEnv()` refuses to start production
 *             with SANDBOX_DRIVER=local.
 *   docker  — a container with no network by default and dropped capabilities.
 *   e2b     — a managed microVM.
 */

export type SandboxDriverName = 'local' | 'docker' | 'e2b';

export interface SandboxLimits {
  readonly timeoutMs: number;
  readonly memoryMb: number;
  readonly diskMb: number;
  /** Bytes of combined stdout/stderr retained; beyond this, output is truncated. */
  readonly maxOutputBytes: number;
}

export interface SandboxHandle {
  readonly id: string;
  readonly driver: SandboxDriverName;
  /** Driver-specific identifier (container id, microVM id, or local path). */
  readonly externalId: string;
  readonly limits: SandboxLimits;
  /**
   * True when this driver actually isolates. False for `local`, and surfaced in
   * the UI so nobody mistakes a development convenience for a security boundary.
   */
  readonly isIsolated: boolean;
}

export interface WriteFile {
  /** Sandbox-relative path. Traversal is rejected before any write. */
  readonly path: string;
  readonly content: string;
  /** Base64 for binary files — an image written into `public/`, typically. */
  readonly encoding?: 'utf8' | 'base64';
}

export interface ExecOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  /**
   * Environment for the child.
   *
   * Deliberately **not** merged with `process.env`: Reklu's own secrets must
   * never be visible to generated code. Drivers pass exactly what is listed
   * here plus a minimal PATH.
   */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  /** True when output hit `maxOutputBytes` and was cut. */
  readonly truncated: boolean;
}

/**
 * How to start the application being previewed.
 *
 * Passed in rather than assumed by the driver, because only the caller has read
 * the generated package.json — and the frameworks disagree about flags in ways
 * that make a wrong guess fail exactly like broken generated code.
 */
/** Anything the driver needs to know at creation time. */
export interface CreateOptions {
  /**
   * The port a preview will later listen on.
   *
   * Needed up front by container runtimes: a published port is fixed when the
   * container is created and cannot be added to a running one. Without it the
   * preview server starts, listens, and is reachable by nothing.
   */
  readonly publishPort?: number;
}

export interface PreviewCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface PreviewHandle {
  readonly url: string;
  readonly port: number;
  stop(): Promise<void>;
}

export interface SandboxDriver {
  readonly name: SandboxDriverName;
  readonly isIsolated: boolean;
  /** False when this deployment lacks what the driver needs. */
  isConfigured(): boolean;

  create(
    sandboxId: string,
    limits: SandboxLimits,
    options?: CreateOptions,
  ): Promise<SandboxHandle>;
  writeFiles(handle: SandboxHandle, files: readonly WriteFile[]): Promise<void>;
  readFile(handle: SandboxHandle, path: string): Promise<string | undefined>;
  listFiles(handle: SandboxHandle): Promise<readonly string[]>;
  exec(handle: SandboxHandle, options: ExecOptions): Promise<ExecResult>;
  startPreview(
    handle: SandboxHandle,
    port: number,
    command?: PreviewCommand,
  ): Promise<PreviewHandle>;
  destroy(handle: SandboxHandle): Promise<void>;
}

export class SandboxError extends Error {
  readonly code:
    | 'UNSAFE_PATH'
    | 'NOT_CONFIGURED'
    | 'LIMIT_EXCEEDED'
    | 'TIMEOUT'
    | 'DRIVER_ERROR';

  constructor(code: SandboxError['code'], message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SandboxError';
    this.code = code;
  }
}

export const DEFAULT_LIMITS: SandboxLimits = {
  timeoutMs: 600_000,
  memoryMb: 2_048,
  diskMb: 1_024,
  maxOutputBytes: 512_000,
};
