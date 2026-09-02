/**
 * Runtime-only files shared by every sandbox driver.
 *
 * Keep the path relative to the sandbox working directory. An absolute `/tmp`
 * path works inside Docker and E2B, but points at the Reklu host when the local
 * development driver runs a diagnostic command. That made local preview logs
 * permanently empty and allowed an unconsumed child-process pipe to fill up.
 */
export const DEV_LOG_PATH = '.reklu-dev-server.log';

/** Written even when a detached preview exits without printing an error. */
export const PREVIEW_EXIT_MARKER = 'REKLU_PREVIEW_EXIT_CODE=';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Run a preview with durable output and a durable exit status.
 *
 * Docker and E2B detach the process, so their API call succeeding only proves
 * that a shell was launched. The child can exit a millisecond later without
 * writing anything. Persisting its status lets readiness checks stop waiting
 * and gives the repair path evidence instead of an empty console.
 */
export function previewProcessCommand(command: {
  readonly command: string;
  readonly args: readonly string[];
}): string {
  const invocation = [command.command, ...command.args].map(shellQuote).join(' ');
  const log = shellQuote(DEV_LOG_PATH);
  return (
    `{ ${invocation}; } > ${log} 2>&1; ` +
    `code=$?; printf '\\n${PREVIEW_EXIT_MARKER}%s\\n' "$code" >> ${log}; exit "$code"`
  );
}
