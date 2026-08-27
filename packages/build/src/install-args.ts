/**
 * How Reklu installs a generated project's dependencies.
 *
 * `--legacy-peer-deps` is the load-bearing flag, and it is here rather than
 * written out at each call site because it was written out at some of them and
 * not others.
 *
 * npm refuses an unresolvable peer tree, and a generated app produces one
 * routinely: a model pairs a current ESLint with the Next config for the major
 * version it chose, and `eslint-config-next@14` declares `eslint ^7 || ^8`.
 * Both halves are reasonable, only the combination is not, and npm stops with
 * ERESOLVE. Every such build failed at "Dependencies failed to install".
 *
 * The sandbox image warms its cache with this exact flag, so the image and the
 * install it exists to serve disagreed: same package manager, same container,
 * opposite rules.
 *
 * It is the right trade for generated code specifically. A peer range is a
 * claim about compatibility, and npm's refusal protects a project somebody
 * maintains. Here the alternative is not a careful upgrade — it is a build that
 * cannot run at all, of an application nobody has shipped, over a linter
 * version that has no bearing on whether the page renders.
 */
export const NPM_INSTALL_ARGS: readonly string[] = [
  'install',
  '--no-audit',
  '--no-fund',
  '--legacy-peer-deps',
];

/**
 * The same, for a production build.
 *
 * `--include=dev` because the build needs them: TypeScript, Tailwind and the
 * type packages are devDependencies in every generated app, and npm omits those
 * whenever NODE_ENV is production.
 */
export const NPM_INSTALL_ARGS_WITH_DEV: readonly string[] = [
  ...NPM_INSTALL_ARGS,
  '--include=dev',
];

/**
 * What an npm failure was actually about.
 *
 * npm's output is long and the reason is rarely at the end of it. A native
 * module that could not compile prints forty lines of node-gyp before anything
 * names the package, and "Dependencies failed to install" above that tells the
 * reader only that they now have forty lines to read.
 *
 * Each case here is one that has actually happened, and each names the cause in
 * a sentence. Anything unrecognised keeps the plain message — a guess dressed
 * as a diagnosis is worse than no diagnosis.
 */
export function describeInstallFailure(output: string): string {
  const generic = 'Dependencies failed to install.';
  if (!output) return generic;

  /* node-gyp could not find Python, or there were no prebuilt binaries. */
  if (/gyp ERR!|prebuild-install warn install No prebuilt binaries/.test(output)) {
    const pkg = /npm error path .*node_modules\/([^\s/]+)/.exec(output)?.[1];
    return pkg
      ? `Dependencies failed to install: ${pkg} has to be compiled and the build toolchain is missing. Rebuild the sandbox image, or ask for a version of the app that does not use ${pkg}.`
      : 'Dependencies failed to install: a dependency has to be compiled and the build toolchain is missing. Rebuild the sandbox image.';
  }

  /* An unresolvable peer tree, which is what a mismatched linter config gives. */
  if (/ERESOLVE|peer dep/i.test(output)) {
    return 'Dependencies failed to install: two packages disagree about a shared dependency.';
  }

  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/.test(output)) {
    return 'Dependencies failed to install: the npm registry could not be reached.';
  }

  if (/ENOSPC|no space left/i.test(output)) {
    return 'Dependencies failed to install: the sandbox host has run out of disk space.';
  }

  if (/404 Not Found.*npm error 404/s.test(output) || /npm error 404/.test(output)) {
    const pkg = /npm error 404\s+'([^']+)'/.exec(output)?.[1];
    return pkg
      ? `Dependencies failed to install: the package ${pkg} does not exist.`
      : 'Dependencies failed to install: a package in package.json does not exist.';
  }

  return generic;
}

/**
 * Why nothing came up on the port.
 *
 * A dev server that never starts is the worst failure to meet, because there is
 * nothing to look at: a white frame, and "Bad Gateway" from the proxy if the
 * address is opened directly. Neither says which of a dozen things went wrong.
 *
 * The cases here are the ones that have happened. Anything else keeps the plain
 * message and the log beneath it, which is the honest answer when the log is
 * all there is.
 */
export function describeStartupFailure(log: string, paths: readonly string[]): string {
  /*
   * A workspace layout, which Reklu cannot run. The dev server is started at
   * the root of the tree, and in a monorepo the application is not there — the
   * root has a workspace manifest and no server to start, so nothing listens
   * and nothing errors either.
   */
  const nested = paths.filter((path) => /^(apps|packages)\//.test(path)).length;
  if (nested > paths.length / 2 && paths.length > 4) {
    return (
      'The preview server never started: this build is laid out as a monorepo, ' +
      'with the application under apps/. Reklu runs one application at the root ' +
      'of the tree. Ask for it as a single app rather than a workspace.'
    );
  }

  if (/EADDRINUSE/.test(log)) {
    return 'The preview server never started: the port was already taken inside the sandbox.';
  }

  if (/Missing script|command not found|ENOENT.*package\.json/i.test(log)) {
    return 'The preview server never started: package.json has no dev script to run.';
  }

  if (/Cannot find module|Module not found/.test(log)) {
    const missing = /Cannot find module '([^']+)'/.exec(log)?.[1];
    return missing
      ? `The preview server never started: it could not find ${missing}.`
      : 'The preview server never started: a module it imports does not exist.';
  }

  return 'The preview server never started. Its output is below.';
}
