/**
 * A generation that produced nothing.
 *
 * This reported "The model produced no files. Try describing the app in more
 * detail." for every cause, which is a guess and usually the wrong advice: the
 * briefs it happens to are already long, and the commonest cause is a model
 * spending its whole output budget on a plan and stopping before the first
 * file. More detail makes that worse.
 *
 * The response was discarded, so nothing better could be said. These pin that
 * it is kept, that the message names what was observed, and that one corrective
 * attempt is made before a person is asked to do anything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stream = vi.hoisted(() => vi.fn());
const generate = vi.hoisted(() => vi.fn());
const getProvider = vi.hoisted(() => vi.fn());

vi.mock('@reklu/ai', () => ({ getProvider }));

import {
  describeEmptyGeneration,
  describeExhaustedFallback,
  generateFiles,
  incompleteFinalFile,
} from '../generate';
import type { GenerationDiagnostics } from '../generate';
import type { BuildBrief } from '../brief';
import { createDesignEngineV4, understandProduct } from '@reklu/design-intelligence';

const brief = {
  product: 'Coffee shop site',
  summary: 'A landing page for a coffee shop',
  target: 'website',
  platforms: ['web'],
  userRoles: [],
  coreFeatures: [],
  pages: [],
  dataModel: [],
  stack: ['Next.js'],
  integrations: [],
  outOfScope: [],
  needsAuth: false,
  needsDatabase: false,
} as unknown as BuildBrief;

const model = {
  key: 'test',
  displayName: 'Test Model',
  providerKey: 'test',
  modelIdentifier: 'test-1',
  maxOutputTokens: 8_000,
  bestFor: ['coding'],
} as never;

function responds(chunks: readonly string[], finishReason = 'stop') {
  stream.mockImplementation(async function* () {
    for (const text of chunks) yield { type: 'text-delta', text };
    yield { type: 'finish', finishReason, usage: {} };
  });
  getProvider.mockReturnValue({ stream, generate });
}

beforeEach(() => {
  stream.mockReset();
  generate.mockReset();
  getProvider.mockReset();
});

const FILE = ['// package.json', '```json', '{ "name": "coffee" }', '```'].join('\n');

describe('asking again', () => {
  it('completes a component-only response into an installable application', async () => {
    responds(['// src/components/Hero.tsx\n```tsx\nexport function Hero() { return <main>Home</main>; }\n```']);
    generate.mockResolvedValue({
      text: [
        '// package.json',
        '```json',
        '{ "scripts": { "dev": "next dev" }, "dependencies": { "next": "14.2.5" } }',
        '```',
        '// src/app/page.tsx',
        '```tsx',
        "import { Hero } from '@/components/Hero';",
        'export default function Page() { return <Hero />; }',
        '```',
      ].join('\n'),
      finishReason: 'stop',
    });

    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
      requireFiles: true,
    });

    expect(result.files.map((file) => file.path)).toHaveLength(3);
    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['src/components/Hero.tsx', 'package.json', 'src/app/page.tsx']),
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('uses one V4 contract and actually inserts compiler artifacts', async () => {
    responds([
      '// src/app/layout.tsx\n```tsx\nexport default function Layout({ children }) { return <html><body>{children}</body></html>; }\n```',
    ]);
    const engine = createDesignEngineV4(
      understandProduct({ product: 'Coffino', summary: 'Coffee shop', target: 'website' }),
    );
    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      designEngineV4: engine,
      report: vi.fn(),
    });
    const system = stream.mock.calls[0]?.[0].system as string;
    expect(system).toContain('REKLU DESIGN ENGINE V4');
    expect(system).not.toContain('Fredoka');
    expect(result.files.some((file) => file.path === 'src/app/reklu-design.css')).toBe(true);
    expect(result.files.some((file) => file.path === 'src/components/reklu/BrandImage.tsx')).toBe(
      true,
    );
  });
  it('requests locally imported files that the model omitted before accepting the tree', async () => {
    responds([
      [
        FILE,
        '// src/app/page.tsx',
        '```tsx',
        "import { Hero } from '@/components/sections/Hero';",
        'export default function Page() { return <Hero />; }',
        '```',
      ].join('\n'),
    ]);
    generate.mockResolvedValue({
      text: [
        '// src/components/sections/Hero.tsx',
        '```tsx',
        'export function Hero() { return <section>Gym</section>; }',
        '```',
      ].join('\n'),
      finishReason: 'stop',
    });

    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
      requireFiles: true,
    });

    expect(result.files.map((entry) => entry.path)).toEqual([
      'package.json',
      'src/app/page.tsx',
      'src/components/sections/Hero.tsx',
    ]);
    const sent = generate.mock.calls[0]?.[0] as { messages: { content: { text: string }[] }[] };
    expect(sent.messages.at(-1)?.content[0]?.text).toContain(
      'src/app/page.tsx imports @/components/sections/Hero',
    );
  });

  it('rejects a file tree that remains incomplete after bounded completion attempts', async () => {
    responds([
      [
        FILE,
        '// src/app/page.tsx',
        '```tsx',
        'import Missing from "./Missing";',
        'export default Missing;',
        '```',
      ].join('\n'),
    ]);
    generate.mockResolvedValue({ text: 'No files.', finishReason: 'stop' });

    await expect(
      generateFiles({
        brief,
        prompt: 'build it',
        model,
        report: async () => {},
        requireFiles: true,
      }),
    ).rejects.toThrow(/unresolved local imports/i);
  });

  it('replaces a final file cut off by the output limit before returning the tree', async () => {
    responds(
      ['// src/lib/menu-data.ts\n```ts\nexport const menu = [{ name: "Veggie", price:'],
      'length',
    );
    generate.mockResolvedValue({
      text: '// src/lib/menu-data.ts\n```ts\nexport const menu = [{ name: "Veggie", price: 12 }];\n```',
      finishReason: 'stop',
    });

    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.content).toContain('price: 12');
    expect(incompleteFinalFile(result.files[0]!.content)).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('asks for the files alone when the first reply was all plan', async () => {
    responds(['Here is my plan for the site. First I will build the hero…'], 'length');
    generate.mockResolvedValue({ text: FILE, finishReason: 'stop' });

    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.files.map((file) => file.path)).toEqual(['package.json']);
    expect(result.diagnostics.retried).toBe(true);

    // The correction has to say what to do, not merely that something is wrong.
    const sent = generate.mock.calls[0]?.[0] as { messages: { content: { text: string }[] }[] };
    const last = sent.messages[sent.messages.length - 1]?.content[0]?.text ?? '';
    expect(last).toContain('no files');
    expect(last).toContain('package.json');
  });

  it('recovers files emitted in a reasoning model channel', async () => {
    stream.mockImplementation(async function* () {
      yield { type: 'reasoning-delta', text: FILE };
      yield { type: 'finish', finishReason: 'stop', usage: {} };
    });
    getProvider.mockReturnValue({ stream, generate });

    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
      requireFiles: true,
    });

    expect(result.files.map((file) => file.path)).toEqual(['package.json']);
    expect(result.commentary).toBe('');
    expect(generate).not.toHaveBeenCalled();
  });

  it('recovers reasoning-channel files from the corrective request', async () => {
    responds(['I will plan the application first.']);
    generate.mockResolvedValue({ text: '', reasoning: FILE, finishReason: 'stop' });

    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
      requireFiles: true,
    });

    expect(result.files.map((file) => file.path)).toEqual(['package.json']);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('reports the files the retry produced, so the log is not silent', async () => {
    responds(['Planning…'], 'length');
    generate.mockResolvedValue({ text: FILE, finishReason: 'stop' });

    const named: string[] = [];
    await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
      onFile: async (path) => {
        named.push(path);
      },
    });

    expect(named).toEqual(['package.json']);
  });

  it('does not ask twice when the first reply had files', async () => {
    responds([FILE]);

    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.diagnostics.retried).toBe(false);
    expect(result.files).toHaveLength(1);
  });

  it('keeps the first response in the diagnostics when the retry also fails', async () => {
    responds(['I would approach this by first considering the brand…'], 'length');
    generate.mockResolvedValue({ text: 'Still thinking about it.', finishReason: 'stop' });

    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
    });

    expect(result.files).toHaveLength(0);
    // The first response is the diagnostic one; the retry told us nothing new.
    expect(result.diagnostics.preview).toContain('I would approach this');
    expect(result.diagnostics.finishReason).toBe('length');
    expect(result.diagnostics.sawFence).toBe(false);
  });
});

describe('saying what went wrong', () => {
  function diagnostics(overrides: Partial<GenerationDiagnostics>): GenerationDiagnostics {
    return {
      responseChars: 500,
      sawFence: false,
      finishReason: 'stop',
      retried: true,
      preview: '',
      ...overrides,
    };
  }

  it('tells someone who ran out of room to ask for less, not for more detail', () => {
    const message = describeEmptyGeneration(
      diagnostics({ finishReason: 'length', sawFence: false }),
      0,
    );

    expect(message).toContain('output budget');
    expect(message).toContain('less');
    // The old advice, which pointed the wrong way for this cause.
    expect(message).not.toContain('more detail');
  });

  it('distinguishes an empty response from a talkative one', () => {
    expect(describeEmptyGeneration(diagnostics({ responseChars: 0 }), 0)).toContain('empty');
    expect(describeEmptyGeneration(diagnostics({}), 0)).toContain('prose');
  });

  it('names a content filter rather than blaming the brief', () => {
    expect(describeEmptyGeneration(diagnostics({ finishReason: 'content-filter' }), 0)).toContain(
      'content filter',
    );
  });

  it('reports rejected paths ahead of anything else', () => {
    expect(describeEmptyGeneration(diagnostics({}), 3)).toContain('3');
  });

  it('says so when code arrived with no filename', () => {
    const message = describeEmptyGeneration(diagnostics({ sawFence: true }), 0);
    expect(message).toContain('never named a file');
  });
});

describe('when the second attempt fails too', () => {
  it('raises a retryable provider error when a caller requires usable files', async () => {
    responds([], 'stop');
    generate.mockResolvedValue({ text: '', finishReason: 'stop' });

    await expect(
      generateFiles({
        brief,
        prompt: 'repair it',
        model,
        report: async () => {},
        requireFiles: true,
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: true,
      userMessage:
        'Test Model: The model returned an empty response. This is usually the provider refusing the request — try another model.',
    });
  });

  it('reports the first diagnosis rather than throwing away the build', async () => {
    /*
     * The retry is a second chance at a call that already failed. A provider
     * that rate-limits it, or that streams but does not answer a plain
     * generate, must not turn a recoverable empty result into an unhandled
     * error — the person still needs to be told what happened.
     */
    responds(['A plan, at length…'], 'length');
    generate.mockRejectedValue(new Error('429 Too Many Requests'));

    const result = await generateFiles({
      brief,
      prompt: 'build it',
      model,
      report: async () => {},
    });

    expect(result.files).toHaveLength(0);
    expect(result.diagnostics.finishReason).toBe('length');
    expect(describeEmptyGeneration(result.diagnostics, 0)).toContain('output budget');
  });

  it('survives a provider whose generate returns nothing at all', async () => {
    responds(['A plan…']);
    generate.mockResolvedValue(undefined);

    await expect(
      generateFiles({ brief, prompt: 'build it', model, report: async () => {} }),
    ).resolves.toMatchObject({ files: [] });
  });
});

