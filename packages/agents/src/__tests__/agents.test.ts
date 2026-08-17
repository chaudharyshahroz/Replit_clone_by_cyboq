import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  USD,
  checkBudget,
  clampCost,
  clampSteps,
  formatBudget,
  parseBudget,
} from '../budget';
import {
  APPROVAL_TTL_MS,
  checkApproval,
  describeAction,
  fingerprint,
  requiresApproval,
} from '../approvals';
import { MAX_PLAN_STEPS, parsePlan } from '../plan';

describe('parseBudget', () => {
  it.each([
    ['5.00', 5 * USD],
    ['0.50', USD / 2],
    ['12', 12 * USD],
  ])('parses %s', (input, expected) => {
    expect(parseBudget(input)).toBe(expected);
  });

  /** 0.1 is slightly under in binary floating point; truncation would lose a cent. */
  it('rounds rather than truncating', () => {
    expect(parseBudget('0.10')).toBe(100_000);
    expect(parseBudget('0.07')).toBe(70_000);
  });

  it.each([undefined, null, '', 'abc', '-5'])('treats %s as zero', (input) => {
    expect(parseBudget(input as string)).toBe(0);
  });

  it('round-trips through formatBudget', () => {
    expect(formatBudget(parseBudget('5.00'))).toBe('$5.00');
  });
});

describe('checkBudget', () => {
  const state = {
    maxSteps: 10,
    stepsExecuted: 0,
    maxCostMicroUsd: 5 * USD,
    spentMicroUsd: 0,
  };

  it('allows a fresh run', () => {
    const check = checkBudget(state);
    expect(check.allowed).toBe(true);
    expect(check.stepsRemaining).toBe(10);
  });

  /**
   * `stepsExecuted` counts completed steps, so reaching the limit means done.
   * Using `>` here would silently grant one extra step every run.
   */
  it('stops exactly at the step limit, not one past it', () => {
    expect(checkBudget({ ...state, stepsExecuted: 9 }).allowed).toBe(true);
    expect(checkBudget({ ...state, stepsExecuted: 10 }).allowed).toBe(false);
    expect(checkBudget({ ...state, stepsExecuted: 10 }).verdict).toBe('step_limit');
  });

  it('stops exactly at the cost limit', () => {
    expect(checkBudget({ ...state, spentMicroUsd: 5 * USD - 1 }).allowed).toBe(true);
    expect(checkBudget({ ...state, spentMicroUsd: 5 * USD }).allowed).toBe(false);
    expect(checkBudget({ ...state, spentMicroUsd: 5 * USD }).verdict).toBe('cost_limit');
  });

  it('reports the step limit first when both are exhausted', () => {
    const check = checkBudget({ ...state, stepsExecuted: 10, spentMicroUsd: 5 * USD });
    expect(check.verdict).toBe('step_limit');
  });

  it('never reports negative remaining', () => {
    const check = checkBudget({ ...state, stepsExecuted: 99, spentMicroUsd: 99 * USD });
    expect(check.stepsRemaining).toBe(0);
    expect(check.costRemainingMicroUsd).toBe(0);
  });

  it('always explains itself', () => {
    expect(checkBudget({ ...state, stepsExecuted: 10 }).reason).toMatch(/limit of 10 steps/);
    expect(checkBudget({ ...state, spentMicroUsd: 5 * USD }).reason).toMatch(/\$5\.00/);
  });
});

describe('clamping', () => {
  // Clamped, not rejected: someone typing 10000 wants "a lot", and failing
  // their request to teach them the maximum helps nobody.
  it('caps steps at the ceiling', () => {
    expect(clampSteps(10_000)).toBe(LIMITS.maxStepsCeiling);
  });

  it('caps cost at the ceiling', () => {
    expect(clampCost(1_000 * USD)).toBe(LIMITS.maxCostCeilingMicroUsd);
  });

  it('never allows a run of zero steps', () => {
    expect(clampSteps(0)).toBe(1);
    expect(clampSteps(-5)).toBe(1);
  });

  it.each([undefined, NaN, Infinity])('falls back to the default for %s', (value) => {
    expect(clampSteps(value as number)).toBe(LIMITS.defaultSteps);
    expect(clampCost(value as number)).toBe(LIMITS.defaultCostMicroUsd);
  });
});

