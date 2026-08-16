import { describe, expect, it } from 'vitest';
import { briefToContext, fallbackBrief, parseBrief, stackFor } from '../brief';
import { mergeTree } from '../generate';

const valid = {
  product: 'AI Fitness Coach',
  summary: 'A coaching app that plans workouts and tracks progress.',
  target: 'mobile_app',
  platforms: ['ios', 'android'],
  userRoles: ['Athlete', 'Coach'],
  coreFeatures: ['Workout plans', 'Progress tracking', 'Subscriptions'],
  pages: [{ name: 'Home', purpose: 'Today’s workout' }],
  dataModel: [{ entity: 'Workout', fields: ['id', 'name', 'exercises'] }],
  stack: ['Expo', 'React Native'],
  integrations: ['Stripe'],
  needsAuth: true,
  needsDatabase: true,
  outOfScope: ['Nutrition tracking'],
};

describe('parseBrief', () => {
  it('parses a well-formed brief', () => {
    const brief = parseBrief(JSON.stringify(valid));
    expect(brief?.product).toBe('AI Fitness Coach');
    expect(brief?.platforms).toEqual(['ios', 'android']);
  });

  it('unwraps a fenced response', () => {
    expect(parseBrief('```json\n' + JSON.stringify(valid) + '\n```')?.target).toBe('mobile_app');
  });

  it('tolerates prose around the object', () => {
    expect(parseBrief(`Here is the brief:\n${JSON.stringify(valid)}\nHope that helps.`)).toBeDefined();
  });

  it('applies defaults for omitted optional fields', () => {
    const brief = parseBrief(
      JSON.stringify({ product: 'X', summary: 'Y', target: 'website' }),
    );
    expect(brief?.pages).toEqual([]);
    expect(brief?.needsAuth).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['prose only', 'I need more detail before I can plan this.'],
    ['broken json', '{"product":'],
    ['wrong target', JSON.stringify({ ...valid, target: 'spaceship' })],
    ['missing product', JSON.stringify({ summary: 'x', target: 'website' })],
  ])('returns undefined for %s', (_label, raw) => {
    expect(() => parseBrief(raw)).not.toThrow();
    expect(parseBrief(raw)).toBeUndefined();
  });
});

describe('fallbackBrief', () => {
  // A malformed brief must not abort the build.
  it.each([
    ['iOS app for tracking habits', 'mobile_app'],
    ['an admin dashboard for orders', 'dashboard'],
    ['a REST api for payments', 'api'],
    ['a landing page for my startup', 'website'],
    ['a tool for managing customers', 'web_app'],
  ])('infers a target from %s', (prompt, expected) => {
    expect(fallbackBrief(prompt).target).toBe(expected);
  });

  it('targets both stores for mobile', () => {
    expect(fallbackBrief('an android app').platforms).toEqual(['ios', 'android']);
  });

  // A marketing site genuinely does not need these.
  it('does not add auth or a database to a marketing site', () => {
    const brief = fallbackBrief('a landing page for my startup');
    expect(brief.needsAuth).toBe(false);
    expect(brief.needsDatabase).toBe(false);
  });

  it('assumes auth and persistence for an application', () => {
    const brief = fallbackBrief('a tool for managing customers');
    expect(brief.needsAuth).toBe(true);
    expect(brief.needsDatabase).toBe(true);
  });
});

describe('stackFor', () => {
  // Spec §37: one codebase targeting both stores.
  it('uses Expo/React Native for mobile', () => {
    expect(stackFor('mobile_app')).toContain('Expo');
    expect(stackFor('mobile_app')).toContain('React Native');
  });

  it('uses Next.js for web targets', () => {
    expect(stackFor('website')).toContain('Next.js');
    expect(stackFor('dashboard')).toContain('Next.js');
  });
});

describe('briefToContext', () => {
  it('renders the brief for the generation prompt', () => {
    const context = briefToContext(parseBrief(JSON.stringify(valid))!);
    expect(context).toContain('AI Fitness Coach');
    expect(context).toContain('ios, android');
    expect(context).toContain('Workout plans');
    expect(context).toContain('Workout(id, name, exercises)');
    expect(context).toContain('Requires authentication');
  });

  it('omits sections that are empty', () => {
    const context = briefToContext(fallbackBrief('a landing page'));
    expect(context).not.toContain('Features:');
    expect(context).not.toContain('Requires a database');
  });
});

describe('mergeTree', () => {
  const file = (path: string, content: string) => ({ path, content, language: 'ts' });

  /**
   * The property that protects a user's work: an edit emitting three files must
   * not delete the other forty.
   */
  it('keeps existing files an edit did not mention', () => {
    const merged = mergeTree(
      [file('a.ts', '1'), file('b.ts', '2'), file('c.ts', '3')],
      [file('b.ts', 'updated')],
    );
    expect(merged.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(merged.find((f) => f.path === 'b.ts')!.content).toBe('updated');
  });

  it('adds new files', () => {
    const merged = mergeTree([file('a.ts', '1')], [file('new.ts', '2')]);
    expect(merged).toHaveLength(2);
  });

  it('sorts deterministically', () => {
    const merged = mergeTree([], [file('z.ts', '1'), file('a.ts', '2')]);
    expect(merged.map((f) => f.path)).toEqual(['a.ts', 'z.ts']);
  });

  it('handles an empty generation without losing the tree', () => {
    expect(mergeTree([file('a.ts', '1')], [])).toHaveLength(1);
  });
});
