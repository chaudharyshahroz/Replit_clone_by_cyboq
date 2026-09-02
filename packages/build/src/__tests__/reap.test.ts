/**
 * Reaping idle previews.
 *
 * `expiresAt` was written on every sandbox from the first version and read by
 * nothing — the column, the index and the TTL constant all existed, and no
 * query ever selected on it. A preview container therefore lived until the same
 * project was previewed again, so the number of Node processes on the host was
 * the number of builds anybody had opened since the last restart.
 *
 * That is the shape of a machine that works and then stops answering: nothing
 * errors, memory is consumed by containers serving pages nobody is looking at,
 * and the first symptom is the proxy timing out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const destroy = vi.fn().mockResolvedValue(undefined);
const rows: { expired: unknown[]; live: unknown[] } = { expired: [], live: [] };
const updated: unknown[] = [];

vi.mock('@reklu/sandbox', () => ({
  DEV_LOG_PATH: '.reklu-dev-server.log',
  sandbox: () => ({ name: 'docker', isIsolated: true, destroy }),
  sandboxStatus: () => ({ available: true, isolated: true, driver: 'docker', detail: '' }),
}));

vi.mock('@reklu/database', () => {
  let call = 0;
  const where = () => {
    const result = call++ === 0 ? rows.expired : rows.live;
    return Object.assign(Promise.resolve(result), { orderBy: () => Promise.resolve(result) });
  };
  return {
    db: {
      select: () => ({ from: () => ({ where }) }),
      update: () => ({ set: (values: unknown) => ({ where: () => { updated.push(values); return Promise.resolve(); } }) }),
    },
    sandboxes: new Proxy({}, { get: (_t, key) => String(key) }),
    buildProjects: new Proxy({}, { get: (_t, key) => String(key) }),
    __resetCall: () => { call = 0; },
  };
});

const { reapIdleSandboxes } = await import('../preview');
const database = await import('@reklu/database');

beforeEach(() => {
  destroy.mockClear();
  updated.length = 0;
  (database as unknown as { __resetCall: () => void }).__resetCall();
});

const box = (id: string) => ({ id, externalId: `container-${id}` });

describe('reaping', () => {
  it('destroys a preview whose deadline has passed', async () => {
    rows.expired = [box('a'), box('b')];
    rows.live = [];

    expect(await reapIdleSandboxes()).toBe(2);
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(destroy.mock.calls.map((c) => (c[0] as { externalId: string }).externalId)).toEqual([
      'container-a',
      'container-b',
    ]);
  });

  it('keeps every live preview when the host is under its ceiling', async () => {
    rows.expired = [];
    rows.live = [box('a'), box('b'), box('c')];

    expect(await reapIdleSandboxes()).toBe(0);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('sheds the least recently used once over the ceiling', async () => {
    /*
     * The query hands them back most recently active first, so anything past
     * the ceiling is what nobody has looked at for longest — which is the one
     * worth taking, not the one somebody is editing.
     */
    rows.expired = [];
    rows.live = [box('newest'), box('a'), box('b'), box('c'), box('oldest')];

    expect(await reapIdleSandboxes()).toBe(1);
    expect((destroy.mock.calls[0]?.[0] as { externalId: string }).externalId).toBe(
      'container-oldest',
    );
  });

  it('records the sandbox as stopped, so it is not reaped again', async () => {
    rows.expired = [box('a')];
    rows.live = [];

    await reapIdleSandboxes();
    expect(updated[0]).toMatchObject({ status: 'stopped' });
  });

  it('does nothing at all when there is nothing to take', async () => {
    rows.expired = [];
    rows.live = [];

    expect(await reapIdleSandboxes()).toBe(0);
    expect(updated).toHaveLength(0);
  });
});