describe('requiresApproval', () => {
  it('lets read-only actions run unattended', () => {
    expect(requiresApproval('read_only')).toBe(false);
  });

  /**
   * Stricter than the per-tool MCP setting on purpose: an agent acts across
   * many steps without a person watching, so nothing with a side effect runs
   * on standing consent.
   */
  it.each(['create', 'update', 'delete', 'financial', 'security_sensitive'] as const)(
    'requires approval for %s',
    (risk) => {
      expect(requiresApproval(risk)).toBe(true);
    },
  );
});

describe('fingerprint', () => {
  it('is stable', () => {
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }));
  });

  // Honest re-serialisation must not look like tampering, or the check gets
  // disabled for being noisy.
  it('ignores key order at every depth', () => {
    expect(fingerprint({ a: 1, b: { x: 1, y: 2 } })).toBe(
      fingerprint({ b: { y: 2, x: 1 }, a: 1 }),
    );
  });

  it('changes when a value changes', () => {
    expect(fingerprint({ to: 'a@b.com' })).not.toBe(fingerprint({ to: 'evil@x.com' }));
  });

  it('changes when a field is added', () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 1, bcc: 'x' }));
  });

  // Array order is meaningful — recipients are not a set.
  it('respects array order', () => {
    expect(fingerprint({ to: ['a', 'b'] })).not.toBe(fingerprint({ to: ['b', 'a'] }));
  });
});

describe('checkApproval', () => {
  const payload = { to: 'someone@example.com', subject: 'Hello' };
  const approved = {
    status: 'approved',
    payload,
    expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    decidedAt: new Date(),
  };

  it('permits an approved, unexpired, unchanged action', () => {
    const verdict = checkApproval({ record: approved, payload });
    expect(verdict.outcome).toBe('approved');
    expect(verdict.mayExecute).toBe(true);
  });

  it('refuses when there is no approval at all', () => {
    expect(checkApproval({ record: undefined, payload }).mayExecute).toBe(false);
  });

  it('refuses a denied action', () => {
    const verdict = checkApproval({ record: { ...approved, status: 'denied' }, payload });
    expect(verdict.outcome).toBe('denied');
  });

  it('refuses one still pending', () => {
    const verdict = checkApproval({ record: { ...approved, status: 'pending' }, payload });
    expect(verdict.outcome).toBe('pending');
  });

  /**
   * Consent given yesterday for an action running today is consent to
   * something the person no longer has in mind.
   */
  it('refuses an expired approval', () => {
    const verdict = checkApproval({
      record: { ...approved, expiresAt: new Date(Date.now() - 1000) },
      payload,
    });
    expect(verdict.outcome).toBe('expired');
    expect(verdict.reason).toMatch(/expired/i);
  });

  /**
   * The property this module exists for. A payload that changed after approval
   * was not approved, whatever the row says.
   */
  it('refuses when the payload changed after approval', () => {
    const verdict = checkApproval({
      record: approved,
      payload: { ...payload, to: 'attacker@evil.test' },
    });
    expect(verdict.outcome).toBe('payload_changed');
    expect(verdict.mayExecute).toBe(false);
  });

  it('refuses when a field was added after approval', () => {
    const verdict = checkApproval({
      record: approved,
      payload: { ...payload, bcc: 'attacker@evil.test' },
    });
    expect(verdict.outcome).toBe('payload_changed');
  });

  // Reordering during a JSON round trip is not tampering.
  it('permits the same payload with reordered keys', () => {
    const verdict = checkApproval({
      record: approved,
      payload: { subject: 'Hello', to: 'someone@example.com' },
    });
    expect(verdict.mayExecute).toBe(true);
  });

  it('distinguishes every failure mode, since each needs a different response', () => {
    const outcomes = new Set([
      checkApproval({ record: undefined, payload }).outcome,
      checkApproval({ record: { ...approved, status: 'denied' }, payload }).outcome,
      checkApproval({ record: { ...approved, expiresAt: new Date(0) }, payload }).outcome,
      checkApproval({ record: approved, payload: { to: 'x' } }).outcome,
    ]);
    expect(outcomes).toEqual(new Set(['pending', 'denied', 'expired', 'payload_changed']));
  });
});

