/**
 * Identity: users, OAuth accounts, sessions, verification tokens.
 *
 * Shapes are Auth.js-compatible so the adapter needs no translation layer,
 * with Reklu's prefixed ids and a few product columns added.
 */
import { relations } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { primaryId, timestamps, tsColumn } from './_shared';
import { workspaceMembers } from './tenancy';

export const users = pgTable(
  'users',
  {
    id: primaryId('user'),
    email: text('email').notNull(),
    /**
     * Lowercased email used for uniqueness and lookup. Storing this separately
     * preserves the address the user typed while making "Ada@x.com" and
     * "ada@x.com" the same account.
     */
    emailNormalized: text('email_normalized').notNull(),
    emailVerified: tsColumn('email_verified'),
    name: text('name'),
    image: text('image'),

    /** Argon2id/bcrypt hash. Null for OAuth-only accounts. */
    passwordHash: text('password_hash'),

    /** Platform super-admin (spec §78). Never settable through the product UI. */
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),

    /** Set when the account is suspended by an admin; blocks sign-in. */
    suspendedAt: tsColumn('suspended_at'),
    suspendedReason: text('suspended_reason'),

    /** Onboarding (spec §70). Null until completed. */
    onboardedAt: tsColumn('onboarded_at'),
    /** Chosen primary use cases, e.g. ["research","development"]. */
    usageIntent: jsonb('usage_intent').$type<string[]>().notNull().default([]),

    /** UI preferences: theme, density, default model, memory settings. */
    preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),

    lastSeenAt: tsColumn('last_seen_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_normalized_idx').on(table.emailNormalized),
    index('users_last_seen_idx').on(table.lastSeenAt),
  ],
);

/** Linked OAuth providers (Auth.js `Account`). */
export const accounts = pgTable(
  'accounts',
  {
    id: primaryId('account'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // oauth | oidc | email | credentials
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),

    /**
     * Sign-in tokens only. Tokens for *integrations* the user connects
     * (GitHub repos, Vercel, Supabase) live encrypted in `oauth_credentials` —
     * see schema/tools.ts. Keeping them apart means a sign-in token cannot be
     * repurposed to act on a user's repositories.
     */
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: tsColumn('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('accounts_provider_account_idx').on(table.provider, table.providerAccountId),
    index('accounts_user_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: primaryId('session'),
    sessionToken: text('session_token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: tsColumn('expires').notNull(),

    /** Shown in Settings → Security so a user can recognise and revoke a session. */
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    lastActiveAt: tsColumn('last_active_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('sessions_token_idx').on(table.sessionToken),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expires_idx').on(table.expires),
  ],
);

/** Email verification and password reset tokens. Stored hashed. */
export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    /** SHA-256 of the emailed token — a database leak must not yield live links. */
    tokenHash: text('token_hash').notNull(),
    purpose: text('purpose').notNull().default('email_verification'),
    expires: tsColumn('expires').notNull(),
    consumedAt: tsColumn('consumed_at'),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex('verification_tokens_pk').on(table.identifier, table.tokenHash),
    index('verification_tokens_expires_idx').on(table.expires),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  workspaceMemberships: many(workspaceMembers),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
