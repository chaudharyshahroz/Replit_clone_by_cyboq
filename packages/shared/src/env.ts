/**
 * Environment configuration and startup validation.
 *
 * Two rules drive this module:
 *
 *  1. Required configuration is validated once, loudly, at startup — not
 *     discovered as a `undefined` deep inside a request handler.
 *  2. Optional *feature* configuration degrades into an explicit
 *     "not configured" state that the UI surfaces honestly. It never causes a
 *     feature to pretend it succeeded.
 *
 * Validation is lazy + cached so that importing this module never crashes a
 * build. Set `SKIP_ENV_VALIDATION=1` for lint/typecheck/CI steps that do not
 * connect to anything.
 */
import { z } from 'zod';

/** Trim, then treat the empty string as absent. Avoids `FOO=` reading as set. */
const optionalString = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

const requiredString = (name: string, hint?: string) =>
  z
    .string({ required_error: `${name} is required.${hint ? ` ${hint}` : ''}` })
    .trim()
    .min(1, `${name} must not be empty.${hint ? ` ${hint}` : ''}`);

const booleanish = (fallback: boolean) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

/**
 * `FOO=` in a .env file yields an empty string, not `undefined`. For enums that
 * is a validation failure rather than the intended "not set", so both helpers
 * below normalize empty to absent before the enum sees it.
 */
const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v))
    .pipe(z.enum(values).optional());

const enumWithDefault = <const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v))
    .pipe(z.enum(values));

const intWithDefault = (fallback: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int().positive());

/** A 32-byte base64 key, as produced by `openssl rand -base64 32`. */
const base64Key = (name: string) =>
  requiredString(name, `Generate one with: openssl rand -base64 32`).refine(
    (v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    },
    { message: `${name} must be 32 bytes encoded as base64 (openssl rand -base64 32).` },
  );

