/**
 * Live verification of the E2B sandbox driver.
 *
 * The unit tests cover driver selection and configuration reporting. They
 * cannot cover the thing that matters most — that a real microVM starts, runs
 * generated code, and cannot see Reklu's secrets — because that needs a live
 * API key. This does.
 *
 * Run: E2B_API_KEY=... SANDBOX_DRIVER=e2b pnpm verify:e2b
 *
 * Costs a few seconds of E2B compute. The sandbox is destroyed in `finally`,
 * including on failure, so a failed run does not leak a paid microVM.
 */
import { createE2bSandboxDriver } from '../src/drivers/e2b';
import { DEFAULT_LIMITS, type SandboxHandle } from '../src/types';

const apiKey = process.env.E2B_API_KEY;
if (!apiKey) {
  console.error('\nE2B_API_KEY is not set. Get one at https://e2b.dev, then:');
  console.error('  E2B_API_KEY=e2b_... pnpm verify:e2b\n');
  process.exit(1);
}

let failures = 0;
const check = (label: string, pass: boolean, detail = ''): void => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// A canary that must never be visible inside the microVM.
process.env.REKLU_E2B_CANARY = 'this-must-not-appear-in-the-sandbox';

const driver = createE2bSandboxDriver({ apiKey });
let handle: SandboxHandle | undefined;

try {
  console.log('\n1. Sandbox creation');
  const started = Date.now();
  handle = await driver.create('sbx_verify_e2b', { ...DEFAULT_LIMITS, timeoutMs: 120_000 });
  check('microVM created', Boolean(handle.externalId), `${Date.now() - started}ms`);
  check('reports itself isolated', handle.isIsolated === true);
  check('driver name is e2b', handle.driver === 'e2b');

  console.log('\n2. Files');
  await driver.writeFiles(handle, [
    { path: 'package.json', content: JSON.stringify({ name: 'verify', version: '1.0.0' }, null, 2) },
    { path: 'src/index.js', content: "console.log('hello from the microVM');" },
  ]);
  const read = await driver.readFile(handle, 'src/index.js');
  check('file written and read back', read?.includes('hello from the microVM') === true);

  const listed = await driver.listFiles(handle);
  check('listing finds both files', listed.length === 2, listed.join(', '));
  check('missing file reads as undefined', (await driver.readFile(handle, 'nope.txt')) === undefined);

  console.log('\n3. Path containment');
  let escaped = false;
  try {
    await driver.writeFiles(handle, [{ path: '../../etc/passwd', content: 'nope' }]);
    escaped = true;
  } catch {
    // expected
  }
  check('traversal is refused', escaped === false);

  console.log('\n4. Execution');
  const echo = await driver.exec(handle, { command: 'echo', args: ['hello reklu'] });
  check('command runs', echo.exitCode === 0, echo.stdout.trim());

  const node = await driver.exec(handle, { command: 'node', args: ['--version'] });
  check('node is available', node.exitCode === 0, node.stdout.trim());

  const failing = await driver.exec(handle, { command: 'false' });
  check('non-zero exit is a result, not a throw', failing.exitCode !== 0);

  const missing = await driver.exec(handle, { command: 'no-such-binary-reklu' });
  check('missing binary reports rather than throws', missing.exitCode !== 0);

  // The security property this whole driver exists for.
  console.log('\n5. Isolation');
  const env = await driver.exec(handle, { command: 'env' });
  check(
    'Reklu secrets are not visible inside the microVM',
    !env.stdout.includes('this-must-not-appear-in-the-sandbox') &&
      !env.stdout.includes('REKLU_E2B_CANARY'),
  );

  const hostname = await driver.exec(handle, { command: 'hostname' });
  check(
    'runs on a different host from Reklu',
    hostname.stdout.trim() !== '' && hostname.stdout.trim() !== process.env.HOSTNAME,
    hostname.stdout.trim(),
  );

  // No shell interpretation: a filename with metacharacters stays an argument.
  const injection = await driver.exec(handle, {
    command: 'echo',
    args: ['hello; echo INJECTED'],
  });
  check(
    'arguments are not interpreted by a shell',
    injection.stdout.includes('hello; echo INJECTED') && !/^INJECTED$/m.test(injection.stdout),
  );

  console.log('\n6. Preview');
  const preview = await driver.startPreview(handle, 3000);
  check('preview URL is https', preview.url.startsWith('https://'), preview.url);
  check('preview is on a different origin from Reklu', !preview.url.includes('reklu.app'));
  await preview.stop();
} catch (error) {
  failures++;
  console.error('\nUnexpected failure:', error instanceof Error ? error.message : error);
} finally {
  console.log('\n7. Cleanup');
  if (handle) {
    await driver.destroy(handle);
    check('microVM destroyed', true);
    // Destroying twice must be safe — cleanup paths run more than once.
    await driver.destroy(handle);
    check('destroy is idempotent', true);
  }
  delete process.env.REKLU_E2B_CANARY;
}

console.log(
  failures === 0
    ? '\nAll checks passed. Generated code runs isolated, and Reklu secrets stay out.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
