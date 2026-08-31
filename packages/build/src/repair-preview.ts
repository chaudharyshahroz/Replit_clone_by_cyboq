import { compileErrorIn } from './compile-log';

interface PreviewState {
  readonly installed: boolean;
  readonly ready: boolean;
  readonly output: string;
}

/** Each compiler pass can reveal a different failure. Always re-check, but cap AI work. */
export async function repairPreviewCompilation<T extends PreviewState>(options: {
  initial: T;
  readLog: () => Promise<string>;
  repair: (error: string, attempt: number) => Promise<void>;
  restart: () => Promise<T>;
}): Promise<T> {
  let state = options.initial;
  for (let attempt = 1; attempt <= 3 && state.installed && !state.ready; attempt++) {
    const output = state.output || (await options.readLog());
    const error = compileErrorIn(output);
    if (!error) return { ...state, output };
    try {
      await options.repair(error, attempt);
    } catch {
      /* Keep the compiler evidence. A provider outage did not prevent the
       * preview server from starting and must not replace the actionable error. */
      return { ...state, output };
    }
    state = await options.restart();
  }
  return state;
}
