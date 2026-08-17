/**
 * Detecting silent changes to a server's tool definitions — "schema
 * poisoning" (spec §49).
 *
 * The attack: a user connects a benign MCP server and approves its tools. The
 * server later changes a tool's description to carry instructions, or widens
 * its parameters, and the model acts on the new definition. Nothing in the
 * connection looks different, and the user approved something that no longer
 * exists.
 *
 * The defence is to hash exactly what the user was shown, and re-prompt when
 * that hash changes. This is not about detecting malice in the content — it is
 * about never letting the approved definition and the live definition drift
 * apart without someone noticing.
 */
import { createHash } from 'node:crypto';

export interface HashableTool {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema?: unknown;
}

/**
 * Stable JSON: object keys sorted at every depth.
 *
 * Without this, a server reordering its keys would look like a change, users
 * would be re-prompted for nothing, and they would learn to click through the
 * prompt — which destroys the value of showing it at all.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

/**
 * A hash over every part of a tool the user's decision depended on.
 *
 * Description is included deliberately: it is what the model reads, so a
 * changed description is a changed tool even when the parameters are identical.
 */
export function hashTools(tools: readonly HashableTool[]): string {
  const normalised = [...tools]
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: canonical(tool.inputSchema ?? {}),
    }))
    // Server ordering is not part of the contract.
    .sort((a, b) => a.name.localeCompare(b.name));

  return createHash('sha256').update(JSON.stringify(normalised)).digest('hex');
}

export type SchemaVerdict = 'unchanged' | 'first_time' | 'changed';

export interface SchemaCheck {
  readonly verdict: SchemaVerdict;
  readonly hash: string;
  /** True when tools may run without a fresh approval. */
  readonly approved: boolean;
  readonly detail: string;
}

/**
 * Compare live tools against what was approved.
 *
 * A changed schema does not disable the server — it withdraws approval until a
 * human looks again. Silently continuing would defeat the check; silently
 * disconnecting would hide it.
 */
export function checkToolSchema(params: {
  liveTools: readonly HashableTool[];
  approvedHash: string | null | undefined;
  approvedAt: Date | null | undefined;
}): SchemaCheck {
  const hash = hashTools(params.liveTools);

  if (!params.approvedHash || !params.approvedAt) {
    return {
      verdict: 'first_time',
      hash,
      approved: false,
      detail: 'These tools have not been reviewed yet.',
    };
  }

  if (hash === params.approvedHash) {
    return { verdict: 'unchanged', hash, approved: true, detail: 'Tools match what you approved.' };
  }

  return {
    verdict: 'changed',
    hash,
    approved: false,
    detail:
      'This server changed its tool definitions since you approved them. ' +
      'Review the changes before using it again.',
  };
}

export interface ToolDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly string[];
}

/** What actually changed, so the re-approval prompt can be specific. */
export function diffTools(
  previous: readonly HashableTool[],
  next: readonly HashableTool[],
): ToolDiff {
  const before = new Map(previous.map((tool) => [tool.name, hashTools([tool])]));
  const after = new Map(next.map((tool) => [tool.name, hashTools([tool])]));

  const added = [...after.keys()].filter((name) => !before.has(name));
  const removed = [...before.keys()].filter((name) => !after.has(name));
  const modified = [...after.keys()].filter(
    (name) => before.has(name) && before.get(name) !== after.get(name),
  );

  return { added: added.sort(), removed: removed.sort(), modified: modified.sort() };
}
