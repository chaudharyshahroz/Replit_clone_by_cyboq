import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { EnvironmentError, featuresFor, loadServerEnv, resetServerEnvCache } from '../env';

const key = () => randomBytes(32).toString('base64');

/** A minimally valid development environment. */
function base(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    APP_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://postgres@localhost:5432/reklu',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_SECRET: key(),
    ENCRYPTION_KEY: key(),
    OPENAI_API_KEY: 'sk-test',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

beforeEach(() => resetServerEnvCache());

describe('loadServerEnv', () => {
  it('accepts a minimal valid development environment', () => {
    const env = loadServerEnv(base());
    expect(env.NODE_ENV).toBe('development');
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.DATABASE_POOL_MAX).toBe(10);
  });

  it('strips a trailing slash from APP_URL', () => {
    expect(loadServerEnv(base({ APP_URL: 'https://reklu.app/' })).APP_URL).toBe(
      'https://reklu.app',
    );
  });

  it('treats an empty string as absent', () => {
    expect(loadServerEnv(base({ ANTHROPIC_API_KEY: '' })).ANTHROPIC_API_KEY).toBeUndefined();
  });

  // Regression: `.env.example` ships commented-out enum keys as `FOO=`, which
  // arrives as '' rather than undefined. Enums must read that as "not set"
  // instead of rejecting it as an invalid value.
  it('treats an empty optional enum as unset', () => {
    expect(loadServerEnv(base({ SEARCH_PROVIDER: '' })).SEARCH_PROVIDER).toBeUndefined();
  });

  it('falls back to the default for an empty defaulted enum', () => {
    const env = loadServerEnv(
      base({ STORAGE_DRIVER: '', SANDBOX_DRIVER: '', LOG_LEVEL: '', IMAGE_PROVIDER: '' }),
    );
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.SANDBOX_DRIVER).toBe('local');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.IMAGE_PROVIDER).toBe('openai');
  });

  it('still rejects a genuinely invalid enum value', () => {
    expect(() => loadServerEnv(base({ STORAGE_DRIVER: 'ftp' }))).toThrow(EnvironmentError);
  });

  it('parses the committed .env.example without error', async () => {
    // Guards against .env.example drifting out of sync with the schema.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '../../../../.env.example'), 'utf8');

    // Mirrors dotenv's behaviour: quoted values are taken verbatim, unquoted
    // values are truncated at a whitespace-preceded `#` and then trimmed.
    const parsed: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const rawValue = match[2]!;
      const quoted = /^(["'])([\s\S]*)\1$/.exec(rawValue.trim());
      // Strip a `#` comment that begins the value or follows whitespace. A `#`
      // embedded in a token (a URL fragment, a password) is left alone.
      parsed[match[1]!] = quoted ? quoted[2]! : rawValue.replace(/(^|\s)#.*$/, '$1').trim();
    }
    // Supply only the secrets the example intentionally leaves blank.
    parsed.AUTH_SECRET = key();
    parsed.ENCRYPTION_KEY = key();
    parsed.OPENAI_API_KEY = 'sk-test';

    resetServerEnvCache();
    expect(() => loadServerEnv(parsed as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('reports every problem at once rather than one per restart', () => {
    let thrown: EnvironmentError | undefined;
    try {
      loadServerEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    } catch (e) {
      thrown = e as EnvironmentError;
    }
    expect(thrown).toBeInstanceOf(EnvironmentError);
    expect(thrown!.problems.length).toBeGreaterThan(3);
    expect(thrown!.message).toContain('pnpm setup');
  });

  it('rejects a key that is not 32 bytes of base64', () => {
    expect(() => loadServerEnv(base({ ENCRYPTION_KEY: 'too-short' }))).toThrow(EnvironmentError);
  });

  describe('cross-field rules', () => {
    it('requires S3 credentials when the s3 driver is selected', () => {
      expect(() => loadServerEnv(base({ STORAGE_DRIVER: 's3' }))).toThrow(/S3_BUCKET/);
    });

    it('requires an API key for the selected search provider', () => {
      expect(() => loadServerEnv(base({ SEARCH_PROVIDER: 'brave' }))).toThrow(
        /BRAVE_SEARCH_API_KEY/,
      );
    });

    it('requires E2B_API_KEY for the e2b sandbox driver', () => {
      expect(() => loadServerEnv(base({ SANDBOX_DRIVER: 'e2b' }))).toThrow(/E2B_API_KEY/);
    });

    // In development a missing embedding key degrades the feature honestly
    // rather than blocking first-run setup; production treats it as fatal
    // (covered in the production-hardening block below).
    it('does not require the embedding key in development', () => {
      const env = loadServerEnv(base({ EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: '' }));
      expect(featuresFor(env).embeddings).toBe(false);
    });

    it('rejects a Stripe key without a webhook secret', () => {
      expect(() => loadServerEnv(base({ STRIPE_SECRET_KEY: 'sk_test_x' }))).toThrow(
        /STRIPE_WEBHOOK_SECRET/,
      );
    });
  });

  describe('production hardening', () => {
    const prod = (overrides: Record<string, string> = {}) =>
      base({
        NODE_ENV: 'production',
        APP_URL: 'https://reklu.app',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        SANDBOX_DRIVER: 'e2b',
        E2B_API_KEY: 'e',
        ...overrides,
      });

    it('accepts a fully configured production environment', () => {
      expect(() => loadServerEnv(prod())).not.toThrow();
    });

    it('refuses to start with no AI provider configured', () => {
      expect(() => loadServerEnv(prod({ OPENAI_API_KEY: '', EMBEDDING_PROVIDER: 'google', GOOGLE_GENERATIVE_AI_API_KEY: '' }))).toThrow(
        /No AI provider key is configured/,
      );
    });

    it('refuses the local storage driver', () => {
      expect(() => loadServerEnv(prod({ STORAGE_DRIVER: 'local' }))).toThrow(
        /not durable/,
      );
    });

    it('refuses the local sandbox driver for untrusted code', () => {
      expect(() => loadServerEnv(prod({ SANDBOX_DRIVER: 'local' }))).toThrow(
        /does not provide real isolation/,
      );
    });

    it('refuses plaintext http', () => {
      expect(() => loadServerEnv(prod({ APP_URL: 'http://reklu.app' }))).toThrow(/https/);
    });

    it('requires an embedding provider key', () => {
      expect(() =>
        loadServerEnv(
          prod({ EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: 'sk-ant-x' }),
        ),
      ).toThrow(/OPENAI_API_KEY/);
    });

    /**
     * Each production guard has exactly one documented way past it, and each
     * one is an explicit statement by the operator about what they are giving
     * up. None of them is a silent fallback — that distinction is the whole
     * point, so it is tested rather than assumed.
     */
    describe('documented escape hatches', () => {
      it('permits the local storage driver once single-node durability is acknowledged', () => {
        expect(() =>
          loadServerEnv(
            prod({
              STORAGE_DRIVER: 'local',
              S3_BUCKET: '',
              S3_ACCESS_KEY_ID: '',
              S3_SECRET_ACCESS_KEY: '',
              STORAGE_LOCAL_SINGLE_NODE_ACK: 'true',
            }),
          ),
        ).not.toThrow();
      });

      it('still names the volume and the replica count when the ack is absent', () => {
        expect(() => loadServerEnv(prod({ STORAGE_DRIVER: 'local' }))).toThrow(
          /STORAGE_LOCAL_SINGLE_NODE_ACK/,
        );
      });

      it('permits a non-isolated sandbox only when Build is turned off', () => {
        expect(() =>
          loadServerEnv(prod({ SANDBOX_DRIVER: 'local', E2B_API_KEY: '', BUILD_ENABLED: 'false' })),
        ).not.toThrow();
      });

      // The guard protects against executing generated code, so it must key on
      // Build being reachable — not on the driver alone.
      it('refuses a non-isolated sandbox the moment Build is turned back on', () => {
        expect(() =>
          loadServerEnv(prod({ SANDBOX_DRIVER: 'local', E2B_API_KEY: '', BUILD_ENABLED: 'true' })),
        ).toThrow(/does not provide real isolation/);
      });

      it('permits an Anthropic-only deploy when lexical retrieval is chosen deliberately', () => {
        expect(() =>
          loadServerEnv(
            prod({
              OPENAI_API_KEY: '',
              ANTHROPIC_API_KEY: 'sk-ant-x',
              EMBEDDING_PROVIDER: 'none',
            }),
          ),
        ).not.toThrow();
      });

      it('names `none` as the deliberate alternative when the key is merely missing', () => {
        expect(() =>
          loadServerEnv(
            prod({ OPENAI_API_KEY: '', ANTHROPIC_API_KEY: 'sk-ant-x' }),
          ),
        ).toThrow(/EMBEDDING_PROVIDER=none/);
      });
    });
  });

  it('skips validation when SKIP_ENV_VALIDATION=1', () => {
    expect(() =>
      loadServerEnv({ SKIP_ENV_VALIDATION: '1' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});

describe('featuresFor', () => {
  it('reports a bare instance as having almost nothing configured', () => {
    const f = featuresFor(loadServerEnv(base()));
    expect(f.openai).toBe(true);
    expect(f.anyModelProvider).toBe(true);
    expect(f.anthropic).toBe(false);
    expect(f.webSearch).toBe(false);
    expect(f.billing).toBe(false);
    expect(f.githubIntegration).toBe(false);
    expect(f.durableStorage).toBe(false);
    expect(f.isolatedSandbox).toBe(false);
  });

  it('reports embeddings as unavailable when retrieval is deliberately lexical', () => {
    resetServerEnvCache();
    const f = featuresFor(loadServerEnv(base({ EMBEDDING_PROVIDER: 'none' })));
    expect(f.embeddings).toBe(false);
  });

  it('counts an acknowledged single-node volume as durable storage', () => {
    resetServerEnvCache();
    const f = featuresFor(loadServerEnv(base({ STORAGE_LOCAL_SINGLE_NODE_ACK: 'true' })));
    expect(f.durableStorage).toBe(true);
  });

  describe('build availability', () => {
    it('is available in development on the local driver', () => {
      resetServerEnvCache();
      expect(featuresFor(loadServerEnv(base())).build).toBe(true);
    });

    it('is unavailable wherever the operator turned it off', () => {
      resetServerEnvCache();
      expect(featuresFor(loadServerEnv(base({ BUILD_ENABLED: 'false' }))).build).toBe(false);
    });

    /**
     * Belt and braces: `loadServerEnv` already refuses this combination, but
     * `featuresFor` is a pure function that other code may call with an env it
     * built itself. It must never report Build as available in production
     * without isolation.
     */
    it('is unavailable in production without an isolated sandbox', () => {
      resetServerEnvCache();
      const env = loadServerEnv(base());
      expect(
        featuresFor({ ...env, NODE_ENV: 'production', SANDBOX_DRIVER: 'local' }).build,
      ).toBe(false);
    });
  });

  it('requires both halves of an OAuth pair', () => {
    resetServerEnvCache();
    const f = featuresFor(loadServerEnv(base({ AUTH_GOOGLE_ID: 'id' })));
    expect(f.googleSignIn).toBe(false);
  });

  it('reports sign-in as available only when both id and secret are set', () => {
    resetServerEnvCache();
    const f = featuresFor(
      loadServerEnv(base({ AUTH_GOOGLE_ID: 'id', AUTH_GOOGLE_SECRET: 'secret' })),
    );
    expect(f.googleSignIn).toBe(true);
  });
});

/**
 * Regression: a real deploy pasted a documented template verbatim, leaving
 * `POSTGRES_PASSWORD=<KEEP YOUR EXISTING VALUE>` and `ANTHROPIC_API_KEY=<your
 * key>`. Both are valid *strings*, so the schema accepted them and the failure
 * surfaced much later as a database authentication error — pointing at the
 * database rather than at the template that caused it.
 */
describe('unedited template placeholders', () => {
  beforeEach(() => resetServerEnvCache());

  it.each([
    ['ANTHROPIC_API_KEY', '<your key>'],
    ['POSTGRES_PASSWORD', '<KEEP YOUR EXISTING VALUE — DO NOT CHANGE>'],
    ['APP_URL', '<your domain>'],
  ])('rejects %s left as a placeholder', (name, value) => {
    expect(() => loadServerEnv(base({ [name]: value }))).toThrow(/still the placeholder/);
  });

  it('names the variable and shows the value, so the fix is obvious', () => {
    expect(() => loadServerEnv(base({ ANTHROPIC_API_KEY: '<your key>' }))).toThrow(
      /ANTHROPIC_API_KEY is still the placeholder <your key>/,
    );
  });

  it('reports every unfilled placeholder at once', () => {
    try {
      loadServerEnv(base({ ANTHROPIC_API_KEY: '<a>', S3_BUCKET: '<b>' }));
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as EnvironmentError).problems).toHaveLength(2);
    }
  });

  // Angle brackets are the signal; a value that merely contains one is fine.
  it('does not reject a real value containing an angle bracket', () => {
    expect(() => loadServerEnv(base({ ANTHROPIC_API_KEY: 'sk-ant-a<b' }))).not.toThrow();
  });

  it('leaves an unset variable alone', () => {
    expect(() => loadServerEnv(base({ S3_BUCKET: '' }))).not.toThrow();
  });
});
