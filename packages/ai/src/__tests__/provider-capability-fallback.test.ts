import { describe, expect, it } from 'vitest';
import { isRetryableProviderFailure } from '../providers/vendor';

describe('provider capability fallback', () => {
  it('retries OpenRouter image endpoint mismatches on another vision model', () => {
    expect(
      isRetryableProviderFailure(404, 'No endpoints found that support image input'),
    ).toBe(true);
  });

  it('does not treat an ordinary missing endpoint as retryable', () => {
    expect(isRetryableProviderFailure(404, 'Model not found')).toBe(false);
  });
});
