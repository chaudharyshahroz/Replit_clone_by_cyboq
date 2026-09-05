/**
 * Official provider catalogs are deliberately explicit seed data. These tests
 * prevent a retired identifier from quietly returning during a later edit.
 */
import { describe, expect, it } from 'vitest';
import { MODELS, PROVIDERS } from '../seed/data';

describe('direct DeepSeek and Kimi integrations', () => {
  it('use provider-specific credentials', () => {
    expect(PROVIDERS.find((provider) => provider.key === 'deepseek')?.apiKeyEnvVar).toBe(
      'DEEPSEEK_API_KEY',
    );
    expect(PROVIDERS.find((provider) => provider.key === 'kimi')?.apiKeyEnvVar).toBe(
      'MOONSHOT_API_KEY',
    );
  });

  it('seed only current official DeepSeek identifiers', () => {
    const ids = MODELS.filter((model) => model.providerKey === 'deepseek').map(
      (model) => model.modelIdentifier,
    );

    expect(ids).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
    expect(ids).not.toContain('deepseek-chat');
    expect(ids).not.toContain('deepseek-reasoner');
  });

  it('seed only current official Kimi identifiers', () => {
    const ids = MODELS.filter((model) => model.providerKey === 'kimi').map(
      (model) => model.modelIdentifier,
    );

    expect(ids).toEqual([
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
      'kimi-k2.6',
    ]);
    expect(ids).not.toContain('kimi-k2.5');
    expect(ids.some((id) => id.startsWith('moonshot-v1'))).toBe(false);
  });
});
