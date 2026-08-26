/**
 * `"use client"` and `export const metadata` in one file.
 *
 * Next refuses it at compile time, and the reader meets a wall of red in the
 * preview. A model makes this constantly and each half is reasonable: the page
 * needs a title, so it exports metadata; the page needs a dropdown, so it adds
 * the directive.
 */
import { describe, expect, it } from 'vitest';
import { repairClientMetadata } from '../repair-client-metadata';
import type { GeneratedFile } from '../parse';

const page = (body: string): GeneratedFile => ({
  path: 'app/menu/page.tsx',
  language: 'tsx',
  content: body,
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
    expect(repaired?.content).not.toContain("import type { Metadata }");
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
