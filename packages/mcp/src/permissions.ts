/**
 * The permission engine (spec §49).
 *
 * One function decides whether a tool call proceeds, and it is deliberately
 * the only place that decision is made. Every gate is expressed as a reason
 * for refusal, so adding a gate cannot accidentally widen access — a new rule
 * can only ever add another way to say no.
 */
import { mayAutoApprove, type RiskClass } from './risk';

export type PermissionOutcome = 'allow' | 'needs_approval' | 'deny';

export interface PermissionRequest {
  readonly toolName: string;
  readonly riskClass: RiskClass;
  /** Tools are discovered disabled and enabled deliberately. */
  readonly enabled: boolean;
  /** Whether read-only calls may run without a per-call prompt. */
  readonly autoApproveReads: boolean;
  /** False when the server's tool definitions changed since approval. */
  readonly schemaApproved: boolean;
  /** The server's own state — a server in error must not be called. */
  readonly serverStatus: 'connected' | 'needs_attention' | 'disconnected' | 'error';
  /**
   * Tool ids the invoking context is allowed to reach. A skill may request
   * tools; the installer grants them. Undefined means an unrestricted context
   * such as a user acting directly.
   */
  readonly grantedToolIds?: readonly string[] | undefined;
  readonly toolId: string;
}

export interface PermissionDecision {
  readonly outcome: PermissionOutcome;
  /** Shown to the user. Always states the actual reason. */
  readonly reason: string;
}

export function decidePermission(request: PermissionRequest): PermissionDecision {
  // ---- Hard denials: nothing the user can approve at call time -----------
  if (request.serverStatus === 'disconnected' || request.serverStatus === 'error') {
    return {
      outcome: 'deny',
      reason: `The server for "${request.toolName}" is ${request.serverStatus}. Reconnect it in Settings.`,
    };
  }

  if (!request.enabled) {
    // Discovered-but-disabled is the default, so this is the common case for a
    // tool the user has simply never turned on.
    return {
      outcome: 'deny',
      reason: `"${request.toolName}" is not enabled. Enable it in Settings → Connections to use it.`,
    };
  }

  /**
   * A skill that requested a tool it was not granted must not reach it. The
   * grant is the installer's decision, not the skill author's.
   */
  if (request.grantedToolIds && !request.grantedToolIds.includes(request.toolId)) {
    return {
      outcome: 'deny',
      reason: `"${request.toolName}" was not granted to this skill.`,
    };
  }

  /**
   * A changed schema means the approved definition and the live one have
   * drifted. Refusing here is what makes the schema check meaningful.
   */
  if (!request.schemaApproved) {
    return {
      outcome: 'deny',
      reason:
        `The server providing "${request.toolName}" changed its tool definitions. ` +
        'Review and approve them before using it again.',
    };
  }

  /**
   * A server needing attention — an expired token, a revoked scope — is a
   * state the user should be told about, not one Reklu quietly proceeds
   * through. This is checked BEFORE standing authorization on purpose:
   * auto-approval is a convenience for a connection known to be healthy, and
   * this one is not.
   */
  if (request.serverStatus === 'needs_attention') {
    return {
      outcome: 'needs_approval',
      reason: `This server needs attention. Confirm you still want to run "${request.toolName}".`,
    };
  }

  // ---- Standing authorization -------------------------------------------
  if (mayAutoApprove(request.riskClass, request.autoApproveReads)) {
    return { outcome: 'allow', reason: 'Read-only tool, auto-approved for reads.' };
  }

  // ---- Everything else asks ---------------------------------------------

  return {
    outcome: 'needs_approval',
    reason: `"${request.toolName}" makes changes. Approve this call to continue.`,
  };
}

/** Whether an outcome permits execution right now. */
export function isPermitted(decision: PermissionDecision): boolean {
  return decision.outcome === 'allow';
}
