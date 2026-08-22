/**
 * How to actually start a generated application.
 *
 * This exists because nothing did. The local sandbox driver spawned
 * `npm run dev`; the E2B driver — the one production uses — only asked E2B for
 * the public hostname of a port and returned it. No process was ever started,
 * so every preview in production was a URL pointing at a port with nothing
 * listening. Build looked like it worked right up to the moment someone
 * clicked the preview.
 *
 * The command is derived from the generated `package.json` rather than assumed,
 * because the frameworks disagree in ways that matter:
 *
 *   - Next.js takes `--hostname`, Vite takes `--host`, and each rejects the
 *     other's flag outright rather than ignoring it.
 *   - Expo's web target is a subcommand, not a flag on `dev`.
 *   - A dev server that binds to localhost is unreachable from outside the
 *     microVM, so the preview URL resolves and then refuses the connection —
 *     the same symptom as no server at all.
 */

/** The parts of a generated package.json that decide how it starts. */
export interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

export interface DevCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** Set on the process, for frameworks that read the port from the env. */
  readonly env: Readonly<Record<string, string>>;
  /** Which framework this was chosen for, for logs and tests. */
  readonly framework: string;
}

/** Every dependency the manifest declares, whichever section it is in. */
function dependencyNames(manifest: PackageManifest): Set<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
}

/**
 * Read a manifest without trusting it.
 *
 * The file was written by a language model, so it may not be JSON at all.
 * An unreadable manifest is not a crash — it falls through to the generic
 * command, which is the same thing a developer would try.
 */
export function parseManifest(source: string | undefined): PackageManifest | undefined {
  if (!source) return undefined;
  try {
    const parsed: unknown = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? (parsed as PackageManifest) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The command that starts this application on `port`, reachable from outside.
 *
 * `0.0.0.0` throughout, deliberately. Inside a microVM a server bound to
 * localhost is reachable only by the microVM itself, and E2B's proxy — which
 * is what makes the preview URL work — is not inside it.
 */
export function devCommandFor(
  manifest: PackageManifest | undefined,
  port: number,
): DevCommand {
  const deps = manifest ? dependencyNames(manifest) : new Set<string>();
  const scripts = manifest?.scripts ?? {};
  const env = { PORT: String(port), HOST: '0.0.0.0', BROWSER: 'none' };

  /*
   * Expo first. An Expo app also depends on react and often on metro, so
   * checking it after the web frameworks would mis-detect it — and starting an
   * Expo project with a Next.js command fails in a way that reads like broken
   * generated code rather than a wrong command.
   */
  if (deps.has('expo')) {
    return {
      command: 'npx',
      args: ['expo', 'start', '--web', '--port', String(port)],
      env,
      framework: 'expo',
    };
  }

  if (deps.has('next')) {
    return {
      command: 'npx',
      args: ['next', 'dev', '--port', String(port), '--hostname', '0.0.0.0'],
      env,
      framework: 'next',
    };
  }

  if (deps.has('vite')) {
    return {
      command: 'npx',
      args: ['vite', '--port', String(port), '--host', '0.0.0.0'],
      env,
      framework: 'vite',
    };
  }

  /*
   * No framework recognised. The manifest's own script is a better guess than
   * anything invented here — it was written alongside the code it starts — and
   * the port travels by environment, which is the one convention every Node
   * server shares.
   */
  if (typeof scripts.dev === 'string') {
    return { command: 'npm', args: ['run', 'dev'], env, framework: 'npm-dev' };
  }
  if (typeof scripts.start === 'string') {
    return { command: 'npm', args: ['start'], env, framework: 'npm-start' };
  }

  return { command: 'npm', args: ['start'], env, framework: 'unknown' };
}

/** The command as one shell string, for drivers that take one. */
export function devCommandLine(command: DevCommand): string {
  return [command.command, ...command.args].join(' ');
}
