import { previewErrorIn } from './compile-log';

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
  let output = state.output || (state.installed && !state.ready ? await options.readLog() : '');

  /*
   * A detached process can fail before its framework prints a compiler error,
   * and a transient managed-sandbox launch can leave no process output at all.
   * Rebuild once without spending an AI call. A known host failure is not
   * retried because new application code cannot create memory, disk or a port.
   */
  if (
    state.installed &&
    !state.ready &&
    (!previewErrorIn(output) || /^\s*REKLU_PREVIEW_EXIT_CODE=\d+\s*$/.test(output)) &&
    !/EADDRINUSE|ENOSPC|no space left|heap out of memory|JavaScript heap/i.test(output)
  ) {
    state = await options.restart();
    output = state.output || (state.installed && !state.ready ? await options.readLog() : '');
  }

  for (let attempt = 1; attempt <= 3 && state.installed && !state.ready; attempt++) {
    output = state.output || (await options.readLog());
    const error = previewErrorIn(output);
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
