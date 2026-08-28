/**
 * Which endpoint each provider is sent to.
 *
 * `openai(id)` resolves to the Responses API, which is OpenAI's own newer
 * surface. An OpenAI-*compatible* provider implements Chat Completions — that
 * is what compatible means — and may or may not have Responses at all.
 *
 * Getting this wrong produces a 404 from a host that is working perfectly,
 * about a model that exists, which reads as the model being unavailable rather
 * than as Reklu knocking on the wrong door.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../providers/index.ts', import.meta.url), 'utf8');

/** The body of one `case` in the provider switch. */
function providerCase(key: string): string {
  const start = source.indexOf(`case '${key}':`);
  const end = source.indexOf('      break;', start);
  return source.slice(start, end);
}

describe('OpenAI-compatible providers', () => {
  it('are asked for chat completions explicitly', () => {
    for (const key of ['openrouter', 'bai']) {
      expect(providerCase(key), key).toMatch(/\.chat\(/);
    }
  });

  it('are pointed at their own host', () => {
    /*
     * Without a base URL the SDK talks to OpenAI, using a key issued by
     * somebody else — which fails, and looks like every model routing to
     * OpenAI regardless of what was chosen.
     */
    expect(providerCase('openrouter')).toContain('OPENROUTER_BASE_URL');
    expect(providerCase('bai')).toContain('BAI_BASE_URL');
  });

  it('use their own credential', () => {
    expect(providerCase('openrouter')).toContain('OPENROUTER_API_KEY');
    expect(providerCase('bai')).toContain('BAI_API_KEY');
    /* A key sent to the wrong host is a credential given away. */
    expect(providerCase('bai')).not.toContain('OPENAI_API_KEY');
    expect(providerCase('openrouter')).not.toContain('OPENAI_API_KEY');
  });
});

describe('OpenAI itself', () => {
  it('is left on the SDK default', () => {
    /* Responses is OpenAI's own surface and the one their SDK prefers. */
    expect(providerCase('openai')).not.toMatch(/\.chat\(/);
  });
});