describe('describeAction', () => {
  /**
   * An approval prompt showing a JSON blob teaches people to click approve,
   * which is worse than no prompt.
   */
  it('renders a readable summary rather than JSON', () => {
    const summary = describeAction({
      action: 'Send an email to the finance team',
      reason: 'sends email on your behalf',
      riskClass: 'update',
      payload: { to: 'finance@example.com', subject: 'Q3 numbers' },
    });

    expect(summary).toContain('Send an email to the finance team');
    expect(summary).toContain('to: finance@example.com');
    expect(summary).not.toContain('{');
  });

  it('truncates long values rather than filling the screen', () => {
    const summary = describeAction({
      action: 'Post',
      reason: 'r',
      riskClass: 'update',
      payload: { body: 'x'.repeat(500) },
    });
    expect(summary).toContain('…');
    expect(summary.length).toBeLessThan(300);
  });

  it('omits empty fields', () => {
    const summary = describeAction({
      action: 'Do',
      reason: 'r',
      riskClass: 'update',
      payload: { a: 'kept', b: '', c: null },
    });
    expect(summary).toContain('a: kept');
    expect(summary).not.toContain('b:');
  });
});

describe('parsePlan', () => {
  const valid = {
    objective: 'Research competitors',
    steps: [
      { title: 'Search the web', kind: 'research' },
      { title: 'Summarise findings', kind: 'model' },
    ],
  };

  it('parses a well-formed plan', () => {
    const plan = parsePlan(JSON.stringify(valid), 'fallback')!;
    expect(plan.objective).toBe('Research competitors');
    expect(plan.steps).toHaveLength(2);
  });

  it('recovers from a fenced reply', () => {
    expect(parsePlan(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, 'f')?.steps).toHaveLength(2);
  });

  it.each([
    ['name', { name: 'A step' }],
    ['step', { step: 'A step' }],
    ['action', { action: 'A step' }],
  ])('accepts %s as the title', (_label, step) => {
    expect(parsePlan(JSON.stringify({ steps: [step] }), 'f')?.steps[0]?.title).toBe('A step');
  });

  it('accepts `plan` instead of `steps`', () => {
    expect(parsePlan(JSON.stringify({ plan: [{ title: 'A' }] }), 'f')?.steps).toHaveLength(1);
  });

  /** A step naming a tool is a tool step whatever it called itself. */
  it('infers a tool step from a tool name', () => {
    const plan = parsePlan(JSON.stringify({ steps: [{ title: 'A', tool: 'list_files' }] }), 'f');
    expect(plan?.steps[0]?.kind).toBe('tool');
    expect(plan?.steps[0]?.toolName).toBe('list_files');
  });

  /** Least privileged default: a model step calls nothing external. */
  it('defaults an unknown kind to model', () => {
    const plan = parsePlan(JSON.stringify({ steps: [{ title: 'A', kind: 'quantum' }] }), 'f');
    expect(plan?.steps[0]?.kind).toBe('model');
  });

  it('drops steps with no title', () => {
    const plan = parsePlan(JSON.stringify({ steps: [{ title: 'Real' }, {}, { kind: 'model' }] }), 'f');
    expect(plan?.steps).toHaveLength(1);
  });

  it('caps the plan length', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ title: `S${i}` }));
    expect(parsePlan(JSON.stringify({ steps: many }), 'f')?.steps).toHaveLength(MAX_PLAN_STEPS);
  });

  it('falls back to the given objective when the model omits one', () => {
    expect(parsePlan(JSON.stringify({ steps: [{ title: 'A' }] }), 'My goal')?.objective).toBe(
      'My goal',
    );
  });

  // A run with nothing to do is a failure worth reporting.
  it.each([
    ['no steps key', '{"objective":"x"}'],
    ['empty steps', '{"steps":[]}'],
    ['only untitled steps', '{"steps":[{},{}]}'],
    ['not JSON', 'I cannot plan that.'],
  ])('returns undefined for %s', (_label, raw) => {
    expect(parsePlan(raw, 'f')).toBeUndefined();
  });
});
