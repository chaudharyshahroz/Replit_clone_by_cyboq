/**
 * Read models for the Connections UI.
 *
 * Kept separate from `servers.ts` so the screens depend on shapes chosen for
 * display rather than on the tables. Nothing here returns credential material
 * of any kind.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, mcpServers, mcpTools } from '@reklu/database';
import type { RiskClass } from './risk';

export interface McpServerSummary {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string | null;
  readonly status: string;
  readonly statusDetail: string | null;
  readonly toolCount: number;
  readonly enabledCount: number;
  /** True when a human has approved the current definitions. */
  readonly schemaApproved: boolean;
  readonly lastDiscoveredAt: Date | null;
  readonly hasCredential: boolean;
}

export async function listServers(workspaceId: string): Promise<McpServerSummary[]> {
  const servers = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.workspaceId, workspaceId))
    .orderBy(desc(mcpServers.createdAt));

  const tools = await db
    .select({
      mcpServerId: mcpTools.mcpServerId,
      enabled: mcpTools.enabled,
    })
    .from(mcpTools)
    .where(eq(mcpTools.workspaceId, workspaceId));

  return servers.map((server) => {
    const own = tools.filter((tool) => tool.mcpServerId === server.id);
    return {
      id: server.id,
      name: server.name,
      endpoint: server.endpoint,
      status: server.status,
      statusDetail: server.statusDetail,
      toolCount: own.length,
      enabledCount: own.filter((tool) => tool.enabled).length,
      schemaApproved: server.toolSchemaApprovedAt !== null,
      lastDiscoveredAt: server.lastDiscoveredAt,
      // Whether one exists — never the value.
      hasCredential: server.credentialEncrypted !== null,
    };
  });
}

export interface McpToolSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly riskClass: RiskClass;
  readonly enabled: boolean;
  readonly autoApproveReads: boolean;
  readonly executionCount: number;
  readonly lastExecutedAt: Date | null;
}

export interface McpServerDetail extends McpServerSummary {
  readonly tools: readonly McpToolSummary[];
}

export async function getServer(
  serverId: string,
  workspaceId: string,
): Promise<McpServerDetail | undefined> {
  const [server] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
    .limit(1);

  if (!server) return undefined;

  const tools = await db
    .select()
    .from(mcpTools)
    .where(eq(mcpTools.mcpServerId, serverId))
    .orderBy(asc(mcpTools.name));

  return {
    id: server.id,
    name: server.name,
    endpoint: server.endpoint,
    status: server.status,
    statusDetail: server.statusDetail,
    toolCount: tools.length,
    enabledCount: tools.filter((tool) => tool.enabled).length,
    schemaApproved: server.toolSchemaApprovedAt !== null,
    lastDiscoveredAt: server.lastDiscoveredAt,
    hasCredential: server.credentialEncrypted !== null,
    tools: tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      riskClass: tool.riskClass as RiskClass,
      enabled: tool.enabled,
      autoApproveReads: tool.autoApproveReads,
      executionCount: tool.executionCount,
      lastExecutedAt: tool.lastExecutedAt,
    })),
  };
}

/** Tools the model may be offered: enabled, on an approved, healthy server. */
export async function usableTools(workspaceId: string): Promise<
  Array<{ id: string; name: string; description: string | null; riskClass: RiskClass; serverId: string }>
> {
  const rows = await db
    .select({
      id: mcpTools.id,
      name: mcpTools.name,
      description: mcpTools.description,
      riskClass: mcpTools.riskClass,
      serverId: mcpServers.id,
      approvedAt: mcpServers.toolSchemaApprovedAt,
      status: mcpServers.status,
    })
    .from(mcpTools)
    .innerJoin(mcpServers, eq(mcpServers.id, mcpTools.mcpServerId))
    .where(and(eq(mcpTools.workspaceId, workspaceId), eq(mcpTools.enabled, true)));

  // The permission engine checks these again at call time. Filtering here is
  // about not offering the model something it will only be refused.
  return rows
    .filter((row) => row.approvedAt !== null && row.status === 'connected')
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      riskClass: row.riskClass as RiskClass,
      serverId: row.serverId,
    }));
}

export async function deleteServer(serverId: string, workspaceId: string): Promise<void> {
  // Tools cascade; executions keep their denormalised toolName so the audit
  // trail survives a server being removed.
  await db
    .delete(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)));
}
