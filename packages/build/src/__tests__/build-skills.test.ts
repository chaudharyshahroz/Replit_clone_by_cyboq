/**
 * What the generator is told about the kind of thing it is building.
 *
 * Before this every build got the same generic prompt — a marketing site and an
 * iOS app were asked for the same things. These tests pin that each target
 * actually receives guidance specific to the stack it will be generated on, and
 * that the guidance stays in the system prompt where a request cannot argue
 * with it.
 */
import { describe, expect, it } from 'vitest';
import { BUILD_SKILLS, CORE_ENGINEERING, skillGuidanceFor, skillsFor } from '../build-skills';
import { stackFor } from '../brief';
import type { BuildTarget } from '../brief';

const TARGETS: readonly BuildTarget[] = [
  'website',
  'web_app',
  'mobile_app',
  'api',
  'dashboard',
];

describe('coverage', () => {
  it('has guidance for every target a brief can choose', () => {
    for (const target of TARGETS) {
      expect(BUILD_SKILLS[target], target).toBeDefined();
      expect(BUILD_SKILLS[target].guidance.length).toBeGreaterThan(3);
    }
  });

  it('applies the engineering standards to every target', () => {
    for (const target of TARGETS) {
      expect(skillsFor(target)).toContain(CORE_ENGINEERING);
    }
  });

  it('gives each target something the others do not say', () => {
    const texts = TARGETS.map((target) => BUILD_SKILLS[target].guidance.join('\n'));
    expect(new Set(texts).size).toBe(TARGETS.length);
  });
});

describe('the guidance a build receives', () => {
  /*
   * The mobile guidance has to match the stack `stackFor` picks, or it advises
   * the model about a framework it is not using.
   */
  it('matches the stack the brief will actually choose for mobile', () => {
    const stack = stackFor('mobile_app').join(' ').toLowerCase();
    const guidance = skillGuidanceFor('mobile_app').toLowerCase();

    expect(stack).toContain('expo');
    expect(guidance).toContain('expo');
    expect(guidance).toContain('expo-router');
  });

  /*
   * The preview runs the web target. Guidance that ignores it would produce an
   * app that cannot be shown to the person who asked for it.
   */
  it('tells a mobile build it must also run on the web, because that is the preview', () => {
    expect(skillGuidanceFor('mobile_app')).toContain('expo start --web');
  });

  it('tells a website about metadata and a web app about the server boundary', () => {
    expect(skillGuidanceFor('website').toLowerCase()).toContain('meta description');
    expect(skillGuidanceFor('web_app').toLowerCase()).toContain('server components');
  });

  it('tells an API about status codes and a dashboard about units', () => {
    expect(skillGuidanceFor('api')).toContain('401');
    expect(skillGuidanceFor('dashboard').toLowerCase()).toContain('units');
  });

  /* The rules that stop generated code being a demo apply everywhere. */
  it('always demands real states rather than a happy path', () => {
    for (const target of TARGETS) {
      const guidance = skillGuidanceFor(target).toLowerCase();
      expect(guidance, target).toContain('empty state');
      expect(guidance, target).toContain('error state');
    }
  });

  /*
   * The most common way a generated page fails to compile: a font weight the
   * family does not publish. It is a correctness rule wearing a style rule's
   * clothes, so it belongs in the standards every target receives.
   */
  it('warns every target about font weights that do not exist', () => {
    for (const target of TARGETS) {
      expect(skillGuidanceFor(target).toLowerCase(), target).toContain('weights');
    }
  });

  it('never lets a build hard-code a secret', () => {
    for (const target of TARGETS) {
      expect(skillGuidanceFor(target).toLowerCase(), target).toContain('environment variables');
    }
  });
});

/**
 * The skills added for how a site looks and whether it compiles.
 *
 * Both exist because of specific failures: generated pages arriving evenly grey
 * and evenly spaced, and a page marked "use client" exporting metadata, which
 * Next refuses at compile time.
 */
describe('the design and correctness skills', () => {
  it('reach a website build', () => {
    const keys = skillsFor('website').map((skill) => skill.key);

    expect(keys).toContain('visual-design');
    expect(keys).toContain('next-correctness');
  });

  it('do not reach a build with no pages', () => {
    // An API has nothing to look at, and nothing to lay out.
    expect(skillsFor('api').map((skill) => skill.key)).not.toContain('visual-design');
  });

  it('do not give App Router rules to a build that is not Next', () => {
    /*
     * Mobile is Expo. Telling it about "use client" is advice about a framework
     * it does not use, which is worse than silence — it invites a model to
     * invent a way to comply.
     */
    expect(skillsFor('mobile_app').map((skill) => skill.key)).not.toContain('next-correctness');
  });

  it('names the client/metadata rule explicitly', () => {
    /* The failure that produced the skill, so the rule cannot quietly go missing. */
    const rules = skillsFor('website').flatMap((skill) => skill.guidance).join('\n');

    expect(rules).toMatch(/use client/);
    expect(rules).toMatch(/metadata/);
  });

  it('keeps every rule checkable in the output', () => {
    /*
     * The file's own standard: guidance nobody can verify from the generated
     * files is decoration. Vague verbs are how that slips.
     */
    const vague = /\b(?:look good|be beautiful|modern|clean|nice|stunning|best practices)\b/i;

    for (const skill of skillsFor('website')) {
      for (const rule of skill.guidance) {
        expect(vague.test(rule), rule).toBe(false);
      }
    }
  });
});
