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

  it('retries OpenRouter image endpoint mismatches on another vision model', () => {
    expect(
      isRetryableProviderFailure(404, 'No endpoints found that support image input'),
    ).toBe(true);
  });

  it('does not treat an ordinary missing endpoint as retryable', () => {
    expect(isRetryableProviderFailure(404, 'Model not found')).toBe(false);
  });
});
