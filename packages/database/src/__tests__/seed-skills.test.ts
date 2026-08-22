/**
 * The built-in skill library.
 *
 * Seeding upserts by handle, so a duplicate handle would silently make one
 * skill overwrite another on every deploy — the second would appear to save and
 * then vanish. Nothing else in the pipeline catches that.
 */
import { describe, expect, it } from 'vitest';
import { BUILT_IN_SKILLS } from '../seed/data';

describe('built-in skills', () => {
  it('has a unique handle for every skill', () => {
    const handles = BUILT_IN_SKILLS.map((skill) => skill.handle);
    expect(new Set(handles).size).toBe(handles.length);
  });

  /* The handle is an invocation token — `@mobile-engineer` — not a title. */
  it('uses handles that can actually be typed as a mention', () => {
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.handle, skill.handle).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('gives every skill instructions worth loading', () => {
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.instructions.length, skill.handle).toBeGreaterThan(200);
      expect(skill.description.length, skill.handle).toBeGreaterThan(20);
    }
  });

  /*
   * Building an application spans more than React. Without these, someone
   * asking for a mobile app or an API gets general-purpose advice.
   */
  it('covers the disciplines a build actually needs', () => {
    const handles = new Set(BUILT_IN_SKILLS.map((skill) => skill.handle));
    for (const needed of [
      'react-engineer',
      'mobile-engineer',
      'api-architect',
      'database-designer',
      'accessibility-auditor',
    ]) {
      expect(handles.has(needed), needed).toBe(true);
    }
  });

  /* An icon that is not a real name renders as nothing at all. */
  it('names an icon for every skill', () => {
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.icon, skill.handle).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('points every preferred model at a real Claude model id', () => {
    for (const skill of BUILT_IN_SKILLS) {
      if (skill.preferredModelKey === null) continue;
      expect(skill.preferredModelKey, skill.handle).toMatch(/^claude-/);
    }
  });
});
