/**
 * Classifying what an MCP tool can do (spec §49).
 *
 * The risk class decides whether a call may run under standing authorization
 * or needs a human to approve it at call time. Getting this wrong in one
 * direction is an annoying prompt; getting it wrong in the other lets a model
 * delete a repository because a page it read told it to.
 *
 * So the rule everywhere below is: **when in doubt, classify higher.** A tool
 * whose purpose cannot be established is `update`, not `read_only`. Nothing is
 * treated as safe because its name merely failed to look dangerous.
 *
 * Servers may declare their own hints. Those are *untrusted input* — a server
 * that wants its `delete_everything` tool auto-approved would simply annotate
 * it read-only. A server's hint can therefore only ever raise the class Reklu
 * derived, never lower it.
 */

export type RiskClass =
  | 'read_only'
  | 'create'
  | 'update'
  | 'delete'
  | 'financial'
  | 'security_sensitive';

/** Ordered least to most dangerous, so "the higher of two" is well defined. */
const SEVERITY: Record<RiskClass, number> = {
  read_only: 0,
  create: 1,
  update: 2,
  delete: 3,
  financial: 4,
  security_sensitive: 5,
};

export function higherRisk(a: RiskClass, b: RiskClass): RiskClass {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/**
 * Word patterns, checked most dangerous first.
 *
 * Matched against the tool name and description together — a tool called
 * `run` whose description says "transfers funds" is financial regardless of
 * what it is called.
 */
const PATTERNS: ReadonlyArray<readonly [RiskClass, RegExp]> = [
  [
    'security_sensitive',
    /\b(password|passwd|credential|secret|token|api[\s_-]?key|private[\s_-]?key|ssh|permission|role|grant|revoke|acl|iam|auth|mfa|2fa|encrypt|decrypt|sudo|admin)\b/i,
  ],
  [
    'financial',
    /\b(payment|pay|charge|refund|invoice|billing|subscription|transfer|transaction|wire|purchase|checkout|order|price|wallet|crypto|withdraw|deposit|money|funds|currency)\b/i,
  ],
  [
    'delete',
    /\b(delete|destroy|remove|drop|purge|erase|wipe|truncate|revoke|terminate|uninstall|clear)\b/i,
  ],
  [
    'update',
    /\b(update|edit|modify|patch|write|set|change|move|rename|replace|merge|push|deploy|publish|send|post|email|message|notify|execute|run|invoke|call)\b/i,
  ],
  ['create', /\b(create|add|new|insert|upload|generate|make|register|clone|fork|copy)\b/i],
  [
    'read_only',
    /\b(get|list|read|fetch|search|find|query|lookup|show|view|describe|inspect|check|status|count|browse)\b/i,
  ],
];

export interface ToolShape {
  readonly name: string;
  readonly description?: string | undefined;
  /**
   * The server's own annotations. Advisory only — see the file comment.
   * MCP's spec defines `readOnlyHint` and `destructiveHint`.
   */
  readonly annotations?:
    | {
        readonly readOnlyHint?: boolean | undefined;
        readonly destructiveHint?: boolean | undefined;
      }
    | undefined;
}

/**
 * Reklu's own reading of a tool, before any server hint is considered.
 *
 * Returns `update` when nothing matches: an unrecognised tool is an unknown
 * tool, and unknown is not safe.
 */
export function deriveRiskClass(tool: ToolShape): RiskClass {
  /**
   * Separators become spaces before matching.
   *
   * `\b` does not fire across an underscore, because `_` is itself a word
   * character — so `\blist\b` never matched `list_files`, and every
   * snake_case tool fell through to the default. That is nearly every MCP
   * tool in existence. camelCase is split for the same reason.
   */
  const haystack = `${tool.name} ${tool.description ?? ''}`
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.:/]+/g, ' ');

  for (const [risk, pattern] of PATTERNS) {
    if (pattern.test(haystack)) return risk;
  }
  return 'update';
}

/**
 * The class Reklu will act on.
 *
 * A server may raise the risk — it knows its own tool best, and declaring
 * something destructive is an admission against interest. It may never lower
 * it, because that is exactly what a malicious server would do.
 */
export function classifyTool(tool: ToolShape): RiskClass {
  const derived = deriveRiskClass(tool);

  if (tool.annotations?.destructiveHint === true) {
    return higherRisk(derived, 'delete');
  }
  // readOnlyHint is deliberately NOT honoured downward. It is recorded for the
  // UI, and ignored for the decision.
  return derived;
}

/**
 * Whether a class may run without asking, when the user has enabled
 * auto-approval for reads.
 *
 * Only `read_only` ever qualifies. Everything else is a side effect on someone
 * else's system, and no amount of standing configuration makes that a thing to
 * do silently.
 */
export function mayAutoApprove(risk: RiskClass, autoApproveReads: boolean): boolean {
  return autoApproveReads && risk === 'read_only';
}

/** A short reason, shown to the user next to the tool. */
export function describeRisk(risk: RiskClass): string {
  switch (risk) {
    case 'read_only':
      return 'Reads data. Makes no changes.';
    case 'create':
      return 'Creates new data.';
    case 'update':
      return 'Changes existing data or sends something.';
    case 'delete':
      return 'Deletes data. This may not be reversible.';
    case 'financial':
      return 'Moves money or changes billing.';
    case 'security_sensitive':
      return 'Touches credentials, permissions or access.';
  }
}
