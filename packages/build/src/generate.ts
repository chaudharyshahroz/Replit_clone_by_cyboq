/**
 * Build orchestration (spec §28).
 *
 * Drives the sequence the spec requires: interpret the product, plan the
 * architecture, generate files, install, check, preview. Each stage is
 * announced as it is entered, so the progress a user sees is where the code
 * actually is (spec §89, §143).
 *
 * Two rules the generation prompt enforces, both from spec §38–39:
 *   - an example in the request is not the scope
 *   - real applications need loading, empty and error states, not a happy path
 */
import {
  getProvider,
  type FinishReason,
  type ModelMessage,
  type RegisteredModel,
} from '@reklu/ai';
import { sandbox, type SandboxHandle } from '@reklu/sandbox';
import { errors, logger } from '@reklu/shared';
import { briefToContext, type BuildBrief } from './brief';
import { skillGuidanceFor } from './build-skills';
import {
  chooseDirection,
  describeDirection,
  directionPrompt,
  isVisualTarget,
} from './design-intelligence';
import { parseGeneratedFiles, type GeneratedFile } from './parse';
import { dependencyInstallCommand } from './install-args';
import { withImageBytes } from './artwork';
import { designDNAPrompt, type DesignDNA } from '@reklu/design-intelligence';

export type BuildStage =
  | 'interpreting_product'
  | 'planning_architecture'
  | 'generating_files'
  | 'designing'
  | 'installing_dependencies'
  | 'running_checks'
  | 'starting_preview';

export type BuildStageReporter = (stage: BuildStage, detail?: string) => void | Promise<void>;

/** Called as each file finishes being written, with the path it landed at. */
export type BuildFileReporter = (path: string) => void | Promise<void>;

const GENERATION_PROMPT = [
  'You generate a complete, working application from a build brief.',
  '',
  'Begin with two or three sentences, in plain prose, saying what you are about',
  'to build and the decisions you have made about it — the kind of thing you',
  'would say to a colleague before opening the editor. Write it as yourself,',
  'in the present tense. No headings, no bullet list, no restating the brief',
  'back. Then start emitting files and add no further commentary between them.',
  '',
  'Output format — one block per file:',
  '',
  '// path/to/file.ext',
  '```language',
  'file contents',
  '```',
  '',
  'Requirements:',
  '- Generate the COMPLETE application described by the brief, not a demo. If the',
  '  brief lists features, implement all of them.',
  '- Examples in the brief are illustrative. A product supporting "three items" in',
  '  an example supports many items in reality.',
  '- Include loading, empty and error states — not just the happy path.',
  '- Responsive layout, consistent styling, accessible markup.',
  '- Treat any Website Strategist brief in the request as the product and design',
  '  specification: its audience, conversion goal, proof and section order are',
  '  decisions already made from evidence. Do not replace them with a template.',
  '- Keep the tree lean: no unused components, duplicate layout wrappers, sample',
  '  routes, or dependencies that do not serve a requested feature.',
  '- Include package.json with real dependencies and working scripts.',
  '- Emit the minimum runnable shell FIRST, before utilities or components:',
  '  package.json, framework configuration, root layout, and the homepage entry',
  '  (src/app/page.tsx for Next.js, index.html for Vite, app/index.tsx for Expo).',
  '  Only then emit supporting modules. If output is cut short, the saved tree',
  '  must still have a real page at / rather than a server that only returns 404.',
  '- Validate external input. Handle API errors.',
  '- Before emitting an import, ensure the target file is emitted and the path',
  '  matches exactly. Before using a CSS utility, ensure the framework provides it.',
  '- Never invent secrets. Read configuration from environment variables and',
  '  document them in a .env.example-style comment inside README.md.',
  '- Do not emit .env, .git, or any credential file.',
].join('\n');