const serverSchema = z.object({
  // ---- App -----------------------------------------------------------------
  NODE_ENV: enumWithDefault(['development', 'test', 'production'], 'development'),
  APP_URL: requiredString('APP_URL')
    .url('APP_URL must be an absolute URL, e.g. http://localhost:3000')
    .transform((v) => v.replace(/\/$/, '')),
  APP_NAME: z.string().trim().default('Reklu'),
  LOG_LEVEL: enumWithDefault(['trace', 'debug', 'info', 'warn', 'error'], 'info'),

  // ---- Database ------------------------------------------------------------
  DATABASE_URL: requiredString('DATABASE_URL', 'e.g. postgresql://user@localhost:5432/reklu'),
  DATABASE_POOL_MAX: intWithDefault(10),
  DATABASE_VECTOR_ENABLED: booleanish(true),

  // ---- Auth ----------------------------------------------------------------
  AUTH_SECRET: base64Key('AUTH_SECRET'),
  AUTH_TRUST_HOST: booleanish(true),
  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,
  AUTH_GITHUB_ID: optionalString,
  AUTH_GITHUB_SECRET: optionalString,

  // ---- Redis ---------------------------------------------------------------
  REDIS_URL: requiredString('REDIS_URL', 'e.g. redis://localhost:6379'),
  QUEUE_PREFIX: z.string().trim().default('reklu'),

  // ---- Storage -------------------------------------------------------------
  STORAGE_DRIVER: enumWithDefault(['local', 's3'], 'local'),
  STORAGE_LOCAL_PATH: z.string().trim().default('./.storage'),
  /**
   * Operator acknowledgement that STORAGE_LOCAL_PATH is a durable mounted
   * volume and that the deployment runs a single web replica.
   *
   * The production guard on `STORAGE_DRIVER=local` exists because a container
   * filesystem is ephemeral and because two replicas do not share one. Neither
   * is true of a single-node deploy with a mounted volume, but Reklu cannot
   * detect that from inside the container — so the operator states it, and
   * states it for the exact reason the guard would otherwise fire.
   */
  STORAGE_LOCAL_SINGLE_NODE_ACK: booleanish(false),
  S3_BUCKET: optionalString,
  S3_REGION: z.string().trim().default('auto'),
  S3_ENDPOINT: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_PUBLIC_URL: optionalString,
  STORAGE_MAX_UPLOAD_MB: intWithDefault(50),

  // ---- AI providers --------------------------------------------------------
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  XAI_API_KEY: optionalString,
  DEEPSEEK_API_KEY: optionalString,
  /**
   * `none` is an explicit choice to run without semantic retrieval: project
   * memory and file search fall back to lexical matching, which is implemented
   * and tested. It is offered so an operator with an Anthropic-only key can
   * deploy without Reklu pretending semantic recall works.
   */
  EMBEDDING_PROVIDER: enumWithDefault(['openai', 'google', 'none'], 'openai'),
  EMBEDDING_MODEL: z.string().trim().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: intWithDefault(1536),
  IMAGE_PROVIDER: enumWithDefault(['openai', 'google'], 'openai'),
  VIDEO_PROVIDER: optionalString,

  // ---- Research ------------------------------------------------------------
  SEARCH_PROVIDER: optionalEnum(['brave', 'tavily', 'serper']),
  BRAVE_SEARCH_API_KEY: optionalString,
  TAVILY_API_KEY: optionalString,
  SERPER_API_KEY: optionalString,
  RESEARCH_MAX_SOURCES: intWithDefault(32),
  RESEARCH_FETCH_TIMEOUT_MS: intWithDefault(15_000),
  RESEARCH_USER_AGENT: z.string().trim().default('RekluResearchBot/1.0 (+https://reklu.app/bot)'),

  // ---- Integrations --------------------------------------------------------
  GITHUB_APP_CLIENT_ID: optionalString,
  GITHUB_APP_CLIENT_SECRET: optionalString,
  GITHUB_OAUTH_REDIRECT_URI: optionalString,
  VERCEL_CLIENT_ID: optionalString,
  VERCEL_CLIENT_SECRET: optionalString,
  VERCEL_OAUTH_REDIRECT_URI: optionalString,
  SUPABASE_CLIENT_ID: optionalString,
  SUPABASE_CLIENT_SECRET: optionalString,
  SUPABASE_OAUTH_REDIRECT_URI: optionalString,

  // ---- MCP -----------------------------------------------------------------
  /**
   * Hosts an MCP endpoint may use despite resolving to a private address.
   *
   * Reklu refuses private and link-local addresses by default, because an
   * endpoint URL is user-supplied and `http://169.254.169.254/` reaches cloud
   * metadata. But a co-located MCP sidecar — a service on the same Docker
   * network — is a legitimate deployment and resolves to exactly such an
   * address.
   *
   * Resolving that with a blanket "allow private ranges" switch would undo the
   * protection entirely. Instead the operator names the hosts, so the exception
   * is as narrow as the thing it permits. Comma-separated hostnames, matched
   * exactly and case-insensitively: `mcp-filesystem,tools.internal`.
   */
  MCP_ALLOWED_HOSTS: optionalString,

  // ---- Sandbox -------------------------------------------------------------
  /**
   * Master switch for the Build workspace.
   *
   * Build is the only subsystem that executes model-generated code, so it is
   * the only one that needs an isolated sandbox. Turning it off is what makes a
   * production deploy possible before an isolated sandbox exists: the feature
   * reports itself unavailable (spec §25) rather than running untrusted code on
   * the app server (spec §36).
   */
  BUILD_ENABLED: booleanish(true),
  SANDBOX_DRIVER: enumWithDefault(['local', 'e2b', 'docker'], 'local'),
  SANDBOX_ROOT: z.string().trim().default('./.sandbox'),
  E2B_API_KEY: optionalString,
  SANDBOX_TIMEOUT_MS: intWithDefault(600_000),
  SANDBOX_MAX_MEMORY_MB: intWithDefault(2048),
  SANDBOX_MAX_DISK_MB: intWithDefault(1024),
  SANDBOX_MAX_CONCURRENT: intWithDefault(3),

  // ---- Billing -------------------------------------------------------------
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PUBLISHABLE_KEY: optionalString,
  BILLING_PORTAL_RETURN_URL: optionalString,

  // ---- Encryption ----------------------------------------------------------
  ENCRYPTION_KEY: base64Key('ENCRYPTION_KEY'),
  ENCRYPTION_KEY_PREVIOUS: optionalString,

  // ---- Monitoring ----------------------------------------------------------
  SENTRY_DSN: optionalString,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  ANALYTICS_ENABLED: booleanish(false),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Cross-field rules that a per-field schema cannot express. Each returns a
 * human-readable problem describing the fix, not just the symptom.
 */
function crossFieldProblems(env: ServerEnv): string[] {
  const problems: string[] = [];

  if (env.STORAGE_DRIVER === 's3') {
    const missing = (
      [
        ['S3_BUCKET', env.S3_BUCKET],
        ['S3_ACCESS_KEY_ID', env.S3_ACCESS_KEY_ID],
        ['S3_SECRET_ACCESS_KEY', env.S3_SECRET_ACCESS_KEY],
      ] as const
    )
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      problems.push(`STORAGE_DRIVER=s3 requires: ${missing.join(', ')}.`);
    }
  }

  if (env.SANDBOX_DRIVER === 'e2b' && !env.E2B_API_KEY) {
    problems.push('SANDBOX_DRIVER=e2b requires E2B_API_KEY.');
  }

  const searchKeyFor = {
    brave: env.BRAVE_SEARCH_API_KEY,
    tavily: env.TAVILY_API_KEY,
    serper: env.SERPER_API_KEY,
  } as const;
  if (env.SEARCH_PROVIDER && !searchKeyFor[env.SEARCH_PROVIDER]) {
    const key = `${env.SEARCH_PROVIDER.toUpperCase()}${
      env.SEARCH_PROVIDER === 'brave' ? '_SEARCH' : ''
    }_API_KEY`;
    problems.push(`SEARCH_PROVIDER=${env.SEARCH_PROVIDER} requires ${key}.`);
  }

  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) {
    problems.push(
      'STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not. ' +
        'Subscription state would drift because webhooks could not be verified.',
    );
  }

  // Production refuses to run on a configuration that cannot serve the product.
  if (env.NODE_ENV === 'production') {
    const hasAnyModelProvider = Boolean(
      env.ANTHROPIC_API_KEY ||
        env.OPENAI_API_KEY ||
        env.GOOGLE_GENERATIVE_AI_API_KEY ||
        env.XAI_API_KEY ||
        env.DEEPSEEK_API_KEY,
    );
    if (!hasAnyModelProvider) {
      problems.push(
        'No AI provider key is configured. Reklu cannot serve Chat, Research, or Build. ' +
          'Set at least one of ANTHROPIC_API_KEY, OPENAI_API_KEY, ' +
          'GOOGLE_GENERATIVE_AI_API_KEY, XAI_API_KEY, DEEPSEEK_API_KEY.',
      );
    }
    if (env.STORAGE_DRIVER === 'local' && !env.STORAGE_LOCAL_SINGLE_NODE_ACK) {
      problems.push(
        'STORAGE_DRIVER=local is not durable on an ephemeral container filesystem ' +
          'and is not shared between replicas. Either set STORAGE_DRIVER=s3, or — if ' +
          `STORAGE_LOCAL_PATH (${env.STORAGE_LOCAL_PATH}) is a mounted volume and you ` +
          'run exactly one web replica — set STORAGE_LOCAL_SINGLE_NODE_ACK=true to ' +
          'accept that constraint. Uploads are lost if either condition stops holding.',
      );
    }
    // Only Build executes model-generated code, so only Build needs isolation.
    // With Build off, a non-isolated driver is never handed anything untrusted.
    if (env.BUILD_ENABLED && env.SANDBOX_DRIVER === 'local') {
      problems.push(
        'SANDBOX_DRIVER=local does not provide real isolation and must not run ' +
          'untrusted generated code in production. Set SANDBOX_DRIVER=e2b (with ' +
          'E2B_API_KEY) or SANDBOX_DRIVER=docker, or set BUILD_ENABLED=false to ' +
          'deploy with the Build workspace turned off.',
      );
    }
    if (env.APP_URL.startsWith('http://')) {
      problems.push('APP_URL must use https in production (secure cookies require it).');
    }

    // EMBEDDING_PROVIDER carries a default, so a missing key is not an explicit
    // contradiction the way SEARCH_PROVIDER=brave without a Brave key is —
    // it is far more likely to be an oversight. Shipping it silently would
    // degrade project memory and file search to lexical matching without anyone
    // deciding to. `none` is how an operator decides to, on purpose.
    if (env.EMBEDDING_PROVIDER !== 'none') {
      const embeddingKey =
        env.EMBEDDING_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!embeddingKey) {
        const required =
          env.EMBEDDING_PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'GOOGLE_GENERATIVE_AI_API_KEY';
        problems.push(
          `EMBEDDING_PROVIDER=${env.EMBEDDING_PROVIDER} requires ${required}. ` +
            'Without it, project memory and file search cannot retrieve semantically. ' +
            'Set EMBEDDING_PROVIDER=none to run on lexical retrieval deliberately.',
        );
      }
    }
  }

  return problems;
}