describe('when every model has been tried', () => {
  /**
   * Each individual failure ends in "try another model". Sound for one
   * refusal; misleading once Reklu has already tried four, because the reader
   * switches model, watches the same chain run again, and reads it as the same
   * single model failing.
   *
   * Free endpoints are rate-limited and go down together, so this is the
   * common case rather than the rare one.
   */
  const attempted = [
    'Nemotron 3 Ultra (free)',
    'Laguna S 2.1 (free)',
    'Inkling (free)',
    'Nemotron 3.5 Lightning (free)',
  ];

  it('says how many were tried, and names them', () => {
    const message = describeExhaustedFallback(attempted, 'The model returned an empty response.');

    expect(message).toContain('4 models');
    for (const name of attempted) expect(message).toContain(name);
  });

  it('keeps the last provider’s own sentence', () => {
    // It is the only evidence of what actually went wrong.
    expect(describeExhaustedFallback(attempted, 'Rate limit exceeded.')).toContain(
      'Rate limit exceeded.',
    );
  });

  it('does not repeat the advice that has already been taken', () => {
    const message = describeExhaustedFallback(attempted, 'The model returned an empty response.');

    // "Try another model" is what the caller just did four times.
    expect(message).not.toMatch(/try another model/i);
    expect(message).toMatch(/waiting a few minutes|paid model/i);
  });
});
