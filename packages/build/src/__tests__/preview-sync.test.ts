import { describe, expect, it } from 'vitest';
import { staleProjectFiles } from '../preview';

describe('preview tree synchronization', () => {
  it('removes a stale source file after a JSX extension repair', () => {
    expect(
      staleProjectFiles(
        ['package.json', 'src/lib/constants.tsx'],
        ['package.json', 'package-lock.json', 'src/lib/constants.ts', 'src/lib/constants.tsx'],
      ),
    ).toEqual(['src/lib/constants.ts']);
  });

  it('removes files deleted by an edit but preserves npm runtime state', () => {
    expect(
      staleProjectFiles(
        ['package.json', 'src/app/page.tsx'],
        ['package.json', 'package-lock.json', 'src/app/page.tsx', 'src/components/Old.tsx'],
      ),
    ).toEqual(['src/components/Old.tsx']);
  });
});
