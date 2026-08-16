/**
 * Connections, encrypted credentials, MCP servers and tools, and the execution
 * audit trail (spec §46–49). Threat model: docs/MCP_SECURITY.md.
 *
 * Two invariants this schema enforces structurally:
 *
 *  1. Secrets live only in `oauth_credentials`, encrypted, AAD-bound to their
 *     connection id. No other table stores a token.
 *  2. Every tool carries a risk class, and every execution is recorded —
 *     including the ones that were denied.
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { primaryId, softDelete, timestamps, tsColumn } from './_shared';
import {
  connectionStatusEnum,
  mcpTransportEnum,
  toolExecutionStatusEnum,
  toolRiskClassEnum,
} from './enums';
import { users } from './identity';
import { workspaces } from './tenancy';

/**
 * A connected external service. Users see familiar product names here
 * ("GitHub", "Slack"), never transport details (spec §46).
 */
export const connections = pgTable(
  'connections',
  {
    id: primaryId('connection'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Personal connections are scoped to one user; null means workspace-wide. */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),

    provider: text('provider').notNull(), // github | vercel | supabase | slack | ...
    displayName: text('display_name').notNull(),
    status: connectionStatusEnum('status').notNull().default('connected'),
    statusDetail: text('status_detail'),

    /** Non-sensitive identity of the connected account, shown in the UI. */
    externalAccountId: text('external_account_id'),
    externalAccountName: text('external_account_name'),
    externalAccountAvatar: text('external_account_avatar'),

    /** Granted OAuth scopes, so the UI can explain what Reklu may do. */
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),

    lastUsedAt: tsColumn('last_used_at'),
    lastVerifiedAt: tsColumn('last_verified_at'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('connections_workspace_idx').on(table.workspaceId),
    index('connections_provider_idx').on(table.workspaceId, table.provider),
    index('connections_status_idx').on(table.status),
    index('connections_deleted_idx').on(table.deletedAt),
  ],
);

/**
 * Encrypted OAuth tokens. The only table in Reklu that holds user secrets.
 *
 * Ciphertext is AAD-bound to `connection:<id>`, so a row copied onto another
 * connection cannot be decrypted — see packages/shared/src/crypto.ts.
 */
