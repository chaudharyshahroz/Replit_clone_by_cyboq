import { describe, expect, it } from 'vitest';
import { isRetryableProviderFailure } from '../providers/vendor';

describe('provider capability fallback', () => {
  it.each([200, undefined])('retries an upstream overload carried by status %s', (status) => {
    expect(isRetryableProviderFailure(status,
      'Upstream error from Nvidia: Service temporarily overloaded')).toBe(true);
  });

  it.each([400, 401, 402, 403, 404, 422])('does not disguise a permanent %s failure as an overload', (status) => {
    expect(isRetryableProviderFailure(status, 'Service temporarily overloaded')).toBe(false);
  });

  it.each(['Invalid API key', 'Insufficient credits', 'Content policy refusal', 'Invalid request'])('does not retry %s under HTTP 200', (message) => {
    expect(isRetryableProviderFailure(200, message)).toBe(false);
  });

  it('retries a request timeout', () => {
    expect(isRetryableProviderFailure(408, 'Request timeout')).toBe(true);
  });

  it('retries a provider timeout that has no HTTP response', () => {
    expect(isRetryableProviderFailure(undefined, 'The operation timed out')).toBe(true);
  });

  it('retries OpenRouter image endpoint mismatches on another vision model', () => {
    expect(
      isRetryableProviderFailure(404, 'No endpoints found that support image input'),
    ).toBe(true);
  });

  it('does not treat an ordinary missing endpoint as retryable', () => {
    expect(isRetryableProviderFailure(404, 'Model not found')).toBe(false);
  });
});

describe('a model that has been retired', () => {
  /**
   * OpenRouter retires a free variant and answers 404 with the replacement
   * slug in prose. Reklu's router already knows how to move to another model;
   * classified as a plain 404 it never got the chance, so one stale slug failed
   * a whole build with the provider's message pasted into the interface.
   */
  const RETIRED =
    'This model is unavailable for free. The paid version is available now - use this slug instead: minimax/minimax-m2.7';

  it('lets the router move to another model', () => {
    expect(isRetryableProviderFailure(404, RETIRED)).toBe(true);
  });

  it('recognises the other ways a provider says the same thing', () => {
    expect(isRetryableProviderFailure(404, 'This model has been deprecated')).toBe(true);
    expect(isRetryableProviderFailure(400, 'openai/gpt-4 is no longer available')).toBe(true);
  });

  it('still refuses to fall back on a plainly wrong identifier', () => {
    /*
     * A typo'd or invented model name is a mistake to surface, not to paper
     * over by spending budget on three more models. The distinction is that a
     * retired model was valid and stopped serving; this one never was.
     */
    expect(isRetryableProviderFailure(404, 'Model not found')).toBe(false);
    expect(isRetryableProviderFailure(404, 'No such model: foo/bar')).toBe(false);
  });
});
