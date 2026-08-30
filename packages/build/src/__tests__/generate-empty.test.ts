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

import { describeEmptyGeneration, generateFiles } from '../generate';
import type { GenerationDiagnostics } from '../generate';
import type { BuildBrief } from '../brief';

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