export class EnvironmentError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      [
        '',
        'Reklu cannot start: the environment is not configured correctly.',
        '',
        ...problems.map((p) => `  • ${p}`),
        '',
        'Copy .env.example to .env and fill in the values, or run: pnpm setup',
        '',
      ].join('\n'),
    );
    this.name = 'EnvironmentError';
    this.problems = problems;
  }
}

/**
 * Values that are obviously an unedited placeholder from a template.
 *
 * Real deployments hit this: an operator copies a documented example, fills in
 * some values and misses others. Without this check the failures are baffling —
 * `POSTGRES_PASSWORD=<your password>` is a perfectly valid *string*, so schema
 * validation passes and the deploy fails much later with "password
 * authentication failed", pointing at the database rather than the template.
 *
 * Angle brackets are the giveaway. No legitimate secret, URL or key is wrapped
 * in them, so this cannot reject a value someone meant.
 */
function unfilledPlaceholders(source: NodeJS.ProcessEnv): string[] {
  /**
   * Variables Reklu's deployment templates define but Reklu itself never reads
   * — they configure infrastructure around it. They belong here because the
   * operator fills them in from the same template, and gets them wrong in the
   * same way. `POSTGRES_PASSWORD` is on this list because a real deploy left it
   * as a placeholder: Compose built a DATABASE_URL around it and the failure
   * arrived as "password authentication failed", far from the cause.
   */
  const templateOnly = ['POSTGRES_PASSWORD'];

  const problems: string[] = [];
  for (const name of [...Object.keys(serverSchema.shape), ...templateOnly]) {
    const value = source[name];
    if (value !== undefined && /^<.*>$/.test(value.trim())) {
      problems.push(
        `${name} is still the placeholder ${value.trim()} from the configuration ` +
          'template. Replace it with a real value.',
      );
    }
  }
  return problems;
}

