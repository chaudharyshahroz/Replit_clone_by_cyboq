/**
 * `"use client"` and `export const metadata` in one file.
 *
 * Next refuses it at compile time, and the reader meets a wall of red in the
 * preview. A model makes this constantly and each half is reasonable: the page
 * needs a title, so it exports metadata; the page needs a dropdown, so it adds
 * the directive.
 */
import { describe, expect, it } from 'vitest';
import {
  repairClientIconRegistries,
  repairClientMetadata,
  repairMissingClientDirectives,
} from '../repair-client-metadata';
import type { GeneratedFile } from '../parse';

const page = (body: string): GeneratedFile => ({
  path: 'app/menu/page.tsx',
  language: 'tsx',
  content: body,
});

describe('repairing client icon registries', () => {
  it('removes an unnecessary client boundary from a pure SVG object', () => {
    const icons = {
      path: 'src/components/icons.tsx',
      language: 'tsx',
      content: `'use client';\nexport const Icons = { Mail: () => <svg><path /></svg> };\n`,
    } satisfies GeneratedFile;

    const [repaired] = repairClientIconRegistries([icons]);
    expect(repaired?.content).not.toContain('use client');
    expect(repaired?.content).toContain('Icons');
  });

  it('keeps the boundary when the registry really has client behaviour', () => {
    const icons = {
      path: 'src/components/icons.tsx',
      language: 'tsx',
      content: `'use client';\nimport { useState } from 'react';\nexport const Icons = { Toggle: () => { const [on] = useState(false); return <svg>{String(on)}</svg>; } };\n`,
    } satisfies GeneratedFile;

    expect(repairClientIconRegistries([icons])[0]).toBe(icons);
  });
});

const CLIENT_PAGE = `'use client';

import type { Metadata } from 'next';
import { useState } from 'react';

export const metadata: Metadata = {
  title: "Menu",
  description: "Browse the coffee, tea, and pastries.",
};

export default function MenuPage() {
  const [open, setOpen] = useState(false);
  return <div onClick={() => setOpen(!open)}>{String(open)}</div>;
}
`;

describe('repairing a client component that exports metadata', () => {
  it('repairs the screenshot case: a hook and metadata with no client directive', () => {
    const broken = page(CLIENT_PAGE.replace("'use client';\n\n", ''));
    const [marked] = repairMissingClientDirectives([broken]);
    const [repaired] = repairClientMetadata([marked!]);

    expect(repaired?.content).toMatch(/^'use client';/);
    expect(repaired?.content).toContain('useState');
    expect(repaired?.content).not.toContain('export const metadata');
  });

  it('recognizes memoized handlers, browser APIs and JSX events', () => {
    for (const source of [
      "import { useMemo } from 'react'; export default function Page(){ useMemo(() => 1, []); return null; }",
      "import { useRouter } from 'next/navigation'; export default function Page(){ useRouter(); return null; }",
      'export default function Page(){ return <button onClick={() => window.print()}>Print</button>; }',
      'export default function Page(){ React.useCallback(() => 1, []); return null; }',
    ]) {
      expect(repairMissingClientDirectives([page(source)])[0]?.content).toMatch(/^'use client';/);
    }
  });

  it('does not move a module using server-only Next APIs across the boundary', () => {
    const source =
      "import { cookies } from 'next/headers'; import { useState } from 'react'; export default function Page(){ useState(0); cookies(); return null; }";
    expect(repairMissingClientDirectives([page(source)])[0]?.content).toBe(source);
  });
  it('removes the export and keeps the component', () => {
    const [repaired] = repairClientMetadata([page(CLIENT_PAGE)]);

    expect(repaired?.content).not.toContain('export const metadata');
    /*
     * The directive stays. Without it the interactive parts throw at runtime;
     * without the export the page renders and loses its title, and a page that
     * works beats a page that does not compile.
     */
    expect(repaired?.content).toContain("'use client'");
    expect(repaired?.content).toContain('useState');
    expect(repaired?.content).toContain('Removed by Reklu');
  });

  it('removes the whole declaration, not just its first line', () => {
    // Cutting one line leaves a dangling object literal, which fails to
    // compile for a new reason — a worse outcome than the original.
    const [repaired] = repairClientMetadata([page(CLIENT_PAGE)]);

    expect(repaired?.content).not.toContain('title: "Menu"');
    expect(repaired?.content).not.toContain('description:');
  });

  it('drops the now-unused type import', () => {
    const [repaired] = repairClientMetadata([page(CLIENT_PAGE)]);
    expect(repaired?.content).not.toContain('import type { Metadata }');
  });

  it('handles generateMetadata as well', () => {
    const withFunction = page(`'use client';

export async function generateMetadata() {
  return { title: 'Menu' };
}

export default function Page() {
  return null;
}
`);

    const [repaired] = repairClientMetadata([withFunction]);
    expect(repaired?.content).not.toContain('generateMetadata');
    expect(repaired?.content).toContain('export default function Page');
  });

  it('leaves a server component alone', () => {
    /*
     * This is where metadata belongs. Removing it here would strip the title
     * from every correctly written page in the project.
     */
    const server = page(`import type { Metadata } from 'next';

export const metadata: Metadata = { title: "Menu" };

export default function Page() {
  return null;
}
`);

    expect(repairClientMetadata([server])[0]).toBe(server);
  });

  it('leaves a client component with no metadata alone', () => {
    const plain = page(`'use client';\n\nexport default function Page() { return null; }\n`);
    expect(repairClientMetadata([plain])[0]).toBe(plain);
  });
});
