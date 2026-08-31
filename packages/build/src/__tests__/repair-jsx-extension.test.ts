import { describe, expect, it } from 'vitest';
import type { GeneratedFile } from '../parse';
import { repairJsxExtensions } from '../repair-jsx-extension';

const file = (path: string, content: string): GeneratedFile => ({ path, content, language: 'typescript' });

describe('repairJsxExtensions', () => {
  it('renames a TypeScript constants file containing inline SVG JSX', () => {
    const [result] = repairJsxExtensions([
      file('src/lib/constants.ts', "export const links = [{ icon: (<svg className='w-6'><path /></svg>) }];"),
    ]);
    expect(result!.path).toBe('src/lib/constants.tsx');
    expect(result!.language).toBe('typescriptreact');
  });

  it('leaves ordinary TypeScript and declaration files unchanged', () => {
    const files = [file('src/lib/math.ts', 'export const less = 1 < 2;'), file('src/types.d.ts', 'declare const x: string;')];
    expect(repairJsxExtensions(files)).toEqual(files);
  });

  it('does not overwrite an existing TSX file', () => {
    const files = [file('src/lib/constants.ts', 'export const icon = <svg />;'), file('src/lib/constants.tsx', 'export const other = 1;')];
    expect(repairJsxExtensions(files)).toEqual(files);
  });
});
