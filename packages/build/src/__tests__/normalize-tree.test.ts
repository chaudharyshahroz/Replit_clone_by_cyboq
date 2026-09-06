import { describe, expect, it } from 'vitest';
import { normalizeGeneratedTree } from '../normalize-tree';
import type { GeneratedFile } from '../parse';

const file = (path: string, content: string): GeneratedFile => ({
  path,
  content,
  language: 'typescript',
});

describe('shared generated tree normalization', () => {
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
