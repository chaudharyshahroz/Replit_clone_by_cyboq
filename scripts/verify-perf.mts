/**
 * Performance budgets (spec §111, §150).
 *
 * Checks the two things that actually decide how a page feels and that can be
 * measured without a browser: how much JavaScript the client must download,
 * and how fast the server answers.
 *
 * A budget only works if it fails. These are set slightly above today's
 * measurements, so ordinary work passes and a regression that doubles the
 * bundle does not.
 *
 *   pnpm verify:perf
 *   VERIFY_ORIGIN=https://reklu.app pnpm verify:perf
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = (process.env.VERIFY_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
/**
 * `new URL(...).pathname` percent-encodes, so a repo path containing a space
 * resolves to a directory that does not exist and every file check silently
 * reports zero. fileURLToPath decodes it.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label: string, pass: boolean, detail = ''): void => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;

console.log('\n1. Client JavaScript budget');

/** Total bytes of a directory tree, following no symlinks. */
function treeBytes(dir: string, filter: (name: string) => boolean): number {
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) total += treeBytes(path, filter);
    else if (filter(entry)) total += stat.size;
  }
  return total;
}

const chunkDir = join(root, 'apps/web/.next/static/chunks');
const jsBytes = treeBytes(chunkDir, (name) => name.endsWith('.js'));

if (jsBytes === 0) {
  console.log('  SKIP  no build output — run `pnpm --filter @reklu/web build` first');
} else {
  /**
   * Uncompressed; the wire cost is roughly a third of this after gzip.
   *
   * Set at roughly double today's measurement. The first version of this was
   * 6 MB against an actual 763 KB — eight times the headroom, which is a
   * number that can never fail and therefore is not a budget.
   */
  const BUDGET = 1_600 * 1024;
  check('total client JS is within budget', jsBytes < BUDGET, `${kb(jsBytes)} of ${kb(BUDGET)}`);
}

console.log('\n2. Server response time');

let reachable = true;
for (const path of ['/', '/login', '/api/health']) {
  /**
   * Measured twice, reporting the better result. The first request to a cold
   * route pays for compilation and connection setup, which is real but is not
   * what a budget should fail on — otherwise the check fails intermittently
   * and gets ignored.
   */
  let status = 0;
  let elapsed = Number.MAX_SAFE_INTEGER;

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
      status = response.status;
      await response.arrayBuffer();
      elapsed = Math.min(elapsed, Date.now() - started);
    }
  } catch {
    reachable = false;
    break;
  }

  // Generous on purpose: this runs over the public internet against a small
  // VPS, so it catches "something is badly wrong", not milliseconds.
  check(`${path} responds under 3s`, elapsed < 3_000, `${elapsed}ms (status ${status})`);
}

if (!reachable) {
  console.log(`  SKIP  ${origin} is not reachable`);
}

console.log('\n3. Compression and caching');

if (reachable) {
  const response = await fetch(`${origin}/`, {
    headers: { 'Accept-Encoding': 'gzip, br' },
  });
  const encoding = response.headers.get('content-encoding') ?? '';
  check('HTML is compressed', /gzip|br|deflate/.test(encoding), encoding || 'none');
}

console.log(
  failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
