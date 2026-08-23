/**
 * The visual pass.
 *
 * Generation produces an application that works. That is not the same as one
 * anybody wants to look at, and the gap is visible the moment Reklu's output
 * sits next to a competitor's: both render, one has a point of view.
 *
 * A single prompt cannot do both well. Asked to implement features *and* art
 * direct, a model spends its attention on the features and reaches for whatever
 * layout it has seen most — centred hero, three cards, a gradient, Inter. So
 * this is a second call with one job: keep the behaviour, raise the design.
 *
 * It runs only where presentation is the product. A background API has no
 * visual design to improve, and spending a model call pretending otherwise
 * would be theatre.
 */
import { getProvider, type ModelMessage, type RegisteredModel } from '@reklu/ai';
import { logger } from '@reklu/shared';
import type { BuildBrief, BuildTarget } from './brief';
import { parseGeneratedFiles, type GeneratedFile } from './parse';

/** Targets where what it looks like *is* what it is. */
const VISUAL_TARGETS: readonly BuildTarget[] = ['website', 'web_app', 'dashboard', 'mobile_app'];

export function needsDesignPass(target: BuildTarget): boolean {
  return VISUAL_TARGETS.includes(target);
}

/** Files worth sending to a design pass: the ones that decide how it looks. */
export function visualFiles(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  return files.filter((file) => {
    if (/^(node_modules|\.next|dist|build)\//.test(file.path)) return false;
    return /\.(tsx|jsx|css|scss|html)$/.test(file.path) ||
      /tailwind\.config|globals\.css|theme|tokens/.test(file.path);
  });
}

const DESIGN_PROMPT = [
  'You are a design director. The application already works. Your job is to make',
  'it look like a real product somebody chose to build, not a template.',
  '',
  'Output format — one block per file you change:',
  '',
  '// path/to/file.ext',
  '```language',
  'file contents',
  '```',
  '',
  'Rules:',
  '- Change presentation only. Do not remove a feature, a route, a state, or a',
  '  handler. If a file needs no visual change, do not emit it.',
  '- Emit complete files. A fragment silently truncates the application.',
  '',
  'What to do:',
  '- Commit to a specific visual direction that suits this particular subject,',
  '  and carry it through every screen. State it in a comment at the top of the',
  '  main stylesheet so it can be argued with.',
  '- Set a real type scale and pair typefaces deliberately. A display face used',
  '  with restraint and a body face that is comfortable at length.',
  '- Fonts must load. This is the single most common way a generated page fails',
  '  to compile, so treat it as a correctness rule, not a style one:',
  '    · Only request weights the family actually publishes. Many families ship',
  '      two. If you are not certain a weight exists, use 400 and 700 only.',
  '    · Prefer a variable font and pass a range, which sidesteps the question.',
  '    · Never invent a family name. If unsure, use a system font stack — a page',
  '      that renders in Georgia beats a page that does not build.',
  '    · Always give a real fallback stack after the loaded family.',
  '- Build the palette from tokens: a ground, two or three surfaces, a text',
  '  ramp, and one accent that means something. Neutrals should carry a slight',
  '  hue rather than being pure grey.',
  '- Space by a scale, not by eye. Let layout create rhythm through alignment and',
  '  consistent gaps.',
  '- Write the real copy. Specific names, specific claims, specific detail for',
  '  this subject. Never lorem ipsum, never "Your Company Here", never a heading',
  '  that could sit on any other site.',
  '- One memorable element the page is remembered by, executed properly, with',
  '  everything around it kept quiet.',
  '- Motion only where it explains something: an entrance, a hover that confirms',
  '  a target, a transition that keeps position. Respect prefers-reduced-motion.',
  '',
  'What to avoid, because it is what everyone generates:',
  '- A centred hero with a gradient headline and two buttons.',
  '- Three feature cards of equal weight with an icon on each.',
  '- Emoji as iconography or as section markers.',
  '- Inter for everything, uniform border-radius on every element, a purple to',
  '  blue gradient, or a wall of identical rounded boxes.',
  '',
  'Non-negotiable: readable contrast, visible keyboard focus, labelled controls,',
  'and a layout that holds from 360px upward.',
].join('\n');

export interface DesignPassResult {
  readonly files: readonly GeneratedFile[];
  readonly changed: number;
  readonly commentary: string;
}

/**
 * Revise the look of a generated application.
 *
 * Returns only the files it changed, for the caller to merge — a design pass
 * that returned a whole tree would delete anything it happened not to mention.
 */
export async function runDesignPass(options: {
  readonly brief: BuildBrief;
  readonly files: readonly GeneratedFile[];
  readonly model: RegisteredModel;
  readonly signal?: AbortSignal;
}): Promise<DesignPassResult> {
  const provider = getProvider(options.model.providerKey);
  if (!provider) {
    throw new Error(`Provider ${options.model.providerKey} is not configured`);
  }

  const candidates = visualFiles(options.files);
  if (candidates.length === 0) {
    return { files: [], changed: 0, commentary: 'No visual files to revise.' };
  }

  const context = [
    `Product: ${options.brief.product}`,
    options.brief.summary ? `Summary: ${options.brief.summary}` : '',
    `Target: ${options.brief.target}`,
    '',
    'Current files:',
    ...candidates.map(
      (file) => `\n// ${file.path}\n\`\`\`${file.language}\n${file.content.slice(0, 8_000)}\n\`\`\``,
    ),
  ]
    .filter(Boolean)
    .join('\n');

  const messages: ModelMessage[] = [
    { role: 'user', content: [{ type: 'text', text: context }] },
  ];

  const result = await provider.generate({
    modelIdentifier: options.model.modelIdentifier,
    messages,
    system: DESIGN_PROMPT,
    maxOutputTokens: Math.min(options.model.maxOutputTokens, 32_000),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const parsed = parseGeneratedFiles(result.text);

  if (parsed.rejected.length > 0) {
    logger.warn('Rejected unsafe paths from a design pass', {
      rejected: parsed.rejected.map((entry) => entry.path),
    });
  }

  /*
   * Only files that already existed. A design pass inventing a new route would
   * be adding behaviour, which is the one thing it was told not to do — and a
   * route nothing links to is dead weight in the tree.
   */
  const known = new Set(options.files.map((file) => file.path));
  const revised = parsed.files.filter((file) => known.has(file.path));

  const invented = parsed.files.length - revised.length;
  if (invented > 0) {
    logger.warn('Design pass proposed new files, which were dropped', { count: invented });
  }

  return {
    files: revised,
    changed: revised.length,
    commentary: parsed.commentary,
  };
}
