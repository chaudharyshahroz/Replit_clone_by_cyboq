/**
 * Connectors defined as data.
 *
 * Four providers were four files repeating the same OAuth dance with different
 * URLs — fine for four, hopeless for two hundred. A connector is a descriptor
 * now, and one adapter serves all of them.
 *
 * What these tests protect is the variation the descriptors have to express.
 * Every provider claims to do OAuth 2.0 and every one of them differs somewhere
 * that fails silently: a scope separator, where the secret goes, whether an
 * identity endpoint exists at all.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../catalogue';
import { createOAuthProvider, credentialEnvFor } from '../oauth-catalogue';
import { allProviders, getProvider, isIntegrationProvider } from '../registry';

const credentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://reklu.app/api/integrations/x/callback',
};

describe('a catalogued provider', () => {
  it('is reachable the same way a hand-written one is', () => {
    for (const descriptor of CATALOGUE) {
      expect(isIntegrationProvider(descriptor.key), descriptor.key).toBe(true);
      expect(getProvider(descriptor.key).displayName).toBe(descriptor.displayName);
    }
  });

  it('names its own environment variables', () => {
    /* Derived from the key, so adding a connector adds no schema to maintain. */
    expect(credentialEnvFor('slack')).toEqual([
      'SLACK_OAUTH_CLIENT_ID',
      'SLACK_OAUTH_CLIENT_SECRET',
    ]);
    expect(credentialEnvFor('google-drive')).toEqual([
      'GOOGLE_DRIVE_OAUTH_CLIENT_ID',
      'GOOGLE_DRIVE_OAUTH_CLIENT_SECRET',
    ]);
  });

  it('appears beside the hand-written ones', () => {
    const keys = allProviders().map((provider) => provider.key);
    expect(keys).toContain('github');
    expect(keys).toContain('slack');
    /* No duplicates: a key belongs to one provider however it was defined. */
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the variation a descriptor has to express', () => {
  it('joins scopes the way the provider wants', () => {
    /*
     * Slack takes commas. Sent spaces, it reads the whole list as one unknown
     * scope and refuses the authorization — with a message about the scope,
     * not about the separator.
     */
    const slack = CATALOGUE.find((entry) => entry.key === 'slack')!;
    const url = createOAuthProvider(slack).authorizeUrl({ credentials, state: 's' });

    expect(new URL(url).searchParams.get('scope')).toBe(slack.scopes.join(','));
  });

  it('carries the extra authorize parameters a provider requires', () => {
    const notion = CATALOGUE.find((entry) => entry.key === 'notion')!;
    const url = createOAuthProvider(notion).authorizeUrl({ credentials, state: 's' });

    expect(new URL(url).searchParams.get('owner')).toBe('user');
  });

  it('omits a PKCE challenge for a provider that does not accept one', () => {
    // Sent anyway, some token endpoints reject the exchange outright.
    const slack = CATALOGUE.find((entry) => entry.key === 'slack')!;
    const url = createOAuthProvider(slack).authorizeUrl({
      credentials,
      state: 's',
      codeChallenge: 'abc',
    });

    expect(new URL(url).searchParams.has('code_challenge')).toBe(false);
  });

  it('reports connected when there is nothing cheap to verify against', async () => {
    /*
     * Notion has no userinfo endpoint. Inventing a request to a URL it does not
     * serve would report a broken connection that is not broken.
     */
    const notion = CATALOGUE.find((entry) => entry.key === 'notion')!;
    expect(await createOAuthProvider(notion).verify('token')).toBe(true);
  });
});

describe('every entry in the catalogue', () => {
  it('uses https for both endpoints', () => {
    /* A credential would travel in clear text otherwise. */
    for (const entry of CATALOGUE) {
      expect(entry.authorizeUrl.startsWith('https://'), entry.key).toBe(true);
      expect(entry.tokenUrl.startsWith('https://'), entry.key).toBe(true);
    }
  });

  it('explains every scope it asks for', () => {
    /*
     * Consent is only informed if the person is told what they are granting,
     * and a scope with no description reaches the UI as a raw string.
     */
    for (const entry of CATALOGUE) {
      for (const scope of entry.scopes) {
        expect(entry.scopeDescriptions[scope], `${entry.key}: ${scope}`).toBeTruthy();
      }
    }
  });

  it('has a unique key', () => {
    const keys = CATALOGUE.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
