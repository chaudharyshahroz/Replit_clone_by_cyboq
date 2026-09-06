/**
 * A Prisma schema written on one line.
 *
 * Prisma's grammar is line-based, so `generator client { provider = "…" }` does
 * not parse. The way it fails is what makes this worth repairing rather than
 * warning about: the parser never sees the block close, so every following line
 * is reported as "not a valid definition within a generator". One compact line
 * produced twenty errors, the last of which said `provider` was missing from a
 * block containing it.
 *
 * And it fails during `npm install`, because `prisma generate` runs from
 * postinstall — so the reader is shown "Dependencies failed to install", which
 * points at npm rather than at a formatting slip in a schema.
 *
 * The schema below is the one a real build produced.
 */
import { describe, expect, it } from 'vitest';
import {
  repairPrismaRelationOpposites,
  repairPrismaSchema,
  repairPrismaSchemas,
  splitDeclarations,
} from '../repair-prisma';
import type { GeneratedFile } from '../parse';

const BROKEN = `generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql", url = env("DATABASE_URL") }

model User {
  id            String    @id @default(cuid())
  email         String    @unique
}

enum Role { CUSTOMER ADMIN }
enum OrderStatus { PENDING CONFIRMED PROCESSING SHIPPED DELIVERED CANCELLED REFUNDED }
`;

describe('reformatting a compact schema', () => {
  const fixed = repairPrismaSchema(BROKEN);

  it('puts every declaration on its own line', () => {
    expect(fixed).toContain('generator client {\n  provider = "prisma-client-js"\n}');
  });

  it('does not split a value that contains a comma or parentheses', () => {
    /*
     * `env("DATABASE_URL")` has parentheses and the datasource has a comma
     * between assignments. Splitting on either naively produces a schema that
     * is differently broken — and still does not parse.
     */
    expect(fixed).toContain(
      'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}',
    );
  });

  it('splits enum members, which are separated by spaces alone', () => {
    expect(fixed).toContain('enum Role {\n  CUSTOMER\n  ADMIN\n}');
    expect(fixed).toContain('  REFUNDED\n}');
  });

  it('leaves a schema that was already correct exactly as it was', () => {
    const good = `generator client {\n  provider = "prisma-client-js"\n}\n\nmodel User {\n  id String @id\n}\n`;
    expect(repairPrismaSchema(good)).toBe(good);
  });

  it('leaves a model whose fields were already on separate lines', () => {
    expect(fixed).toContain('model User {\n  id            String    @id @default(cuid())');
  });
});

describe('what must not be torn apart', () => {
  it('keeps a quoted string whole even when it contains a comma', () => {
    expect(splitDeclarations('provider = "a,b", url = "c"')).toEqual([
      'provider = "a,b"',
      'url = "c"',
    ]);
  });

  it('keeps an attribute list whole', () => {
    expect(splitDeclarations('id String @id @default(cuid()), name String')).toEqual([
      'id String @id @default(cuid())',
      'name String',
    ]);
  });

  it('does not treat a generator assignment as a list of names', () => {
    // `provider = "prisma-client-js"` has spaces in it. Splitting on whitespace
    // the way an enum needs would produce three broken lines.
    const single = repairPrismaSchema('generator client { provider = "prisma-client-js" }');
    expect(single).toBe('generator client {\n  provider = "prisma-client-js"\n}');
  });
});

describe('across a tree', () => {
  function file(path: string, content: string): GeneratedFile {
    return { path, content, language: 'prisma' };
  }

  it('touches only .prisma files', () => {
    const files = [
      file('prisma/schema.prisma', 'enum Role { A B }'),
      file('src/app/page.tsx', 'export default function Page() { return null }'),
    ];

    const repaired = repairPrismaSchemas(files);
    expect(repaired[0]?.content).toContain('enum Role {\n  A\n  B\n}');
    // A one-line function body in TypeScript is valid and must be left alone.
    expect(repaired[1]).toBe(files[1]);
  });

  it('returns the same object when a file needed no change', () => {
    const files = [file('prisma/schema.prisma', 'model A {\n  id String @id\n}\n')];
    expect(repairPrismaSchemas(files)[0]).toBe(files[0]);
  });
});

describe('repairing missing relation opposites', () => {
  const relations = `model Category {
  id String @id
}

model MenuItem {
  id String @id
  categoryId String
  category Category @relation(fields: [categoryId], references: [id])
}

model Address {
  id String @id
}

model Order {
  id String @id
  shippingAddressId String?
  billingAddressId String?
  shippingAddress Address? @relation("OrderShippingAddress", fields: [shippingAddressId], references: [id])
  billingAddress Address? @relation("OrderBillingAddress", fields: [billingAddressId], references: [id])
}
`;

  it('adds an unnamed inverse relation to the target model', () => {
    const fixed = repairPrismaRelationOpposites(relations);
    expect(fixed).toContain('model Category {\n  id String @id\n  menuItems MenuItem[]\n}');
  });

  it('adds distinct named inverses when two fields point at the same model', () => {
    const fixed = repairPrismaRelationOpposites(relations);
    expect(fixed).toContain('ordersAsShippingAddress Order[] @relation("OrderShippingAddress")');
    expect(fixed).toContain('ordersAsBillingAddress Order[] @relation("OrderBillingAddress")');
  });

  it('is idempotent after adding inverse fields', () => {
    const once = repairPrismaRelationOpposites(relations);
    expect(repairPrismaRelationOpposites(once)).toBe(once);
  });

  it('uses an optional singular inverse for a unique foreign key', () => {
    const schema = `model User {\n  id String @id\n}\n\nmodel Profile {\n  id String @id\n  userId String @unique\n  user User @relation(fields: [userId], references: [id])\n}\n`;
    expect(repairPrismaRelationOpposites(schema)).toContain('profiles Profile?');
  });
});
