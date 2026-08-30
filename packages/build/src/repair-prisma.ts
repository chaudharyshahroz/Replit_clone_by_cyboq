/**
 * Put a Prisma schema back on separate lines.
 *
 * Prisma's grammar is line-based: every declaration inside a block must sit on
 * its own line. A model that writes the same thing compactly —
 *
 *     generator client { provider = "prisma-client-js" }
 *     enum Role { CUSTOMER ADMIN }
 *
 * — has written something Prisma cannot parse, and it says so in the least
 * helpful way available. Because the opening brace is never closed as far as
 * the parser is concerned, *every following line* is reported as "not a valid
 * definition within a generator": one compact line at the top produced twenty
 * errors, the last of which claimed `provider` was missing from a block where
 * it is plainly present.
 *
 * It fails at `npm install`, because `prisma generate` runs from postinstall.
 * So the whole build stops before a single page is served, and what the reader
 * sees is "Dependencies failed to install" — a message pointing at npm, three
 * layers away from a formatting slip in a schema.
 *
 * The correction is mechanical and loses nothing: the same declarations, one to
 * a line. Reformatting is not a matter of taste here, it is the difference
 * between a schema that parses and one that does not.
 */
import type { GeneratedFile } from './parse';

/** The blocks Prisma's grammar recognises. */
const BLOCK = /^(\s*)(generator|datasource|model|enum|type|view)(\s+\w+\s*)\{(.+)\}\s*$/;

/**
 * Split the body of a one-line block into its declarations.
 *
 * Commas and whitespace both separate — `{ provider = "postgresql", url =
 * env("DATABASE_URL") }` uses one, `{ CUSTOMER ADMIN }` uses the other — but
 * neither separates inside quotes or parentheses, where a comma is part of a
 * value. Splitting naively turns `env("DATABASE_URL")` into two fragments and
 * produces a schema that is differently broken.
 */
export function splitDeclarations(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | undefined;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] as string;

    if (quote) {
      current += char;
      if (char === quote && body[i - 1] !== '\\') quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;

    /* A separator only at the top level of the declaration. */
    if (depth === 0 && char === ',') {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  parts.push(current);

  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Whether a body is a list of bare names rather than of assignments.
 *
 * An enum's members are separated by spaces alone — `{ CUSTOMER ADMIN }` — so
 * they need splitting on whitespace, which would destroy `provider =
 * "prisma-client-js"` if applied to a generator.
 */
function isNameList(declarations: readonly string[]): boolean {
  return declarations.every((part) => /^[A-Za-z_]\w*$/.test(part));
}

/** Reformat one schema. Returns the input unchanged when nothing was compact. */
export function repairPrismaSchema(source: string): string {
  const lines = source.split('\n');
  let changed = false;

  const output = lines.flatMap((line) => {
    const match = BLOCK.exec(line);
    if (!match) return [line];

    const [, indent = '', keyword, name = ' ', body = ''] = match;

    /* A closing brace inside the body means this is not one flat block. */
    if (body.includes('}')) return [line];

    let declarations = splitDeclarations(body);

    /*
     * Enum members carry no commas, so the split above returns them as one
     * string. They separate on whitespace instead — but only when every part
     * is a bare name, so a generator's `provider = "…"` is never torn apart.
     */
    if (declarations.length === 1 && !declarations[0]?.includes('=')) {
      const names = declarations[0]?.split(/\s+/).filter(Boolean) ?? [];
      if (names.length > 1 && isNameList(names)) declarations = names;
    }

    if (declarations.length === 0) return [line];

    changed = true;

    return [
      `${indent}${keyword}${name.replace(/\s+$/, ' ')}{`,
      ...declarations.map((declaration) => `${indent}  ${declaration}`),
      `${indent}}`,
    ];
  });

  return changed ? output.join('\n') : source;
}

/** Every Prisma schema in a tree, reformatted where it would not parse. */
export function repairPrismaSchemas(
  files: readonly GeneratedFile[],
): readonly GeneratedFile[] {
  return files.map((file) => {
    if (!file.path.endsWith('.prisma')) return file;

    const content = repairPrismaSchema(file.content);
    return content === file.content ? file : { ...file, content };
  });
}
