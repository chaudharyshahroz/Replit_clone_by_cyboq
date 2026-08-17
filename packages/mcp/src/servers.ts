/**
 * Connecting MCP servers and running their tools (spec §46, §49).
 *
 * Two invariants live here, and both exist because the server is not under
 * Reklu's control:
 *
 *   1. **Tools are discovered disabled.** Connecting a server grants nothing.
 *      Each tool is turned on deliberately, and a tool added by a later
 *      discovery arrives disabled too.
 *   2. **Every call is recorded, including the ones that were refused.** The
 *      audit trail is the evidence base for "what did the agent do?", and a
 *      denial is part of that answer.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, mcpServers, mcpTools, toolExecutions } from '@reklu/database';
import { createSecretBox, errors, loadServerEnv, logger, newId } from '@reklu/shared';
import { callTool, probeServer, type DiscoveredTool, type McpClientOptions } from './client';
import { decidePermission } from './permissions';
import { classifyTool, type RiskClass } from './risk';
import { diffTools, hashTools } from './schema-hash';

/** AAD binding, so a credential row copied onto another server will not decrypt. */
const aadFor = (serverId: string): string => `mcp:${serverId}`;

function box() {
  const env = loadServerEnv();
  return createSecretBox({
    key: env.ENCRYPTION_KEY,
    previousKey: env.ENCRYPTION_KEY_PREVIOUS,
  });
}

export interface ConnectServerInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly endpoint: string;
  /** Optional bearer credential. Stored encrypted, never returned. */
  readonly credential?: string | undefined;
}

export interface ConnectedServer {
  readonly serverId: string;
  readonly serverName: string;
  readonly toolCount: number;
  /** Tools arrive disabled; this is the count awaiting review. */
  readonly awaitingApproval: number;
}

/**
 * Connect a server and record what it offers.
 *
 * The probe happens before anything is written, so a server that cannot be
 * reached does not leave a dead row behind.
 */
export async function connectServer(input: ConnectServerInput): Promise<ConnectedServer> {
  const probe = await probeServer({
    endpoint: input.endpoint,
    credential: input.credential,
  });

  const serverId = newId('mcpServer');
  const schemaHash = hashTools(probe.tools);

  await db.transaction(async (tx) => {
    await tx.insert(mcpServers).values({
      id: serverId,
      workspaceId: input.workspaceId,
      createdById: input.userId,
      name: input.name.trim() || probe.serverName,
      transport: 'http',
      endpoint: input.endpoint,
      credentialEncrypted: input.credential
        ? box().encrypt(input.credential, aadFor(serverId))
        : null,
      status: 'connected',
      // Recorded, not approved: nothing may run until a human reviews it.
      toolSchemaHash: schemaHash,
      toolSchemaApprovedAt: null,
      lastDiscoveredAt: new Date(),
    });

    for (const tool of probe.tools) {
      await tx.insert(mcpTools).values({
        id: newId('mcpTool'),
        mcpServerId: serverId,
        workspaceId: input.workspaceId,
        name: tool.name,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema ?? {},
        riskClass: classifyTool(tool) as RiskClass,
        // The invariant: discovered disabled, always.
        enabled: false,
        autoApproveReads: false,
      });
    }
  });

  logger.info('Connected MCP server', { serverId, tools: probe.tools.length });

  return {
    serverId,
    serverName: probe.serverName,
    toolCount: probe.tools.length,
    awaitingApproval: probe.tools.length,
  };
}

async function clientFor(serverId: string, workspaceId: string): Promise<{
  options: McpClientOptions;
  server: typeof mcpServers.$inferSelect;
}> {
  const [server] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
    .limit(1);

  if (!server) throw errors.notFound('MCP server', serverId);
  if (!server.endpoint) {
    throw errors.validation('This server has no endpoint. Only HTTP servers are supported.');
  }

  return {
    server,
    options: {
      endpoint: server.endpoint,
      credential: server.credentialEncrypted
        ? box().decrypt(server.credentialEncrypted, aadFor(serverId))
        : undefined,
    },
  };
}

export interface RediscoveryResult {
  readonly changed: boolean;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly string[];
  readonly detail: string;
}