export interface GenerateBuildOptions {
  readonly brief: BuildBrief;
  readonly prompt: string;
  /**
   * Images attached to the request.
   *
   * Passed as picture rather than described in words: someone attaching a
   * screenshot of a layout they want is asking for that layout, and a sentence
   * naming the file tells the model nothing it can build from.
   */
  readonly images?: readonly { readonly image: string; readonly mimeType?: string }[];
  readonly model: RegisteredModel;
  readonly report: BuildStageReporter;
  /** Existing tree, for an edit rather than a first generation. */
  readonly existingFiles?: readonly GeneratedFile[];
  readonly signal?: AbortSignal;
  /** Fail retryably instead of accepting a response that produced no files. */
  readonly requireFiles?: boolean;
  /**
   * Told what the model said before it started writing.
   *
   * Its own words, streamed as soon as the first file begins — not a summary
   * composed afterwards from what it happened to produce.
   */
  readonly onNarration?: ((text: string) => void | Promise<void>) | undefined;
  /**
   * Told about each file as it completes.
   *
   * Generation was a single call that returned everything at once, so the only
   * honest thing a screen could say for two minutes was "writing the code".
   * Streaming the response and parsing it as it arrives means each file can be
   * named at the moment it is actually written.
   */
  readonly onFile?: BuildFileReporter | undefined;
  /** Persistent project-wide visual rules. Optional for imported/legacy builds. */
  readonly designDNA?: DesignDNA | undefined;
}

export interface GenerationResult {
  readonly files: readonly GeneratedFile[];
  readonly rejected: readonly { path: string; reason: string }[];
  readonly commentary: string;
  /**
   * What the model actually did, kept for the case where it did nothing useful.
   *
   * A generation that produces no files used to report "try describing the app
   * in more detail" — a guess, and usually the wrong advice: the briefs this
   * happens to are already long, and the commonest cause is a model spending
   * its whole output budget on a plan and stopping before the first file. The
   * fix for that is a smaller ask or a bigger model, which is the opposite of
   * what the message said. None of it was knowable, because the response was
   * discarded.
   */
  readonly diagnostics: GenerationDiagnostics;
}

export interface GenerationDiagnostics {
  /** How much the model wrote, in characters. */
  readonly responseChars: number;
  /** Whether a code fence appeared at all. */
  readonly sawFence: boolean;
  /** Why the model stopped. `length` means it ran out of room. */
  readonly finishReason: FinishReason;
  /** Whether a second, corrective attempt was made. */
  readonly retried: boolean;
  /** The opening of the response, for a log line a person can read. */
  readonly preview: string;
}

/**
 * What the model said before it wrote anything.
 *
 * Everything up to the first file's path line. Taken from the response rather
 * than composed from the result, so the log carries the model's own account of
 * what it is doing rather than a description assembled afterwards from the
 * files it happened to produce.
 */
