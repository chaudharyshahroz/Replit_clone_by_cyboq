/**
 * Human approval of agent actions (spec §63).
 *
 * An agent proposes an action, a person consents, and then the action runs.
 * The gap between those last two is where this module lives, and the property
 * that matters is:
 *
 *   **What executes is exactly what was approved.**
 *
 * The schema comment calls it "no bait and switch". The risk is not
 * hypothetical: the payload is produced by a model, stored, shown to a human,
 * and executed later — four opportunities for it to differ from what the
 * person actually agreed to. So the approved payload is fingerprinted, and the
 * fingerprint is re-checked at execution.
 */
import { createHash } from 'node:crypto';
import type { RiskClass } from '@reklu/mcp';

/** Approvals expire rather than blocking a run forever. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface ProposedAction {
  /** Plain language, for a person deciding. Never a function name alone. */
  readonly action: string;
  readonly reason: string;
  readonly riskClass: RiskClass;
  /** Exactly what will run if approved. */
  readonly payload: Record<string, unknown>;
}

/**
 * Stable fingerprint of a payload.
 *
 * Keys are sorted at every depth so a re-serialisation with different ordering
 * is not mistaken for tampering — the same reasoning as the MCP tool-schema
 * hash. Without it, honest round-tripping would look like an attack and the
 * check would be turned off.
 */
export function fingerprint(payload: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

/**
 * Which actions a human must consent to.
 *
 * Read-only actions run freely; everything else asks. This is deliberately
 * stricter than the MCP engine's per-tool setting: an agent acts unattended
 * across many steps, so "the user enabled auto-approval for reads" is the only
 * standing consent that survives into an autonomous run.
 */
export function requiresApproval(riskClass: RiskClass): boolean {
  return riskClass !== 'read_only';
}

export type ApprovalOutcome =
  | 'approved'
  | 'denied'
  | 'pending'
  | 'expired'
  | 'payload_changed';

export interface ApprovalRecord {
  readonly status: string;
  readonly payload: unknown;
  readonly expiresAt: Date | null;
  readonly decidedAt: Date | null;
}

export interface ApprovalVerdict {
  readonly outcome: ApprovalOutcome;
  readonly mayExecute: boolean;
  readonly reason: string;
}

/**
 * Whether a recorded approval authorises this specific payload, now.
 *
 * Every failure mode is distinguished, because they need different responses:
 * expired means ask again, denied means stop, and a changed payload means
 * something is wrong enough that the run should not continue quietly.
 */
export function checkApproval(params: {
  record: ApprovalRecord | undefined;
  payload: Record<string, unknown>;
  now?: Date;
}): ApprovalVerdict {
  const { record } = params;
  const now = params.now ?? new Date();

  if (!record) {
    return {
      outcome: 'pending',
      mayExecute: false,
      reason: 'This action has not been approved yet.',
    };
  }

  if (record.status === 'denied') {
    return { outcome: 'denied', mayExecute: false, reason: 'This action was denied.' };
  }

  if (record.status !== 'approved') {
    return {
      outcome: 'pending',
      mayExecute: false,
      reason: 'This action is waiting for approval.',
    };
  }

  // Checked even for an approved record: consent given yesterday for an action
  // running today is consent to something the person no longer has in mind.
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
    return {
      outcome: 'expired',
      mayExecute: false,
      reason: 'This approval expired. Approve it again to continue.',
    };
  }

  /**
   * The bait-and-switch check. A payload that changed after approval was not
   * approved, whatever the row says.
   */
  if (fingerprint(record.payload) !== fingerprint(params.payload)) {
    return {
      outcome: 'payload_changed',
      mayExecute: false,
      reason:
        'This action changed after it was approved, so it will not run. ' +
        'Review and approve the new version.',
    };
  }

  return { outcome: 'approved', mayExecute: true, reason: 'Approved.' };
}

/**
 * A summary a person can decide on without reading JSON.
 *
 * An approval prompt that shows a payload blob teaches people to click
 * approve, which is worse than no prompt at all.
 */
export function describeAction(action: ProposedAction): string {
  const detail = Object.entries(action.payload)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 6)
    .map(([key, value]) => {
      const rendered =
        typeof value === 'string'
          ? value.length > 120
            ? `${value.slice(0, 120)}…`
            : value
          : JSON.stringify(value).slice(0, 120);
      return `${key}: ${rendered}`;
    });

  return detail.length > 0 ? `${action.action}\n${detail.join('\n')}` : action.action;
}
