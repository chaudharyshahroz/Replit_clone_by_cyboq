/**
 * Verifies that `.env.production.example` is a configuration Reklu will
 * actually boot on.
 *
 * The example file is the thing an operator pastes into Dokploy. If it drifts
 * from the environment schema — a renamed variable, a new required field, a
 * value the guards reject — the failure surfaces as a crash-looping container
 * on a live host. This catches it here instead.
 *
 * Run: pnpm verify:production-config
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { featuresFor, loadServerEnv, resetServerEnvCache } from '../src/env';

// packages/shared/scripts -> monorepo root
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let failures = 0;
const check = (label: string, pass: boolean, detail = ''): void => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Parse the example the same way a container runtime would read an env file. */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const example = parseEnvFile(join(root, '.env.production.example'));

/**
 * Values the operator fills in, plus the two the compose file injects from the
 * service names. Everything else comes from the example verbatim.
 */
const filled = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({
    ...example,
    NODE_ENV: 'production',
    AUTH_SECRET: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    DATABASE_URL: 'postgresql://reklu:pw@postgres:5432/reklu',
    REDIS_URL: 'redis://redis:6379',
    ANTHROPIC_API_KEY: 'sk-ant-placeholder',
    ...overrides,
  }) as NodeJS.ProcessEnv;

const attempt = (env: NodeJS.ProcessEnv): { ok: boolean; message: string } => {
  resetServerEnvCache();
  try {
    loadServerEnv(env);
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

console.log('\n1. The shipped example boots once the operator fills in its blanks');
const primary = attempt(filled());
check('accepted by the environment schema', primary.ok, primary.message.split('\n')[0] ?? '');

console.log('\n2. It declares the domain it was written for');
check('APP_URL is https', (example.APP_URL ?? '').startsWith('https://'), example.APP_URL);
check('APP_URL is reklu.app', example.APP_URL === 'https://reklu.app');
check(
  'no NODE_ENV in the file — the image sets it',
  example.NODE_ENV === undefined,
  'a development React bundle otherwise ships to production',
);
check(
  'no DATABASE_URL/REDIS_URL — compose derives them',
  example.DATABASE_URL === undefined && example.REDIS_URL === undefined,
);

console.log('\n3. Every secret is left blank to be filled in');
for (const name of ['POSTGRES_PASSWORD', 'AUTH_SECRET', 'ENCRYPTION_KEY']) {
  check(`${name} ships empty`, (example[name] ?? '') === '');
}

/**
 * Regression: an earlier draft annotated values inline (`APP_URL=https://reklu.app
 * # must be https`). Docker Compose has not always stripped that, so APP_URL
 * arrived with its own comment appended and failed URL validation on the host.
 * Comments belong on their own line.
 */
console.log('\n4. No value carries a trailing comment');
const annotated = Object.entries(example).filter(([, value]) => value.includes('#'));
check(
  'every comment is on its own line',
  annotated.length === 0,
  annotated.map(([name]) => name).join(', '),
);

console.log('\n5. The escape hatches it selects are the ones it explains');
resetServerEnvCache();
const features = featuresFor(loadServerEnv(filled()));
check('Build is off, so no generated code can run', features.build === false);
check('storage counts as durable via the single-node volume', features.durableStorage === true);
check('embeddings report unavailable rather than pretending', features.embeddings === false);
check('an AI provider is required and present', features.anyModelProvider === true);

console.log("\n6. Removing an operator-supplied value still fails loudly");
const noProvider = attempt(filled({ ANTHROPIC_API_KEY: '' }));
check('no AI key is rejected', !noProvider.ok, noProvider.message.split('\n').slice(-1)[0] ?? '');

const buildOnUnisolated = attempt(filled({ BUILD_ENABLED: 'true' }));
check(
  'turning Build on without isolation is rejected',
  !buildOnUnisolated.ok && /real isolation/.test(buildOnUnisolated.message),
);

const noAck = attempt(filled({ STORAGE_LOCAL_SINGLE_NODE_ACK: 'false' }));
check(
  'local storage without the acknowledgement is rejected',
  !noAck.ok && /STORAGE_LOCAL_SINGLE_NODE_ACK/.test(noAck.message),
);

const httpUrl = attempt(filled({ APP_URL: 'http://reklu.app' }));
check('plaintext http is rejected', !httpUrl.ok && /https/.test(httpUrl.message));

console.log(
  failures === 0
    ? '\nAll checks passed. .env.production.example is deployable.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