/**
 * Re-read a server's tools and detect drift.
 *
 * A changed schema **withdraws approval** rather than disabling the server:
 * silently continuing would defeat the check, and silently disconnecting would
 * hide it. Newly appeared tools arrive disabled, so drift can never widen
 * access on its own.
 */
export async function rediscoverTools(
  serverId: string,
  workspaceId: string,
): Promise<RediscoveryResult> {
  const { options } = await clientFor(serverId, workspaceId);
  const live = await probeServer(options);

  const stored = await db
    .select({
      id: mcpTools.id,
      name: mcpTools.name,
      description: mcpTools.description,
      inputSchema: mcpTools.inputSchema,
    })
    .from(mcpTools)
    .where(eq(mcpTools.mcpServerId, serverId));

  const diff = diffTools(
    stored.map((tool) => ({
      name: tool.name,
      description: tool.description ?? undefined,
      inputSchema: tool.inputSchema,
    })),
    live.tools,
  );

  const changed =
    diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0;

  const nextHash = hashTools(live.tools);
  const byName = new Map(stored.map((tool) => [tool.name, tool]));

  await db.transaction(async (tx) => {
    for (const tool of live.tools) {
      const existing = byName.get(tool.name);

      if (existing) {
        await tx
          .update(mcpTools)
          .set({
            description: tool.description ?? null,
            inputSchema: tool.inputSchema ?? {},
            riskClass: classifyTool(tool) as RiskClass,
            updatedAt: new Date(),
          })
          .where(eq(mcpTools.id, existing.id));
      } else {
        await tx.insert(mcpTools).values({
          id: newId('mcpTool'),
          mcpServerId: serverId,
          workspaceId,
          name: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? {},
          riskClass: classifyTool(tool) as RiskClass,
          // A tool that appeared during rediscovery is still a new tool.
          enabled: false,
          autoApproveReads: false,
        });
      }
    }

    await tx
      .update(mcpServers)
      .set({
        toolSchemaHash: nextHash,
        // Approval is withdrawn precisely when something changed.
        ...(changed ? { toolSchemaApprovedAt: null, toolSchemaApprovedBy: null } : {}),
        lastDiscoveredAt: new Date(),
        status: changed ? 'needs_attention' : 'connected',
        statusDetail: changed ? 'Tool definitions changed. Review them before use.' : null,
      })
      .where(eq(mcpServers.id, serverId));
  });

  return {
    changed,
    ...diff,
    detail: changed
      ? 'This server changed its tool definitions. Review them before using it again.'
      : 'Tools match what you approved.',
  };
}

