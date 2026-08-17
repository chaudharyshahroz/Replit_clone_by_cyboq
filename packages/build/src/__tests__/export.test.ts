import { describe, expect, it } from 'vitest';
import {
  MAX_EXPORT_FILES,
  exportRejection,
  toDeploymentStatus,
} from '../export';

/**
 * Spec §137: no fake progress. A deployment is reported live only when the
 * provider says it is live — never inferred, never assumed from silence.
 */
describe('toDeploymentStatus', () => {
  it('reports ready only when the provider says READY', () => {
    expect(toDeploymentStatus('READY')).toBe('ready');
  });

  it.each(['QUEUED', 'BUILDING', 'INITIALIZING', 'UPLOADING'])(
    'treats %s as still deploying',
    (state) => {
      expect(toDeploymentStatus(state)).toBe('deploying');
    },
  );

  it.each(['ERROR', 'CANCELED', 'CANCELLED'])('treats %s as failed', (state) => {
    expect(toDeploymentStatus(state)).toBe('failed');
  });

  /**
   * The important one. A provider that invents a new state, or a typo in a
   * response, must never be optimistically read as "live" — an unknown state
   * is by definition not a confirmed one.
   */
  it.each(['', '  ', 'SOMETHING_NEW', 'read', 'undefined'])(
    'never reports an unrecognised state (%s) as ready',
    (state) => {
      expect(toDeploymentStatus(state)).not.toBe('ready');
    },
  );

  it('is case- and whitespace-insensitive for the states it knows', () => {
    expect(toDeploymentStatus(' ready ')).toBe('ready');
    expect(toDeploymentStatus('Error')).toBe('failed');
  });
});

describe('exportRejection', () => {
  it('accepts an ordinary generated tree', () => {
    expect(exportRejection(24, 180_000)).toBeUndefined();
  });

  it('refuses an empty build rather than creating an empty commit', () => {
    expect(exportRejection(0, 0)).toMatch(/no files yet/);
  });

  it('refuses a runaway file count', () => {
    expect(exportRejection(MAX_EXPORT_FILES + 1, 1_000)).toMatch(/above the .* file export limit/);
  });

  it('refuses a tree too large for one request', () => {
    expect(exportRejection(10, 21 * 1_048_576)).toMatch(/too large/);
  });

  it('allows exactly the limit', () => {
    expect(exportRejection(MAX_EXPORT_FILES, 1_000)).toBeUndefined();
  });
});

/**
 * Regression: extracting `toDeploymentStatus` introduced a `failed` state that
 * the message text did not account for, so a deployment Vercel rejected
 * outright would still have read "Vercel is building this deployment". The
 * three states must stay distinguishable in what the user is told.
 */
describe('status vocabulary stays exhaustive', () => {
  it('has a distinct outcome for every status the mapper can return', () => {
    const outcomes = new Set(
      ['READY', 'BUILDING', 'ERROR'].map((state) => toDeploymentStatus(state)),
    );
    expect(outcomes).toEqual(new Set(['ready', 'deploying', 'failed']));
  });
});
