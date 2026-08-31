import { describe, expect, it, vi } from 'vitest';
import { repairPreviewCompilation } from '../repair-preview';

const failed = (output: string) => ({ installed: true, ready: false, output });
const ready = { installed: true, ready: true, output: '' };

describe('preview compilation repair', () => {
  it('repairs a CSS failure and then the missing import revealed by recompilation', async () => {
    const repair = vi.fn(async () => {});
    const restart = vi.fn()
      .mockResolvedValueOnce(failed("Module not found: Can't resolve '@/components/cart/CartProvider'"))
      .mockResolvedValueOnce(ready);
    const result = await repairPreviewCompilation({
      initial: failed('Syntax error: The `text-on-primary` class does not exist.'),
      readLog: async () => '', repair, restart,
    });
    expect(result.ready).toBe(true);
    expect(repair).toHaveBeenCalledTimes(2);
    expect(repair.mock.calls[1]).toEqual([expect.stringContaining('CartProvider'), 2]);
  });

  it('caps failed repairs at three attempts', async () => {
    const initial = failed('Syntax Error');
    const repair = vi.fn(async () => {});
    const result = await repairPreviewCompilation({
      initial, repair, readLog: async () => '', restart: async () => initial,
    });
    expect(result.ready).toBe(false);
    expect(repair).toHaveBeenCalledTimes(3);
  });

  it('does not spend AI calls on healthy previews or installation failures', async () => {
    for (const initial of [ready, { installed: false, ready: false, output: 'Syntax Error' }]) {
      const repair = vi.fn(async () => {});
      await repairPreviewCompilation({ initial, repair, readLog: async () => '', restart: async () => ready });
      expect(repair).not.toHaveBeenCalled();
    }
  });

  it('does not retry infrastructure failures', async () => {
    const repair = vi.fn(async () => {});
    await repairPreviewCompilation({
      initial: failed(''), readLog: async () => 'Error: listen EADDRINUSE', repair,
      restart: async () => ready,
    });
    expect(repair).not.toHaveBeenCalled();
  });
});
