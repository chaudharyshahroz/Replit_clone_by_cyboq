import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, idCreatedAt, isId, newId, parseId, slugify } from '../ids';

describe('newId', () => {
  it('uses the registered prefix for the kind', () => {
    expect(newId('project').startsWith('prj_')).toBe(true);
    expect(newId('conversation').startsWith('cnv_')).toBe(true);
    expect(newId('artifact').startsWith('art_')).toBe(true);
  });

  it('generates unique ids under tight loops', () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => newId('message')));
    expect(ids.size).toBe(20_000);
  });

  it('sorts lexicographically by creation time', async () => {
    const first = newId('message');
    await new Promise((r) => setTimeout(r, 5));
    const second = newId('message');
    expect(first < second).toBe(true);
  });

  // Only the random suffix uses the reduced alphabet; the time prefix is
  // base-32 and legitimately contains i/l/o/u.
  it('avoids look-alike characters in the random suffix', () => {
    for (let i = 0; i < 500; i++) {
      const suffix = newId('file').split('_')[1]!.slice(9);
      expect(suffix).toHaveLength(16);
      expect(suffix).not.toMatch(/[oilu]/);
    }
  });

  it('accepts ids whose time component contains base-32 letters', () => {
    // Exercises many wall-clock values, since the time prefix varies over time.
    for (let i = 0; i < 2000; i++) {
      const id = newId('workspace');
      expect(isId('workspace', id)).toBe(true);
    }
  });

  it('assigns a distinct prefix to every id kind', () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe('isId / parseId', () => {
  it('accepts a well-formed id of the right kind', () => {
    const id = newId('workspace');
    expect(isId('workspace', id)).toBe(true);
    expect(parseId('workspace', id)).toBe(id);
  });

  // The property that makes branded ids worth having: a valid id of the wrong
  // kind must not pass, or authorization checks can be crossed between tables.
  it('rejects a valid id belonging to a different kind', () => {
    const projectId = newId('project');
    expect(isId('conversation', projectId)).toBe(false);
    expect(parseId('conversation', projectId)).toBeUndefined();
  });

  it('rejects malformed and hostile input', () => {
    for (const bad of [
      '',
      'prj_',
      'prj_short',
      'prj_' + 'x'.repeat(200),
      '../../etc/passwd',
      "prj_'; DROP TABLE projects;--",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isId('project', bad)).toBe(false);
    }
  });
});

describe('idCreatedAt', () => {
  it('recovers approximately the creation time', () => {
    const before = Date.now();
    const at = idCreatedAt(newId('job'))!;
    expect(at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('returns undefined for a non-id', () => {
    expect(idCreatedAt('nonsense')).toBeUndefined();
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('My New Project')).toBe('my-new-project');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  it('collapses runs of separators and trims them', () => {
    expect(slugify('  --Hello???World--  ')).toBe('hello-world');
  });

  it('never returns an empty string', () => {
    expect(slugify('!!!')).toBe('untitled');
    expect(slugify('')).toBe('untitled');
  });

  it('respects the max length without a trailing hyphen', () => {
    const s = slugify('a'.repeat(50) + ' ' + 'b'.repeat(50), 51);
    expect(s.length).toBeLessThanOrEqual(51);
    expect(s.endsWith('-')).toBe(false);
  });
});