let cached: ServerEnv | undefined;

/**
 * Parse and validate server environment. Throws {@link EnvironmentError} listing
 * every problem at once, so a misconfigured deploy is fixed in one pass rather
 * than one variable per restart.
 */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached) return cached;

  if (source.SKIP_ENV_VALIDATION === '1') {
    // Lint/typecheck/build contexts that never open a socket.
    cached = serverSchema.partial().parse(source) as ServerEnv;
    return cached;
  }

  const unfilled = unfilledPlaceholders(source);
  if (unfilled.length > 0) throw new EnvironmentError(unfilled);

  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const field = issue.path.join('.');
      return field ? `${field}: ${issue.message}` : issue.message;
    });
    throw new EnvironmentError(problems);
  }

  const problems = crossFieldProblems(parsed.data);
  if (problems.length > 0) throw new EnvironmentError(problems);

  cached = parsed.data;
  return cached;
}

/** Test helper — forget the cached parse. */
export function resetServerEnvCache(): void {
  cached = undefined;
}

/**
 * Which optional capabilities are actually configured. The UI reads this to
 * render an honest "Not configured" state instead of a dead button.
 */
export interface FeatureAvailability {
  readonly anthropic: boolean;
  readonly openai: boolean;
  readonly google: boolean;
  readonly xai: boolean;
  readonly deepseek: boolean;
  readonly anyModelProvider: boolean;
  readonly embeddings: boolean;
  readonly webSearch: boolean;
  readonly imageGeneration: boolean;
  readonly videoGeneration: boolean;
  readonly googleSignIn: boolean;
  readonly githubSignIn: boolean;
  readonly githubIntegration: boolean;
  readonly vercelIntegration: boolean;
  readonly supabaseIntegration: boolean;
  readonly billing: boolean;
  readonly durableStorage: boolean;
  readonly isolatedSandbox: boolean;
  /**
   * Whether the Build workspace can accept work. False when the operator turned
   * it off, and false in production without an isolated sandbox — generated code
   * must never execute on the app server (spec §36).
   */
  readonly build: boolean;
}

