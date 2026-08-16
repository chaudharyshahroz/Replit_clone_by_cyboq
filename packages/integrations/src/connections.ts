/**
 * Connection storage — the one place OAuth tokens are written and read.
 *
 * Every adapter returns plain data; persistence and encryption happen here
 * exactly once, so no provider adapter can store a token in the clear or
 * forget the AAD binding.
 *
 * Tokens are AES-256-GCM sealed and bound to `connection:<id>`. A row copied
 * onto another connection fails to decrypt rather than silently granting that
 * workspace access to someone else's account (DECISIONS.md D4).
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  connections,
  db,
  oauthCredentials,
  type Connection,
} from '@reklu/database';
import { createSecretBox, errors, loadServerEnv, logger, newId } from '@reklu/shared';
import { credentialsFor, getProvider } from './registry';
import type { ExternalAccount, IntegrationProviderKey, TokenSet } from './types';

/** Refresh this far ahead of expiry, so a call never races the clock. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

const aadFor = (connectionId: string): string => `connection:${connectionId}`;

function box() {
  const env = loadServerEnv();
  return createSecretBox({
    key: env.ENCRYPTION_KEY,
    previousKey: env.ENCRYPTION_KEY_PREVIOUS,
  });
}

export interface SaveConnectionInput {
  readonly provider: IntegrationProviderKey;
  readonly workspaceId: string;
  readonly userId: string;
  readonly tokens: TokenSet;
  readonly account: ExternalAccount;
}

/**
 * Store a freshly authorized connection.
 *
 * Re-authorizing an existing connection updates it in place rather than
 * creating a second row: a workspace connected twice to the same GitHub
 * account is a confusing state with no use, and it would leave one stale token
 * lying around encrypted.
 */
export async function saveConnection(input: SaveConnectionInput): Promise<Connection> {
  const provider = getProvider(input.provider);

  const existing = await db
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, input.workspaceId),
        eq(connections.provider, input.provider),
        eq(connections.externalAccountId, input.account.id),
        isNull(connections.deletedAt),
      ),
    )
    .limit(1);

  const connectionId = existing[0]?.id ?? newId('connection');
  const now = new Date();

  const row = {
    workspaceId: input.workspaceId,
    userId: input.userId,
    provider: input.provider,
    displayName: `${provider.displayName} — ${input.account.name}`,
    status: 'connected' as const,
    statusDetail: null,
    externalAccountId: input.account.id,
    externalAccountName: input.account.name,
    externalAccountAvatar: input.account.avatarUrl ?? null,
    scopes: [...input.tokens.scopes],
    lastVerifiedAt: now,
    updatedAt: now,
  };

  await db.transaction(async (tx) => {
    if (existing[0]) {
      await tx.update(connections).set(row).where(eq(connections.id, connectionId));
    } else {
      await tx.insert(connections).values({ id: connectionId, ...row });
    }

    // The AAD depends on the connection id, so sealing happens only once the id
    // is known — which is why this is inside the transaction rather than above.
    const sealed = {
      accessTokenEncrypted: box().encrypt(input.tokens.accessToken, aadFor(connectionId)),
      refreshTokenEncrypted: input.tokens.refreshToken
        ? box().encrypt(input.tokens.refreshToken, aadFor(connectionId))
        : null,
      tokenType: input.tokens.tokenType,
      expiresAt: input.tokens.expiresAt ?? null,
      lastRefreshedAt: now,
      updatedAt: now,
    };

    await tx
      .insert(oauthCredentials)
      .values({
        id: newId('credential'),
        connectionId,
        workspaceId: input.workspaceId,
        ...sealed,
      })
      .onConflictDoUpdate({ target: oauthCredentials.connectionId, set: sealed });
  });

  // Deliberately logs the account name, never the token or any part of it.
  logger.info('Connection stored', {
    provider: input.provider,
    workspaceId: input.workspaceId,
    account: input.account.name,
    scopes: input.tokens.scopes.length,
  });

  const [saved] = await db.select().from(connections).where(eq(connections.id, connectionId));
  if (!saved) throw errors.internal('Connection vanished immediately after being written.');
  return saved;
}

export interface ConnectionSummary {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly status: Connection['status'];
  readonly statusDetail: string | null;
  readonly accountName: string | null;
  readonly accountAvatar: string | null;
  readonly scopes: readonly string[];
  readonly connectedAt: Date;
  readonly lastUsedAt: Date | null;
}

/** Connections for a workspace. Returns no token material of any kind. */
export async function listConnections(workspaceId: string): Promise<ConnectionSummary[]> {
  const rows = await db
    .select()
    .from(connections)
    .where(and(eq(connections.workspaceId, workspaceId), isNull(connections.deletedAt)))
    .orderBy(desc(connections.createdAt));

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    displayName: row.displayName,
    status: row.status,
    statusDetail: row.statusDetail,
    accountName: row.externalAccountName,
    accountAvatar: row.externalAccountAvatar,
    scopes: row.scopes,
    connectedAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }));
}

