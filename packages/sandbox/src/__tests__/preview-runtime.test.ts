import { describe, expect, it } from 'vitest';
import {
  DEV_LOG_PATH,
  PREVIEW_EXIT_MARKER,
  previewProcessCommand,
} from '../preview-runtime';

describe('detached preview process command', () => {
  it('persists output and the exit status when the process terminates', () => {
    const line = previewProcessCommand({
      command: 'npx',
      args: ['next', 'dev', '--hostname', '0.0.0.0'],
    });

    expect(line).toContain("'npx' 'next' 'dev' '--hostname' '0.0.0.0'");
    expect(line).toContain(`> '${DEV_LOG_PATH}' 2>&1`);
    expect(line).toContain(PREVIEW_EXIT_MARKER);
    expect(line).toContain('exit "$code"');
  });

  it('shell-quotes every command argument', () => {
    const line = previewProcessCommand({ command: 'tool', args: ["it's safe", 'two words'] });
    expect(line).toContain("'it'\\''s safe'");
    expect(line).toContain("'two words'");
  });
});
