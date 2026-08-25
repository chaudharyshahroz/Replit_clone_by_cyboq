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
import { getProvider, type ModelMessage, type RegisteredModel } from '@reklu/ai';
import { sandbox, type SandboxHandle } from '@reklu/sandbox';
import { logger } from '@reklu/shared';
import { briefToContext, type BuildBrief } from './brief';
import { skillGuidanceFor } from './build-skills';
import { parseGeneratedFiles, type GeneratedFile } from './parse';

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
  '- Include package.json with real dependencies and working scripts.',
  '- Validate external input. Handle API errors.',
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
}

export interface GenerationResult {
  readonly files: readonly GeneratedFile[];
  readonly rejected: readonly { path: string; reason: string }[];
  readonly commentary: string;
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
  const system = `${GENERATION_PROMPT}\n${skillGuidanceFor(options.brief.target)}`;

  /*
   * Streamed rather than awaited whole. The text is the same either way; what
   * changes is that a file can be announced when it is written instead of every
   * file appearing at once when the call returns.
   */
  let text = '';
  const announced = new Set<string>();
  let narrated = false;

  for await (const event of provider.stream({
    modelIdentifier: options.model.modelIdentifier,
    messages,
    system,
    maxOutputTokens: Math.min(options.model.maxOutputTokens, 32_000),
    ...(options.signal ? { signal: options.signal } : {}),
  })) {
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

  const parsed = parseGeneratedFiles(text);

  if (parsed.rejected.length > 0) {
    // Surfaced rather than swallowed: a model emitting `.env` or a traversal
    // path is worth knowing about.
    logger.warn('Rejected unsafe paths from a generation', {
      rejected: parsed.rejected.map((entry) => entry.path),
    });
  }

  return parsed;
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
  await driver.writeFiles(handle, params.files);

  const hasPackageJson = params.files.some((file) => file.path === 'package.json');
  if (!hasPackageJson) {
    return { handle, installed: false, checksPassed: null, output: 'No package.json to install.' };
  }

  await params.report('installing_dependencies');
  const install = await driver.exec(handle, {
    command: 'npm',
    args: ['install', '--no-audit', '--no-fund'],
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