export const oauthCredentials = pgTable(
  'oauth_credentials',
  {
    id: primaryId('credential'),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    /** AES-256-GCM envelopes: `v1.<iv>.<tag>.<ciphertext>`. */
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenType: text('token_type').default('Bearer'),
    expiresAt: tsColumn('expires_at'),

    /** Bumped when re-encrypted under a rotated key. */
    keyVersion: integer('key_version').notNull().default(1),
    lastRefreshedAt: tsColumn('last_refreshed_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('oauth_credentials_connection_idx').on(table.connectionId),
    index('oauth_credentials_expires_idx').on(table.expiresAt),
  ],
);

export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: primaryId('mcpServer'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    description: text('description'),
    transport: mcpTransportEnum('transport').notNull().default('http'),

    /** For http/sse. Validated against the SSRF allowlist before every request. */
    endpoint: text('endpoint'),
    /** For stdio. Disabled unless the deployment explicitly permits local servers. */
    command: text('command'),
    args: jsonb('args').$type<string[]>().notNull().default([]),

    /** Encrypted auth header/token for this server, AAD-bound to `mcp:<id>`. */
    credentialEncrypted: text('credential_encrypted'),
    /** Names only. Values are encrypted in `credentialEncrypted`. */
    envKeys: jsonb('env_keys').$type<string[]>().notNull().default([]),

    status: connectionStatusEnum('status').notNull().default('connected'),
    statusDetail: text('status_detail'),

    /**
     * Server-advertised tool definitions are untrusted input. This records the
     * schema hash last shown to and approved by the user, so a server that
     * silently changes a tool's description or parameters (schema poisoning)
     * is detected and re-prompted rather than trusted.
     */
    toolSchemaHash: text('tool_schema_hash'),
    toolSchemaApprovedAt: tsColumn('tool_schema_approved_at'),
    toolSchemaApprovedBy: text('tool_schema_approved_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    lastDiscoveredAt: tsColumn('last_discovered_at'),
    lastUsedAt: tsColumn('last_used_at'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('mcp_servers_workspace_idx').on(table.workspaceId),
    index('mcp_servers_status_idx').on(table.status),
    index('mcp_servers_deleted_idx').on(table.deletedAt),
  ],
);

export const mcpTools = pgTable(
  'mcp_tools',
  {
    id: primaryId('mcpTool'),
    mcpServerId: text('mcp_server_id')
      .notNull()
      .references(() => mcpServers.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    /** Server-supplied description. Rendered as untrusted text, never as instruction. */
    description: text('description'),
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().notNull().default({}),

    /**
     * Classified on discovery (heuristics + the server's own annotations), then
     * overridable by an admin. Decides whether a call needs human approval.
     */
    riskClass: toolRiskClassEnum('risk_class').notNull().default('update'),
    riskClassOverriddenBy: text('risk_class_overridden_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Tools are opt-in: discovered disabled, enabled deliberately by a user. */
    enabled: boolean('enabled').notNull().default(false),
    /** True when read-only calls may run without a per-call prompt. */
    autoApproveReads: boolean('auto_approve_reads').notNull().default(false),

    executionCount: integer('execution_count').notNull().default(0),
    lastExecutedAt: tsColumn('last_executed_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('mcp_tools_server_name_idx').on(table.mcpServerId, table.name),
    index('mcp_tools_workspace_idx').on(table.workspaceId),
    index('mcp_tools_enabled_idx').on(table.enabled),
  ],
);

/**
 * Every tool invocation, including denials. This is the audit trail spec §49
 * requires, and the evidence base for answering "what did the agent do?".
 */
export const toolExecutions = pgTable(
  'tool_executions',
  {
    id: primaryId('toolExecution'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: text('project_id'),
    conversationId: text('conversation_id'),
    messageId: text('message_id'),
    agentRunId: text('agent_run_id'),

    /** Either an MCP tool or a Reklu built-in. */
    mcpToolId: text('mcp_tool_id').references(() => mcpTools.id, { onDelete: 'set null' }),
    toolName: text('tool_name').notNull(),
    riskClass: toolRiskClassEnum('risk_class').notNull(),

    status: toolExecutionStatusEnum('status').notNull().default('pending_approval'),

    /** Arguments as sent. Redacted before storage if they contain secrets. */
    input: jsonb('input').$type<Record<string, unknown>>(),
    /** Truncated result. Always treated as untrusted data when fed back to a model. */
    output: jsonb('output').$type<unknown>(),
    errorMessage: text('error_message'),

    /** Who approved a write, and when. Null for auto-approved reads. */
    approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: tsColumn('approved_at'),
    deniedReason: text('denied_reason'),

    durationMs: integer('duration_ms'),
    ...timestamps,
  },
  (table) => [
    index('tool_executions_workspace_time_idx').on(table.workspaceId, table.createdAt),
    index('tool_executions_tool_idx').on(table.mcpToolId),
    index('tool_executions_status_idx').on(table.status),
    index('tool_executions_agent_idx').on(table.agentRunId),
    index('tool_executions_conversation_idx').on(table.conversationId),
  ],
);

export const connectionsRelations = relations(connections, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [connections.workspaceId], references: [workspaces.id] }),
  credential: one(oauthCredentials),
  // A connection may authorize several MCP servers.
  mcpServers: many(mcpServers),
}));

export const oauthCredentialsRelations = relations(oauthCredentials, ({ one }) => ({
  connection: one(connections, {
    fields: [oauthCredentials.connectionId],
    references: [connections.id],
  }),
}));

export const mcpServersRelations = relations(mcpServers, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [mcpServers.workspaceId], references: [workspaces.id] }),
  tools: many(mcpTools),
}));

export const mcpToolsRelations = relations(mcpTools, ({ one, many }) => ({
  server: one(mcpServers, { fields: [mcpTools.mcpServerId], references: [mcpServers.id] }),
  executions: many(toolExecutions),
}));

export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type OAuthCredential = typeof oauthCredentials.$inferSelect;
export type McpServer = typeof mcpServers.$inferSelect;
export type McpTool = typeof mcpTools.$inferSelect;
export type ToolExecution = typeof toolExecutions.$inferSelect;
export type ToolRiskClass = McpTool['riskClass'];
