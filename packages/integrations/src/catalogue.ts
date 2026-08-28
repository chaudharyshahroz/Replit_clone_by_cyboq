/**
 * The connectors Reklu knows how to talk to.
 *
 * Every endpoint here was read from the provider's own documentation rather
 * than recalled. That distinction has already cost this project a week: a set
 * of model identifiers was written from memory, every one had been withdrawn,
 * and the failures looked like Reklu was broken rather than like the world had
 * moved. An OAuth URL written from memory fails the same way, except it fails
 * at the moment somebody is trying to connect their account.
 *
 * So this list grows by verification, not by recollection. A connector nobody
 * has checked is worse than a connector nobody has added — the second is a gap,
 * and the first is a button that fails after the person has already decided to
 * trust it.
 */
import type { OAuthDescriptor } from './oauth-catalogue';

export const CATALOGUE: readonly OAuthDescriptor[] = [
  {
    key: 'slack',
    displayName: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    usesPkce: false,
    /* Slack takes comma-separated scopes, unlike most. */
    scopeSeparator: ',',
    scopes: ['channels:history', 'channels:read', 'search:read', 'users:read'],
    scopeDescriptions: {
      'channels:history': 'Read messages in public channels.',
      'channels:read': 'See which public channels exist.',
      'search:read': 'Search messages you can already see.',
      'users:read': 'See who is in the workspace, to attribute messages.',
    },
    /*
     * Slack returns the workspace in the token response and has no userinfo
     * endpoint. `team.name` is what somebody recognises — the account they
     * connected is a workspace, not a person.
     */
    identity: { from: 'token', idPath: 'team.id', namePath: 'team.name' },
    verifyUrl: 'https://slack.com/api/auth.test',
  },
  {
    key: 'notion',
    displayName: 'Notion',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    usesPkce: false,
    /*
     * Notion requires HTTP Basic at the token endpoint. Sending the secret in
     * the body returns a 401 that says nothing about why.
     */
    tokenAuth: 'basic',
    /* Notion grants capabilities through the integration, not through scopes. */
    scopes: [],
    scopeDescriptions: {},
    authorizeParams: { owner: 'user' },
    identity: { from: 'token', idPath: 'workspace_id', namePath: 'workspace_name', avatarPath: 'workspace_icon' },
  },
];
