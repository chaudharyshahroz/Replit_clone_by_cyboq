/**
 * What the generator is expected to know, per kind of application.
 *
 * The generation prompt says how to format files and not to fake a demo. It
 * says nothing about what a good Expo project looks like, or that a Next.js app
 * needs a server/client boundary decided deliberately — so every build got the
 * same generic advice regardless of whether it was a marketing site or an
 * iOS app.
 *
 * These are the standards a senior engineer on that stack would apply without
 * being asked. They are appended to the system prompt for the target the brief
 * chose, so the guidance is specific to what is actually being built.
 *
 * Two rules for anything added here:
 *
 *   1. It must be a *standard*, not a preference. "Handle the offline case" is
 *      a standard; "use styled-components" is a preference, and imposing it
 *      would fight whatever the user asked for.
 *   2. It must be checkable in the output. Guidance nobody can verify from the
 *      generated files is decoration.
 */
import type { BuildTarget } from './brief';

export interface BuildSkill {
  readonly key: string;
  readonly name: string;
  readonly summary: string;
  readonly guidance: readonly string[];
}

/**
 * Applies to every build, whatever the target.
 *
 * These are the differences between generated code that demos and generated
 * code someone can actually ship.
 */
export const CORE_ENGINEERING: BuildSkill = {
  key: 'core-engineering',
  name: 'Engineering standards',
  summary: 'What separates a working application from a demo.',
  guidance: [
    'TypeScript strict. No `any` that a real type would replace.',
    'Every list has an empty state, every fetch has a loading and an error state.',
    'Validate anything that crosses a boundary — form input, route params, API responses.',
    'No secret is ever hard-coded. Read configuration from environment variables and document each one in README.md.',
    'Components stay small enough to read in one screen. Extract rather than nest deeply.',
    'Accessible by construction: labelled controls, keyboard reachable, visible focus, contrast that passes.',
    'A web font must exist and must publish the weights you ask for. Only request weights you are certain of — 400 and 700 are safe — or use a system font stack. A page that does not compile is worth less than a plain one.',
    'Name things for what they do in the product, not for the pattern they use.',
  ],
};

/**
 * Per-target standards.
 *
 * Written for the stack `stackFor` actually chooses, so the advice matches the
 * files the model is about to emit.
 */
export const BUILD_SKILLS: Readonly<Record<BuildTarget, BuildSkill>> = {
  website: {
    key: 'website',
    name: 'Marketing site',
    summary: 'A site that loads fast, reads well, and can be found.',
    guidance: [
      'Content first: real copy for this product, never lorem ipsum or placeholder headings.',
      'Semantic landmarks — header, nav, main, footer — and one h1 per page.',
      'Set per-page title and meta description, and Open Graph tags for sharing.',
      'Responsive from 360px up. Test the layout at a narrow width, not only wide.',
      'Images carry width, height and alt text so the page does not shift as it loads.',
      'Static rendering wherever the content does not depend on the visitor.',
    ],
  },

  web_app: {
    key: 'web-app',
    name: 'Web application',
    summary: 'Application structure that survives a second feature.',
    guidance: [
      'Decide the server/client boundary deliberately: server components by default, client only where interaction requires it.',
      'One source of truth for data fetching. Do not mix ad-hoc fetches with a cache layer.',
      'Forms report field-level errors and disable submit while in flight; never submit twice.',
      'Routes are the structure — organise files by feature, not by file type.',
      'Optimistic updates only where a failure can be rolled back visibly.',
      'Persist real state to the database, not to component state that vanishes on reload.',
    ],
  },

  dashboard: {
    key: 'dashboard',
    name: 'Dashboard',
    summary: 'Information design, not decoration.',
    guidance: [
      'Summary before detail: the number that matters is readable before anything is scrolled.',
      'Encode state in form as well as colour — a pill, a shape, a label — so it survives colour blindness and greyscale.',
      'Every chart states its units and its time range. An unlabelled axis is a lie waiting to happen.',
      'Tables get sorting, an explicit empty state, and horizontal scroll inside their own container.',
      'Numbers align on tabular figures so columns can be compared down the page.',
      'Never invent data for a chart. An empty dataset renders an empty state.',
    ],
  },

  mobile_app: {
    key: 'mobile-app',
    name: 'Mobile application',
    summary: 'One Expo codebase that behaves like a native app on both stores.',
    guidance: [
      'Expo with expo-router and TypeScript. File-based routes under app/, with a typed layout at each level.',
      'Respect safe areas on every screen — notches and home indicators are not padding you can guess.',
      'Touch targets at least 44pt. Nothing important within a thumb-width of a screen edge.',
      'Handle the offline case explicitly. A phone loses connectivity; a spinner forever is a bug.',
      'Use platform-appropriate navigation: stack for drill-down, tabs for peers, modal for interruptions.',
      'Lists use FlatList with keyExtractor, never map() over an unbounded array.',
      'Keep app.json accurate: name, slug, icon, splash, bundle identifiers for both platforms.',
      'The app must also run in the browser via expo start --web, since that is how the preview is shown.',
    ],
  },

  api: {
    key: 'api',
    name: 'API service',
    summary: 'An interface other people can build against.',
    guidance: [
      'Validate every request body and query parameter at the boundary, with a schema.',
      'Correct status codes: 400 for bad input, 401 unauthenticated, 403 unauthorised, 404 missing, 409 conflict.',
      'Errors return a consistent JSON shape with a machine-readable code and a human message.',
      'No unbounded list endpoint — paginate, and state the limit.',
      'Health endpoint that checks dependencies rather than returning a constant.',
      'Document every route in README.md with an example request and response.',
    ],
  },
};

/** The skills that apply to a build, most general first. */
export function skillsFor(target: BuildTarget): readonly BuildSkill[] {
  return [CORE_ENGINEERING, BUILD_SKILLS[target]];
}

/**
 * The guidance for a target, as prompt text.
 *
 * Appended to the system prompt rather than the user turn: it is a standard the
 * generator works to, not a request from the person, and mixing the two would
 * let a request accidentally override the engineering rules.
 */
export function skillGuidanceFor(target: BuildTarget): string {
  const sections = skillsFor(target).map((skill) =>
    [`${skill.name} — ${skill.summary}`, ...skill.guidance.map((line) => `- ${line}`)].join('\n'),
  );

  return ['', 'Standards for this build:', '', ...sections].join('\n');
}
