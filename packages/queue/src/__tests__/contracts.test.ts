import { describe, expect, it } from 'vitest';
import {
  JOB_KINDS,
  parsePayload,
  QUEUE_NAMES,
  queueFor,
  stagesFor,
  type JobKind,
} from '../contracts';

const KINDS = Object.keys(JOB_KINDS) as JobKind[];

describe('job contracts', () => {
  it('routes every kind to a declared queue', () => {
    for (const kind of KINDS) {
      expect(QUEUE_NAMES).toContain(queueFor(kind));
    }
  });

  it('declares at least one real stage per kind', () => {
    for (const kind of KINDS) {
      expect(stagesFor(kind).length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate stages within a kind', () => {
    for (const kind of KINDS) {
      const stages = stagesFor(kind);
      expect(new Set(stages).size).toBe(stages.length);
    }
  });

  it('mirrors the research pipeline in docs/RESEARCH_ARCHITECTURE.md', () => {
    const stages = stagesFor('deep_research');
    expect(stages[0]).toBe('analyzing_intent');
    expect(stages).toContain('cross_validating');
    expect(stages.at(-1)).toBe('writing_report');
  });
});

describe('parsePayload', () => {
  it('binds design work to a workspace, user and exact version', () => {
    const payload = {
      buildProjectId: 'bld_1',
      workspaceId: 'wsp_1',
      userId: 'usr_1',
      versionId: 'ver_1',
    };
    expect(parsePayload('build_design', payload)).toEqual(payload);
    for (const key of Object.keys(payload)) {
      expect(() => parsePayload('build_design', { ...payload, [key]: '' })).toThrow();
    }
    expect(queueFor('build_design')).toBe('build');
    expect(stagesFor('build_design')).toContain('reviewing_design');
  });
  it('accepts a valid payload', () => {
    const payload = parsePayload('embed_file', {
      fileId: 'fil_1',
      workspaceId: 'wsp_1',
      jobId: 'job_1', // extra keys are tolerated
    });
    expect(payload.fileId).toBe('fil_1');
  });

  // Validating at the worker boundary is what stops a malformed enqueue from
  // becoming a confusing crash deep inside a handler.
  it('rejects a payload missing a required field', () => {
    expect(() => parsePayload('embed_file', { workspaceId: 'wsp_1' })).toThrow();
  });

  it('rejects a payload of the wrong shape entirely', () => {
    expect(() => parsePayload('deep_research', { nonsense: true })).toThrow();
  });

  it('rejects an invalid enum value', () => {
    expect(() =>
      parsePayload('deep_research', {
        researchSessionId: 'rsh_1',
        workspaceId: 'wsp_1',
        userId: 'usr_1',
        query: 'x',
        mode: 'exhaustive',
      }),
    ).toThrow();
  });

  it('accepts every declared mode for research', () => {
    for (const mode of ['quick', 'research', 'deep'] as const) {
      expect(() =>
        parsePayload('deep_research', {
          researchSessionId: 'rsh_1',
          workspaceId: 'wsp_1',
          userId: 'usr_1',
          query: 'x',
          mode,
        }),
      ).not.toThrow();
    }
  });

  it('rejects an empty research query', () => {
    expect(() =>
      parsePayload('deep_research', {
        researchSessionId: 'rsh_1',
        workspaceId: 'wsp_1',
        userId: 'usr_1',
        query: '',
        mode: 'deep',
      }),
    ).toThrow();
  });
});
