/**
 * Which providers this instance holds a key for.
 *
 * The admin panel answered this with its own list of provider names, written
 * out by hand. The list named five and a sixth existed, so OpenRouter reported
 * NO OPENROUTER_API_KEY while its key was set, its models were listed, and it
 * was answering requests — a panel whose job is to report configuration
 * reporting its own omission instead.
 *
 * There is one function that decides this, and everything that displays it must
 * ask that function. What this test protects is that the two cannot drift: any
 * provider the switch can build must be one this can name.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../providers/index.ts', import.meta.url), 'utf8');

describe('configuredProviderKeys', () => {
  it('names every provider the factory can build', () => {
    const switchBody = source.slice(
      source.indexOf('switch (providerKey)'),
      source.indexOf('export function configuredProviderKeys'),
    );

    /* Every `case 'name':` the factory handles, minus the development mock. */
    const handled = [...switchBody.matchAll(/case '([a-z-]+)':/g)]
      .map((match) => match[1]!)
      .filter((key) => key !== 'dev-echo');

    const listed = source.slice(source.indexOf('export function configuredProviderKeys'));

    const missing = handled.filter((key) => !listed.includes(`'${key}'`));
    expect(missing, 'providers the factory builds but nothing reports').toEqual([]);
  });

  it('reports the admin panel through the same function', () => {
    /*
     * The panel used a hand-written chain of provider names. Reading it from
     * here is what makes adding a provider one change rather than two, the
     * second of which is silently optional.
     */
    const page = readFileSync(
      new URL('../../../../apps/web/src/app/(admin)/admin/ai/page.tsx', import.meta.url),
      'utf8',
    );

    expect(page).toContain('configuredProviderKeys');
    expect(page).not.toMatch(/provider\.key === '[a-z]+' &&/);
  });
});
