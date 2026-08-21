/**
 * A no-op stand-in for the `server-only` package.
 *
 * That package throws on import to stop server code reaching the browser. In
 * Next that never happens for a `'use server'` module: it is compiled into an
 * RPC stub and its imports stay on the server. vitest has no such compilation,
 * so following a client component's import of a server action pulls the real
 * module in and it throws.
 *
 * Aliased rather than mocked per file, because the alternative is remembering
 * to mock it in every future test that renders a component with an action.
 */
export {};