export function featuresFor(env: ServerEnv): FeatureAvailability {
  const anthropic = Boolean(env.ANTHROPIC_API_KEY);
  const openai = Boolean(env.OPENAI_API_KEY);
  const google = Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);
  const xai = Boolean(env.XAI_API_KEY);
  const deepseek = Boolean(env.DEEPSEEK_API_KEY);

  return {
    anthropic,
    openai,
    google,
    xai,
    deepseek,
    anyModelProvider: anthropic || openai || google || xai || deepseek,
    embeddings:
      env.EMBEDDING_PROVIDER === 'none'
        ? false
        : env.EMBEDDING_PROVIDER === 'openai'
          ? openai
          : google,
    webSearch: Boolean(env.SEARCH_PROVIDER),
    imageGeneration: env.IMAGE_PROVIDER === 'openai' ? openai : google,
    videoGeneration: Boolean(env.VIDEO_PROVIDER),
    googleSignIn: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
    githubSignIn: Boolean(env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET),
    githubIntegration: Boolean(env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET),
    vercelIntegration: Boolean(env.VERCEL_CLIENT_ID && env.VERCEL_CLIENT_SECRET),
    supabaseIntegration: Boolean(env.SUPABASE_CLIENT_ID && env.SUPABASE_CLIENT_SECRET),
    billing: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
    durableStorage: env.STORAGE_DRIVER === 's3' || env.STORAGE_LOCAL_SINGLE_NODE_ACK,
    isolatedSandbox: env.SANDBOX_DRIVER !== 'local',
    build:
      env.BUILD_ENABLED &&
      (env.SANDBOX_DRIVER !== 'local' || env.NODE_ENV !== 'production'),
  };
}

/**
 * An absolute URL on Reklu's canonical public origin.
 *
 * Redirects must never be built from the inbound request. Behind a reverse
 * proxy that request carries the container's internal address — under Traefik
 * it is `http://0.0.0.0:3000` — so `new URL(request.url).origin` sends the
 * browser to a host that exists only inside the Docker network. A real OAuth
 * callback landed on `0.0.0.0:3000/settings/connections` for exactly this
 * reason: the flow had succeeded, and the redirect threw it away.
 *
 * APP_URL is the canonical origin, which is why it is required at startup.
 */
export function absoluteAppUrl(path = '/'): string {
  const origin = loadServerEnv().APP_URL.replace(/\/+$/, '');
  return new URL(path, `${origin}/`).toString();
}

/** Whether Reklu is served over TLS, judged by APP_URL rather than the request. */
export function servedOverHttps(): boolean {
  return loadServerEnv().APP_URL.startsWith('https:');
}

/**
 * Hosts explicitly permitted to resolve to a private address, lowercased.
 *
 * Empty by default — the exception exists only where an operator created it.
 */
export function mcpAllowedHosts(): ReadonlySet<string> {
  const raw = loadServerEnv().MCP_ALLOWED_HOSTS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Convenience accessors for server code. */
export const serverEnv = (): ServerEnv => loadServerEnv();
export const features = (): FeatureAvailability => featuresFor(loadServerEnv());
export const isProduction = (): boolean => loadServerEnv().NODE_ENV === 'production';
export const isDevelopment = (): boolean => loadServerEnv().NODE_ENV === 'development';