/** Record that a human reviewed the current definitions. */
export async function approveToolSchema(params: {
  serverId: string;
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const { options } = await clientFor(params.serverId, params.workspaceId);
  const live = await probeServer(options);

  // Approve the hash of what is live *now*, not a stored one that may already
  // be stale — otherwise the approval could cover something never displayed.
  await db
    .update(mcpServers)
    .set({
      toolSchemaHash: hashTools(live.tools),
      toolSchemaApprovedAt: new Date(),
      toolSchemaApprovedBy: params.userId,
      status: 'connected',
      statusDetail: null,
    })
    .where(
      and(
        eq(mcpServers.id, params.serverId),
        eq(mcpServers.workspaceId, params.workspaceId),
      ),
    );
}

export async function setToolEnabled(params: {
  toolId: string;
  workspaceId: string;
  enabled: boolean;
  autoApproveReads?: boolean | undefined;
}): Promise<void> {
  await db
    .update(mcpTools)
    .set({
      enabled: params.enabled,
      ...(params.autoApproveReads !== undefined
        ? { autoApproveReads: params.autoApproveReads }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(mcpTools.id, params.toolId), eq(mcpTools.workspaceId, params.workspaceId)),
    );
}

export interface ExecuteRequest {
  readonly toolId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly args: Record<string, unknown>;
  /** Tool ids an invoking skill was granted. Undefined for a direct user call. */
  readonly grantedToolIds?: readonly string[] | undefined;
  /** True when a human approved this specific call. */
  readonly approved?: boolean | undefined;
  readonly conversationId?: string | undefined;
}

export interface ExecuteResult {
  readonly status: 'succeeded' | 'failed' | 'denied' | 'pending_approval';
  readonly executionId: string;
  readonly output?: string | undefined;
  readonly reason: string;
}

/**
 * Run a tool, subject to the permission engine.
 *
 * Every outcome writes a `tool_executions` row — allowed, refused, or failed.
 * A denial that left no trace would make the audit trail a record of successes
 * rather than of what was attempted.
 */
export async function executeTool(request: ExecuteRequest): Promise<ExecuteResult> {
  const [row] = await db
    .select({ tool: mcpTools, server: mcpServers })
    .from(mcpTools)
    .innerJoin(mcpServers, eq(mcpServers.id, mcpTools.mcpServerId))
    .where(
      and(eq(mcpTools.id, request.toolId), eq(mcpTools.workspaceId, request.workspaceId)),
    )
    .limit(1);

  if (!row) throw errors.notFound('Tool', request.toolId);

  /**
   * Approval state is read from the row, not recomputed here.
   *
   * `rediscoverTools` is what compares live definitions against the approved
   * hash, and it clears `toolSchemaApprovedAt` the moment they diverge. So a
   * set timestamp means "a human approved definitions that still match", and
   * this call does not need to re-probe the server to find that out — which
   * also keeps a slow or hostile server out of the execution path.
   */
  const schemaApproved = row.server.toolSchemaApprovedAt !== null;

  const decision = decidePermission({
    toolName: row.tool.name,
    toolId: row.tool.id,
    riskClass: row.tool.riskClass as RiskClass,
    enabled: row.tool.enabled,
    autoApproveReads: row.tool.autoApproveReads,
    schemaApproved,
    serverStatus: row.server.status,
    grantedToolIds: request.grantedToolIds,
  });

  const executionId = newId('toolExecution');

  const record = async (
    status: 'denied' | 'pending_approval' | 'succeeded' | 'failed',
    extra: Partial<typeof toolExecutions.$inferInsert> = {},
  ): Promise<void> => {
    await db.insert(toolExecutions).values({
      id: executionId,
      workspaceId: request.workspaceId,
      userId: request.userId,
      conversationId: request.conversationId ?? null,
      mcpToolId: row.tool.id,
      toolName: row.tool.name,
      riskClass: row.tool.riskClass,
      status,
      input: request.args,
      ...extra,
    });
  };

  if (decision.outcome === 'deny') {
    await record('denied', { deniedReason: decision.reason });
    return { status: 'denied', executionId, reason: decision.reason };
  }

  if (decision.outcome === 'needs_approval' && !request.approved) {
    await record('pending_approval');
    return { status: 'pending_approval', executionId, reason: decision.reason };
  }

  const started = Date.now();
  try {
    const { options } = await clientFor(row.server.id, request.workspaceId);
    const result = await callTool(options, row.tool.name, request.args);

    await record(result.isError ? 'failed' : 'succeeded', {
      output: result.text,
      durationMs: Date.now() - started,
      ...(request.approved ? { approvedBy: request.userId, approvedAt: new Date() } : {}),
      ...(result.isError ? { errorMessage: 'The tool reported an error.' } : {}),
    });

    await db
      .update(mcpTools)
      .set({ lastExecutedAt: new Date(), executionCount: row.tool.executionCount + 1 })
      .where(eq(mcpTools.id, row.tool.id));

    return {
      status: result.isError ? 'failed' : 'succeeded',
      executionId,
      output: result.text,
      reason: decision.reason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await record('failed', { errorMessage: message, durationMs: Date.now() - started });
    return { status: 'failed', executionId, reason: message };
  }
}

/** Recent tool activity, newest first. The audit trail spec §49 requires. */
export async function listExecutions(workspaceId: string, limit = 50) {
  return db
    .select({
      id: toolExecutions.id,
      toolName: toolExecutions.toolName,
      riskClass: toolExecutions.riskClass,
      status: toolExecutions.status,
      deniedReason: toolExecutions.deniedReason,
      errorMessage: toolExecutions.errorMessage,
      durationMs: toolExecutions.durationMs,
      createdAt: toolExecutions.createdAt,
    })
    .from(toolExecutions)
    .where(eq(toolExecutions.workspaceId, workspaceId))
    .orderBy(desc(toolExecutions.createdAt))
    .limit(limit);
}