export function leadingProse(response: string): string {
  const fence = response.indexOf('```');
  if (fence === -1) return '';

  const before = response.slice(0, fence);
  const lines = before.split('\n');

  /* The last line before a fence is the file's path comment, not prose. */
  while (lines.length > 0) {
    const last = lines[lines.length - 1]!.trim();
    if (last === '' || /^(\/\/|#|<!--)/.test(last)) lines.pop();
    else break;
  }

  return lines.join('\n').trim();
}

/** The final path whose code fence was cut off by the provider's output limit. */
export function incompleteFinalFile(response: string): string | undefined {
  if ((response.match(/```/g)?.length ?? 0) % 2 === 0) return undefined;
  return parseGeneratedFiles(response).files.at(-1)?.path;
}

/** Generate or revise the file tree. Does not touch the sandbox. */
export async function generateFiles(
  options: GenerateBuildOptions,
): Promise<GenerationResult> {
  const provider = getProvider(options.model.providerKey);
  if (!provider) {
    throw new Error(`Provider ${options.model.providerKey} is not configured`);
  }

  await options.report('planning_architecture');

  const context = [briefToContext(options.brief), '', `Request: ${options.prompt}`];

  if (options.existingFiles && options.existingFiles.length > 0) {
    // For an edit, show the current tree so the model revises rather than
    // regenerating from scratch and silently dropping files.
    context.push(
      '',
      'Current files (emit only the ones you change):',
      ...options.existingFiles.map(
        (file) => `\n// ${file.path}\n\`\`\`${file.language}\n${file.content.slice(0, 4_000)}\n\`\`\``,
      ),
    );
  }

  await options.report('generating_files');

  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: context.join('\n') },
        ...(options.images ?? []).map(
          (attachment) =>
            ({
              type: 'image',
              image: attachment.image,
              ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
            }) as const,
        ),
      ],
    },
  ];

  /*
   * The standards for this kind of application, appended to the system prompt
   * rather than the request. They are what the generator works to, not
   * something the person asked for — putting them in the user turn would let a
   * request talk them out of handling errors.
   */
  /*
   * And the materials: the palette, the typefaces, the style. The standards say
   * "one accent, used for one job"; the direction says which colour it is. A
   * model given only the first invents the second, and invents the same one
   * every time.
   */
  const visual = isVisualTarget(options.brief.target);
  const direction = visual ? chooseDirection(options.brief) : undefined;

  if (direction) {
    logger.info('Design direction chosen', {
      direction: describeDirection(direction),
      matched: direction.matched,
    });
  }

  const system = [
    GENERATION_PROMPT,
    skillGuidanceFor(options.brief.target),
    ...(direction ? [directionPrompt(direction, options.brief.target)] : []),
    ...(options.designDNA ? [designDNAPrompt(options.designDNA)] : []),
  ].join('\n');

  /*
   * Streamed rather than awaited whole. The text is the same either way; what
   * changes is that a file can be announced when it is written instead of every
   * file appearing at once when the call returns.
   */
  let text = '';
  const announced = new Set<string>();
  let narrated = false;
  let finishReason: FinishReason = 'unknown';

  for await (const event of provider.stream({
    modelIdentifier: options.model.modelIdentifier,
    messages,
    system,
    maxOutputTokens: Math.min(options.model.maxOutputTokens, 32_000),
    ...(options.signal ? { signal: options.signal } : {}),
  })) {
    /*
     * Why it stopped, which is the difference between "the model refused" and
     * "the model ran out of room". Both produced the same empty result and the
     * same wrong advice.
     */
    if (event.type === 'finish') finishReason = event.finishReason;
    if (event.type !== 'text-delta') continue;
    text += event.text;

    /*
     * Only when a fence appears. Re-parsing on every token would be quadratic
     * over a hundred kilobytes of output.
     *
     * A file is announced when its opening fence arrives — the path is on the
     * line before it and is therefore already complete — so the report says
     * what is being written now rather than what was written a moment ago.
     */
    if (!event.text.includes('```')) continue;

    /*
     * The plan, the moment the first file starts. Held until then because that
     * is when the prose is known to be finished — while it is still arriving,
     * anything shown would be a half sentence.
     */
    if (!narrated && options.onNarration) {
      const prose = leadingProse(text);
      if (prose) {
        narrated = true;
        await options.onNarration(prose);
      }
    }

    if (!options.onFile) continue;

    for (const file of parseGeneratedFiles(text).files) {
      if (announced.has(file.path)) continue;
      announced.add(file.path);
      await options.onFile(file.path);
    }
  }

  let parsed = parseGeneratedFiles(text);
  let retried = false;

  /*
   * A response that ends inside a file used to be accepted as complete. That
   * is how `price:` at the final byte became a saved TypeScript module and a
   * chain of preview repair calls. Complete that one file now, before the tree
   * is checkpointed or any sandbox is started.
   */
  const incompletePath = finishReason === 'length' ? incompleteFinalFile(text) : undefined;
  if (incompletePath && !options.signal?.aborted) {
    retried = true;
    const partial = parsed.files.find((file) => file.path === incompletePath);
    const completed = await provider.generate({
      modelIdentifier: options.model.modelIdentifier,
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: [{ type: 'text', text: text.slice(-8_000) }],
        },
        {
          role: 'user',
          content: [{
            type: 'text',
            text:
              `The response stopped halfway through ${incompletePath}. Emit that complete file ` +
              'again, from its first line to its last line, and nothing else. Include its path comment and closing fence.',
          }],
        },
      ],
      system,
      maxOutputTokens: Math.min(options.model.maxOutputTokens, 16_000),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const replacement = parseGeneratedFiles(completed?.text ?? '').files.find(
      (file) => file.path === incompletePath,
    );
    if (!replacement || incompleteFinalFile(completed?.text ?? '')) {
      throw errors.providerError({
        provider: options.model.providerKey,
        model: options.model.modelIdentifier,
        detail: `Output stopped inside ${incompletePath} and the completion retry did not return a complete file.`,
        userMessage: 'This model stopped halfway through a file. Reklu Auto is trying another coding model.',
        retryable: true,
      });
    }
    parsed = {
      ...parsed,
      files: parsed.files.map((file) => (file === partial ? replacement : file)),
    };
    text = `${text}\n${completed.text}`;
    finishReason = completed.finishReason ?? 'stop';
  }

  /*
   * One corrective attempt when nothing parsed.
   *
   * A model that answers a build with a plan and no code has not refused and
   * has not failed — it has misread the format, and the ordinary human response
   * is to say so and ask again. That is cheaper than a person retyping their
   * brief, and it is the fix for the commonest shape of this failure: the
   * response opens with a long plan, the output budget runs out, and the first
   * file never arrives.
   *
   * Only once. A model that ignores the correction will ignore it twice, and
   * the second call is the user's money.
   */
  if (parsed.files.length === 0 && !options.signal?.aborted) {
    retried = true;
    logger.warn('Generation produced no files; asking again for the files alone', {
      responseChars: text.length,
      finishReason,
    });

    /*
     * Best effort, and never fatal. This is a second chance at a call that has
     * already failed; if it throws — a rate limit, a provider that streams but
     * does not answer a plain generate — the honest outcome is the diagnosis of
     * the first attempt, not an unhandled error that loses the build.
     */
    try {
    const retry = await provider.generate({
      modelIdentifier: options.model.modelIdentifier,
      messages: [
        ...messages,
        { role: 'assistant', content: [{ type: 'text', text: text.slice(0, 4_000) }] },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'That reply contained no files, so nothing was built.',
                '',
                'Emit the files now and nothing else. No plan, no explanation, no',
                'summary — those cost output budget that the files need. Start with',
                'package.json. Each file is a path comment on its own line followed',
                'by a fenced block:',
                '',
                '// path/to/file.ext',
                '```language',
                'file contents',
                '```',
                '',
                'If you cannot fit the whole application, emit the most important',
                'files complete rather than all of them truncated.',
              ].join('\n'),
            },
          ],
        },
      ],
      system,
      maxOutputTokens: Math.min(options.model.maxOutputTokens, 32_000),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const second = parseGeneratedFiles(retry?.text ?? '');
    if (second.files.length > 0) {
      parsed = second;
      text = retry.text;
      finishReason = retry.finishReason ?? 'stop';

      if (options.onFile) {
        for (const file of second.files) {
          if (announced.has(file.path)) continue;
          announced.add(file.path);
          await options.onFile(file.path);
        }
      }
    }
    } catch (error) {
      logger.warn('The second attempt at a generation failed too', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (parsed.rejected.length > 0) {
    // Surfaced rather than swallowed: a model emitting `.env` or a traversal
    // path is worth knowing about.
    logger.warn('Rejected unsafe paths from a generation', {
      rejected: parsed.rejected.map((entry) => entry.path),
    });
  }

  if (options.requireFiles && parsed.files.length === 0) {
    throw errors.providerError({
      provider: options.model.providerKey,
      model: options.model.modelIdentifier,
      detail: describeEmptyGeneration(
        {
          responseChars: text.length,
          sawFence: text.includes('```'),
          finishReason,
          retried,
          preview: text.slice(0, 400),
        },
        parsed.rejected.length,
      ),
      userMessage: 'This model did not return usable code. Reklu Auto is trying another coding model.',
      retryable: true,
    });
  }

  return {
    ...parsed,
    diagnostics: {
      responseChars: text.length,
      sawFence: text.includes('```'),
      finishReason,
      retried,
      preview: text.slice(0, 400),
    },
  };
}

/**
 * Why a generation produced nothing, in words that point at the fix.
 *
 * Each branch names something observed in the response rather than guessed at,
 * because the advice differs sharply: a model that ran out of room needs a
 * smaller ask, and a model that wrote prose needs a different model. The old
 * single message — "try describing the app in more detail" — was the wrong
 * advice for both.
 */
export function describeEmptyGeneration(
  diagnostics: GenerationDiagnostics,
  rejected: number,
): string {
  if (rejected > 0) {
    return `The model produced no usable files. ${rejected} were rejected as unsafe paths.`;
  }

  if (diagnostics.responseChars === 0) {
    return 'The model returned an empty response. This is usually the provider refusing the request — try another model.';
  }

  if (diagnostics.finishReason === 'content-filter') {
    return "The provider's content filter stopped the response. Try another model.";
  }

  if (diagnostics.finishReason === 'length' && !diagnostics.sawFence) {
    return (
      'The model used its whole output budget writing a plan and stopped before the first file. ' +
      'Ask for less at once — a homepage before the whole site — or choose a model with more output room.'
    );
  }

  if (diagnostics.finishReason === 'length') {
    return (
      'The model ran out of output room part-way through the first file, so nothing was complete enough to keep. ' +
      'Ask for fewer pages at once, or choose a model with more output room.'
    );
  }

  if (!diagnostics.sawFence) {
    return (
      'The model replied in prose and never wrote a file, twice. ' +
      'This model may not be able to build; try another one.'
    );
  }

  return (
    'The model wrote code but never named a file, so none could be saved. ' +
    'Try another model.'
  );
}

/**
 * Merge newly generated files over an existing tree.
 *
 * An edit that emits three files must not delete the other forty — the model
 * was asked for changes, not a replacement. Files are only ever added or
 * replaced here; deletion is a separate, explicit operation.
 */
export function mergeTree(
  existing: readonly GeneratedFile[],
  generated: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  const byPath = new Map(existing.map((file) => [file.path, file]));
  for (const file of generated) byPath.set(file.path, file);
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export interface MaterializeResult {
  readonly handle: SandboxHandle;
  readonly installed: boolean;
  readonly checksPassed: boolean | null;
  readonly output: string;
}

/**
 * Write a tree into a sandbox, install dependencies, and run checks.
 *
 * Failures are returned, not thrown: a build that generated files but failed
 * its type-check is still a build the user should see and can ask Reklu to fix
 * (spec §88). Losing the files because `npm install` failed would be the wrong
 * trade.
 */
export async function materialize(params: {
  readonly sandboxId: string;
  readonly files: readonly GeneratedFile[];
  readonly report: BuildStageReporter;
  readonly limits?: { timeoutMs: number; memoryMb: number; diskMb: number; maxOutputBytes: number };
  readonly runChecks?: boolean;
  /**
   * The port this sandbox will serve a preview on, when it is going to.
   *
   * Passed at creation because container runtimes fix published ports then and
   * cannot add one to a running container.
   */
  readonly publishPort?: number;
}): Promise<MaterializeResult> {
  const driver = sandbox();
  const limits = params.limits ?? {
    timeoutMs: 300_000,
    memoryMb: 2_048,
    diskMb: 1_024,
    maxOutputBytes: 512_000,
  };

  const handle = await driver.create(
    params.sandboxId,
    limits,
    params.publishPort === undefined ? undefined : { publishPort: params.publishPort },
  );
  await driver.writeFiles(handle, await withImageBytes(params.files));

  const hasPackageJson = params.files.some((file) => file.path === 'package.json');
  if (!hasPackageJson) {
    return { handle, installed: false, checksPassed: null, output: 'No package.json to install.' };
  }

  await params.report('installing_dependencies');
  const installCommand = dependencyInstallCommand();
  const install = await driver.exec(handle, {
    ...installCommand,
    /*
     * Installing is the one step that is legitimately slow, and the cost of
     * cutting it short is the whole build. A Next.js tree on a small
     * self-hosted machine routinely passes four minutes on a cold npm cache —
     * and a timeout there reads as "dependencies failed to install", which
     * sends someone looking for a broken dependency that is fine.
     */
    timeoutMs: Math.max(limits.timeoutMs, 600_000),
  });

  if (install.exitCode !== 0) {
    /*
     * Logged as well as returned. It was returned only — into a panel in
     * somebody's browser — so a failing install was invisible from the machine
     * it happened on. Diagnosing one meant asking the person to read it back,
     * which is exactly backwards: the server had the text and could not say it.
     */
    logger.error('npm install failed', {
      sandboxId: params.sandboxId,
      exitCode: install.exitCode,
      output: (install.stderr || install.stdout).slice(-4_000),
    });

    return {
      handle,
      installed: false,
      checksPassed: false,
      // The real output, so the user can read what went wrong (spec §88).
      output: `npm install failed (exit ${install.exitCode})\n\n${install.stderr || install.stdout}`,
    };
  }

  if (params.runChecks === false) {
    return { handle, installed: true, checksPassed: null, output: install.stdout };
  }

  await params.report('running_checks');
  const check = await driver.exec(handle, {
    command: 'npm',
    args: ['run', 'build', '--if-present'],
    timeoutMs: Math.min(limits.timeoutMs, 240_000),
  });

  return {
    handle,
    installed: true,
    checksPassed: check.exitCode === 0,
    output: check.exitCode === 0 ? check.stdout : `${check.stdout}\n${check.stderr}`,
  };
}
