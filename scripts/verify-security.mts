/**
 * Security posture checks (spec §111, §150).
 *
 * Asserts the properties that are cheap to state and expensive to lose. Run
 * against a live origin so it checks what is *served*, not what the config
 * file intends — those diverge whenever a proxy rewrites headers.
 *
 *   pnpm verify:security                       # against http://localhost:3000
 *   VERIFY_ORIGIN=https://reklu.app pnpm verify:security
 */
const origin = (process.env.VERIFY_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');

let failures = 0;
const check = (label: string, pass: boolean, detail = ''): void => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log(`\nChecking ${origin}\n`);

let response: Response;
try {
  response = await fetch(origin, { redirect: 'manual' });
} catch (error) {
  console.error(
    `Could not reach ${origin}: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error('Start the app, or set VERIFY_ORIGIN to a running deployment.\n');
  process.exit(1);
}

const header = (name: string): string => response.headers.get(name) ?? '';

console.log('1. Security headers');

const csp = header('content-security-policy');
check('Content-Security-Policy is set', csp.length > 0);

/**
 * `unsafe-eval` turns an injected string into injected code. Nothing in Reklu
 * needs it, so its absence is a property worth asserting rather than assuming.
 */
check("script-src does not allow 'unsafe-eval'", !csp.includes('unsafe-eval'), csp ? '' : 'no CSP');
check("object-src is 'none'", csp.includes("object-src 'none'"));
check("base-uri is 'self'", csp.includes("base-uri 'self'"));
// A form posting off-origin is exfiltration, not a feature.
check("form-action is 'self'", csp.includes("form-action 'self'"));
check("frame-ancestors is 'none'", csp.includes("frame-ancestors 'none'"));

check('X-Content-Type-Options is nosniff', header('x-content-type-options') === 'nosniff');
check('X-Frame-Options is DENY', header('x-frame-options') === 'DENY');
check(
  'Referrer-Policy does not leak full URLs cross-origin',
  ['strict-origin-when-cross-origin', 'no-referrer', 'same-origin'].includes(
    header('referrer-policy'),
  ),
  header('referrer-policy'),
);
check('Permissions-Policy restricts camera and microphone', header('permissions-policy').includes('camera=()'));

// Only meaningful over TLS; asserting it on plain HTTP would fail for the
// wrong reason.
if (origin.startsWith('https://')) {
  check(
    'Strict-Transport-Security is set',
    /max-age=\d{6,}/.test(header('strict-transport-security')),
    header('strict-transport-security'),
  );
} else {
  console.log('  SKIP  Strict-Transport-Security — only meaningful over HTTPS');
}

console.log('\n2. Nothing sensitive is disclosed');

// A version header tells an attacker which CVEs to try.
check('no X-Powered-By header', header('x-powered-by') === '', header('x-powered-by'));
check('no Server version banner', !/\d+\.\d+/.test(header('server')), header('server'));

const body = await response.text();
for (const [label, pattern] of [
  ['no API key in the HTML', /sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9-]{20,}/],
  ['no database URL in the HTML', /postgres(ql)?:\/\/[^\s"']+/],
  ['no bearer token in the HTML', /Bearer\s+[A-Za-z0-9._-]{20,}/],
] as const) {
  check(label, !pattern.test(body));
}

console.log('\n3. Authentication is actually required');

for (const path of ['/home', '/chat', '/projects', '/settings', '/admin', '/agents']) {
  const guarded = await fetch(`${origin}${path}`, { redirect: 'manual' });
  // A protected page must redirect or refuse — never render for an anonymous
  // visitor.
  const denied = guarded.status === 307 || guarded.status === 302 || guarded.status === 401;
  check(`${path} is not served to an anonymous visitor`, denied, `status ${guarded.status}`);
}

console.log('\n4. The health endpoint discloses no secrets');

const health = await fetch(`${origin}/api/health`);
const healthText = await health.text();
check('health responds', health.ok, `status ${health.status}`);
check(
  'health reports capabilities as booleans, not values',
  !/sk-|postgres:|redis:\/\/|ws_/.test(healthText),
);

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
