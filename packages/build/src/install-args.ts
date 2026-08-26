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
