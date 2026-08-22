/**
 * Starting a generated application.
 *
 * These tests exist because nothing started it. The local driver spawned
 * `npm run dev`; the E2B driver — the one production uses — asked E2B for the
 * public hostname of a port and returned it, with no process ever listening on
 * that port. Every preview in production was a URL that resolved and then
 * refused the connection, which is indistinguishable from generated code that
 * does not work.
 *
 * The framework flags below are not interchangeable: Next rejects `--host`,
 * Vite rejects `--hostname`, and Expo's web target is a subcommand. A wrong
 * command fails looking exactly like a bad generation.
 */
import { describe, expect, it } from 'vitest';
import { devCommandFor, devCommandLine, parseManifest } from '../dev-command';

const PORT = 4310;

describe('choosing the dev command', () => {
  it('starts Next on its own flag, bound so the proxy can reach it', () => {
    const command = devCommandFor({ dependencies: { next: '16.0.0' } }, PORT);

    expect(command.framework).toBe('next');
    expect(devCommandLine(command)).toBe(`npx next dev --port ${PORT} --hostname 0.0.0.0`);
  });

  it('starts Vite on its own flag, which is spelled differently', () => {
    const command = devCommandFor({ devDependencies: { vite: '5.0.0' } }, PORT);

    expect(command.framework).toBe('vite');
    expect(devCommandLine(command)).toBe(`npx vite --port ${PORT} --host 0.0.0.0`);
  });

  /*
   * An Expo app also depends on react, and usually on metro. Checked first, so
   * a mobile build is not started with a web framework's command.
   */
  it('starts Expo on the web target, not as a React app', () => {
    const command = devCommandFor(
      { dependencies: { expo: '52.0.0', react: '19.0.0', 'react-native': '0.76.0' } },
      PORT,
    );

    expect(command.framework).toBe('expo');
    expect(devCommandLine(command)).toBe(`npx expo start --web --port ${PORT}`);
  });

  it('prefers Expo over Vite when a mobile project also bundles with it', () => {
    const command = devCommandFor(
      { dependencies: { expo: '52.0.0' }, devDependencies: { vite: '5.0.0' } },
      PORT,
    );
    expect(command.framework).toBe('expo');
  });

  /*
   * Binding to localhost inside a microVM makes the server unreachable from
   * E2B's proxy — the preview URL resolves and refuses, which is the exact
   * symptom of no server at all.
   */
  it('never binds a recognised framework to localhost only', () => {
    for (const manifest of [
      { dependencies: { next: '16' } },
      { devDependencies: { vite: '5' } },
    ]) {
      const line = devCommandLine(devCommandFor(manifest, PORT));
      expect(line).toContain('0.0.0.0');
    }
  });

  it('passes the port through the environment as well, for servers that read it', () => {
    expect(devCommandFor({ scripts: { dev: 'node server.js' } }, PORT).env.PORT).toBe(String(PORT));
    expect(devCommandFor({ scripts: { dev: 'node server.js' } }, PORT).env.HOST).toBe('0.0.0.0');
  });

  /* Nothing recognised: the manifest's own script beats anything invented. */
  it('falls back to the project’s own dev script', () => {
    const command = devCommandFor({ scripts: { dev: 'node server.js' } }, PORT);
    expect(command.framework).toBe('npm-dev');
    expect(devCommandLine(command)).toBe('npm run dev');
  });

  it('falls back to start when there is no dev script', () => {
    const command = devCommandFor({ scripts: { start: 'node index.js' } }, PORT);
    expect(command.framework).toBe('npm-start');
  });

  it('still returns something runnable with no manifest at all', () => {
    const command = devCommandFor(undefined, PORT);
    expect(command.command).toBe('npm');
    expect(command.args.length).toBeGreaterThan(0);
  });

  /* Expo's web target must not be told to open a browser inside a microVM. */
  it('tells the toolchain not to open a browser', () => {
    expect(devCommandFor({ dependencies: { expo: '52' } }, PORT).env.BROWSER).toBe('none');
  });
});

describe('reading a generated manifest', () => {
  it('reads scripts and dependencies', () => {
    const manifest = parseManifest('{"scripts":{"dev":"next dev"},"dependencies":{"next":"16"}}');
    expect(manifest?.scripts?.dev).toBe('next dev');
    expect(manifest?.dependencies?.next).toBe('16');
  });

  /*
   * Written by a language model, so it may not be JSON. An unreadable manifest
   * falls through to the generic command rather than failing the preview.
   */
  it('returns nothing for a manifest that is not JSON', () => {
    expect(parseManifest('not json at all')).toBeUndefined();
    expect(parseManifest('')).toBeUndefined();
    expect(parseManifest(undefined)).toBeUndefined();
  });

  it('returns nothing for JSON that is not an object', () => {
    expect(parseManifest('[1,2,3]')).toBeDefined();
    expect(parseManifest('"a string"')).toBeUndefined();
    expect(parseManifest('null')).toBeUndefined();
  });
});
