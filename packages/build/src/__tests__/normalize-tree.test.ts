import { describe, expect, it } from 'vitest';
import { normalizeGeneratedTree } from '../normalize-tree';
import type { GeneratedFile } from '../parse';

const file = (path: string, content: string): GeneratedFile => ({
  path,
  content,
  language: 'typescript',
});

describe('shared generated tree normalization', () => {
  it('repairs an impossible Auth.js adapter line before a preview install', () => {
    const result = normalizeGeneratedTree([
      file('package.json', '{"dependencies":{"@auth/prisma-adapter":"^1.7.0"}}'),
    ]);
    expect(
      JSON.parse(result.find((entry) => entry.path === 'package.json')!.content).dependencies[
        '@auth/prisma-adapter'
      ],
    ).toBe('^2.11.3');
  });

  it('adds a PostCSS plugin named by generated Tailwind 4 configuration', () => {
    const result = normalizeGeneratedTree([
      file(
        'package.json',
        '{"devDependencies":{"tailwindcss":"^4.1.0"},"dependencies":{}}',
      ),
      file(
        'postcss.config.js',
        "module.exports = { plugins: { '@tailwindcss/postcss': {} } };",
      ),
    ]);
    expect(
      JSON.parse(result.find((entry) => entry.path === 'package.json')!.content).dependencies[
        '@tailwindcss/postcss'
      ],
    ).toBe('^4.1.0');
  });

  it('normalizes a Tailwind 3 manifest when Design V5 CSS uses Tailwind 4 syntax', () => {
    const tree = [
      file(
        'package.json',
        '{"devDependencies":{"tailwindcss":"^3.4.17"},"dependencies":{}}',
      ),
      file(
        'postcss.config.js',
        "module.exports = { plugins: { '@tailwindcss/postcss': {} } };",
      ),
      file(
        'src/app/globals.css',
        '@import "tailwindcss";\n@theme { --color-background: #f8f7f3; }',
      ),
    ];
    const result = normalizeGeneratedTree(tree);
    const manifest = JSON.parse(
      result.find((entry) => entry.path === 'package.json')!.content,
    );

    expect(manifest.devDependencies.tailwindcss).toBe('^4.1.0');
    expect(manifest.dependencies['@tailwindcss/postcss']).toBe('^4.1.0');
    expect(result.find((entry) => entry.path === 'postcss.config.js')!.content).toContain(
      '@tailwindcss/postcss',
    );
    expect(normalizeGeneratedTree(result)).toEqual(result);
  });

  it('repairs historical trees with missing dependencies, CSS imports, and JSX extensions together', () => {
    const tree = [
      file('package.json', '{"dependencies":{"next":"14.2.3"}}'),
      file('src/app/layout.tsx', 'export default function Layout() { return <html />; }'),
      file('src/app/globals.css', '@tailwind base;'),
      file('src/lib/constants.ts', "import clsx from 'clsx'; export const icon = <svg />;"),
    ];
    const result = normalizeGeneratedTree(tree);
    expect(result.find((entry) => entry.path === 'src/app/layout.tsx')!.content).toContain(
      "import './globals.css'",
    );
    expect(result.some((entry) => entry.path === 'src/lib/constants.tsx')).toBe(true);
    expect(
      JSON.parse(result.find((entry) => entry.path === 'package.json')!.content).dependencies.clsx,
    ).toBeDefined();
    expect(normalizeGeneratedTree(result)).toEqual(result);
  });

  it('adds the required Next root layout to an App Router tree', () => {
    const result = normalizeGeneratedTree([
      file('package.json', '{"dependencies":{"next":"14.2.3"}}'),
      file('src/app/page.tsx', 'export default function Page() { return <main />; }'),
      file('src/app/globals.css', 'body { margin: 0; }'),
    ]);
    const layout = result.find((entry) => entry.path === 'src/app/layout.tsx');
    expect(layout?.content).toContain("import './globals.css'");
    expect(layout?.content).toContain('<html lang="en">');
    expect(normalizeGeneratedTree(result)).toEqual(result);
  });

  it('repairs a generated App Router page that uses hooks without declaring a client boundary', () => {
    const result = normalizeGeneratedTree([
      file('package.json', '{"dependencies":{"next":"14.2.3"}}'),
      file(
        'src/app/page.tsx',
        "import { useState } from 'react'; export default function Page(){ const [open] = useState(false); return <main>{String(open)}</main>; }",
      ),
    ]);
    expect(result.find((entry) => entry.path === 'src/app/page.tsx')?.content).toMatch(
      /^'use client';/,
    );
    expect(normalizeGeneratedTree(result)).toEqual(result);
  });

  it('repairs missing Prisma relation opposites before a historical tree reaches preview install', () => {
    const result = normalizeGeneratedTree([
      file(
        'prisma/schema.prisma',
        `model Address {
  id String @id
}

model Order {
  id String @id
  shippingAddressId String?
  billingAddressId String?
  shippingAddress Address? @relation("OrderShippingAddress", fields: [shippingAddressId], references: [id])
  billingAddress Address? @relation("OrderBillingAddress", fields: [billingAddressId], references: [id])
}
`,
      ),
    ]);
    const schema = result[0]!.content;
    expect(schema).toContain('ordersAsShippingAddress Order[] @relation("OrderShippingAddress")');
    expect(schema).toContain('ordersAsBillingAddress Order[] @relation("OrderBillingAddress")');
    expect(normalizeGeneratedTree(result)).toEqual(result);
  });
});
