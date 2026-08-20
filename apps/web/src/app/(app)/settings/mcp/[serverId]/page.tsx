import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { describeRisk, getServer } from '@reklu/mcp';
import { getAppContext } from '@/lib/auth-context';
import { ServerToolPanel } from '@/components/mcp/server-tool-panel';

export const metadata: Metadata = { title: 'MCP server' };
export const dynamic = 'force-dynamic';

export default async function McpServerPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const { workspace } = await getAppContext();

  const server = await getServer(serverId, workspace.workspaceId);
  if (!server) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <Link
        href="/settings/mcp"
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        MCP servers
      </Link>

      <header className="mt-4">
        <h1 className="display text-2xl text-text">{server.name}</h1>
        <p className="mt-1.5 truncate font-mono text-[0.6875rem] text-text-muted">{server.endpoint}</p>
      </header>

      <ServerToolPanel
        server={{
          id: server.id,
          status: server.status,
          statusDetail: server.statusDetail,
          schemaApproved: server.schemaApproved,
          enabledCount: server.enabledCount,
          toolCount: server.toolCount,
          lastDiscoveredAt: server.lastDiscoveredAt?.toISOString() ?? null,
        }}
        tools={server.tools.map((tool) => ({
          id: tool.id,
          name: tool.name,
          description: tool.description,
          riskClass: tool.riskClass,
          // Formatted server-side so the client never imports the package.
          riskDescription: describeRisk(tool.riskClass),
          enabled: tool.enabled,
          autoApproveReads: tool.autoApproveReads,
          executionCount: tool.executionCount,
        }))}
      />
    </div>
  );
}