/**
 * A usable access token for a connection, refreshed if it is about to expire.
 *
 * Workspace id is a required argument rather than something read from the row,
 * so a caller cannot accidentally use another tenant's connection by id alone.
 */
export async function accessTokenFor(
  connectionId: string,
  workspaceId: string,
): Promise<string> {
  const [row] = await db
    .select({
      connection: connections,
      credential: oauthCredentials,
    })
    .from(connections)
    .innerJoin(oauthCredentials, eq(oauthCredentials.connectionId, connections.id))
    .where(
      and(
        eq(connections.id, connectionId),
        eq(connections.workspaceId, workspaceId),
        isNull(connections.deletedAt),
      ),
    )
    .limit(1);

  if (!row) throw errors.notFound('Connection', connectionId);

  const aad = aadFor(connectionId);
  const { plaintext: accessToken } = box().decryptForRotation(
    row.credential.accessTokenEncrypted,
    aad,
  );

  const expiresAt = row.credential.expiresAt;
  const needsRefresh = expiresAt !== null && expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;
  if (!needsRefresh) {
    await touch(connectionId);
    return accessToken;
  }

  const providerKey = row.connection.provider as IntegrationProviderKey;
  const provider = getProvider(providerKey);
  const credentials = credentialsFor(providerKey);

  // A provider with no refresh flow, no stored refresh token, or credentials
  // that have since been removed cannot be recovered automatically. Say so
  // rather than returning a token that is about to fail mid-operation.
  if (!provider.refresh || !row.credential.refreshTokenEncrypted || !credentials) {
    await markNeedsAttention(
      connectionId,
      'This connection has expired and must be authorized again.',
    );
    throw errors.validation(
      `The ${provider.displayName} connection has expired. Reconnect it in Settings → Connections.`,
    );
  }

  const refreshToken = box().decrypt(row.credential.refreshTokenEncrypted, aad);

  try {
    const refreshed = await provider.refresh({ credentials, refreshToken });
    const now = new Date();

    await db
      .update(oauthCredentials)
      .set({
        accessTokenEncrypted: box().encrypt(refreshed.accessToken, aad),
        // Providers that rotate refresh tokens return a new one; keep the old
        // one when they do not, or the connection dies at the next refresh.
        refreshTokenEncrypted: refreshed.refreshToken
          ? box().encrypt(refreshed.refreshToken, aad)
          : row.credential.refreshTokenEncrypted,
        expiresAt: refreshed.expiresAt ?? null,
        lastRefreshedAt: now,
        updatedAt: now,
      })
      .where(eq(oauthCredentials.connectionId, connectionId));

    await touch(connectionId);
    logger.info('Connection token refreshed', { provider: providerKey, connectionId });
    return refreshed.accessToken;
  } catch (error) {
    await markNeedsAttention(connectionId, 'Reklu could not refresh this connection.');
    logger.warn('Token refresh failed', { provider: providerKey, connectionId, error });
    throw errors.validation(
      `The ${provider.displayName} connection could not be refreshed. Reconnect it in Settings → Connections.`,
    );
  }
}

async function touch(connectionId: string): Promise<void> {
  await db
    .update(connections)
    .set({ lastUsedAt: new Date() })
    .where(eq(connections.id, connectionId));
}

async function markNeedsAttention(connectionId: string, detail: string): Promise<void> {
  await db
    .update(connections)
    .set({ status: 'needs_attention', statusDetail: detail, updatedAt: new Date() })
    .where(eq(connections.id, connectionId));
}

/**
 * Disconnect.
 *
 * The credential row is deleted outright rather than soft-deleted: a revoked
 * connection has no reason to keep encrypted tokens, and "we still hold your
 * GitHub token, just hidden" is not what disconnecting means to a user. The
 * connection row itself is soft-deleted so history that references it survives.
 */
export async function revokeConnection(
  connectionId: string,
  workspaceId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: connections.id, provider: connections.provider })
    .from(connections)
    .where(
      and(
        eq(connections.id, connectionId),
        eq(connections.workspaceId, workspaceId),
        isNull(connections.deletedAt),
      ),
    )
    .limit(1);

  if (!row) throw errors.notFound('Connection', connectionId);

  await db.transaction(async (tx) => {
    await tx.delete(oauthCredentials).where(eq(oauthCredentials.connectionId, connectionId));
    await tx
      .update(connections)
      .set({ status: 'disconnected', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(connections.id, connectionId));
  });

  logger.info('Connection revoked', { provider: row.provider, workspaceId });
}

/** Re-check a stored token against the provider, and record what was found. */
export async function verifyConnection(
  connectionId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ provider: connections.provider })
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw errors.notFound('Connection', connectionId);

  let works = false;
  try {
    const token = await accessTokenFor(connectionId, workspaceId);
    works = await getProvider(row.provider as IntegrationProviderKey).verify(token);
  } catch {
    works = false;
  }

  await db
    .update(connections)
    .set(
      works
        ? { status: 'connected', statusDetail: null, lastVerifiedAt: new Date() }
        : {
            status: 'needs_attention',
            statusDetail: 'The provider rejected the stored credentials.',
          },
    )
    .where(eq(connections.id, connectionId));

  return works;
}
