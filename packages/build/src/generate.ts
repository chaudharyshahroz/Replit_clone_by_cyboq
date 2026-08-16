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
import { parseGeneratedFiles, type GeneratedFile } from './parse';

export type BuildStage =
  | 'interpreting_product'
  | 'planning_architecture'
  | 'generating_files'
  | 'installing_dependencies'
  | 'running_checks'
  | 'starting_preview';

export type BuildStageReporter = (stage: BuildStage, detail?: string) => void | Promise<void>;

const GENERATION_PROMPT = [
  'You generate a complete, working application from a build brief.',
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
  readonly model: RegisteredModel;
  readonly report: BuildStageReporter;
  /** Existing tree, for an edit rather than a first generation. */
  readonly existingFiles?: readonly GeneratedFile[];
  readonly signal?: AbortSignal;
}

export interface GenerationResult {
  readonly files: readonly GeneratedFile[];
  readonly rejected: readonly { path: string; reason: string }[];
  readonly commentary: string;
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
    { role: 'user', content: [{ type: 'text', text: context.join('\n') }] },
  ];

  const result = await provider.generate({
    modelIdentifier: options.model.modelIdentifier,
    messages,
    system: GENERATION_PROMPT,
    maxOutputTokens: Math.min(options.model.maxOutputTokens, 32_000),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const parsed = parseGeneratedFiles(result.text);

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
}): Promise<MaterializeResult> {
  const driver = sandbox();
  const limits = params.limits ?? {
    timeoutMs: 300_000,
    memoryMb: 2_048,
    diskMb: 1_024,
    maxOutputBytes: 512_000,
  };

  const handle = await driver.create(params.sandboxId, limits);
  await driver.writeFiles(handle, params.files);

  const hasPackageJson = params.files.some((file) => file.path === 'package.json');
  if (!hasPackageJson) {
    return { handle, installed: false, checksPassed: null, output: 'No package.json to install.' };
  }

  await params.report('installing_dependencies');
  const install = await driver.exec(handle, {
    command: 'npm',
    args: ['install', '--no-audit', '--no-fund'],
    timeoutMs: Math.min(limits.timeoutMs, 240_000),
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
