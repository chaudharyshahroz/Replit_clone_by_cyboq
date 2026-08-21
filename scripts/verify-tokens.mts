/**
 * Every colour class names a design token that exists.
 *
 * This exists because twenty-seven of them did not. `text-accent-foreground`,
 * `bg-success-subtle`, `border-danger-border` and `bg-surface-sunk` were used
 * across sixteen files, and none of the four is a token in globals.css. Tailwind
 * does not warn about a class it cannot resolve — it emits no rule at all — so
 * a success banner rendered with no background, a danger border with no border,
 * and button labels on the accent fill took their colour from whatever they
 * inherited. Every one of those elements looked deliberate in the source.
 *
 * Nothing else catches it: TypeScript does not read class strings, the build
 * succeeds, and the page renders. The only symptom is a component that quietly
 * looks wrong, which is exactly the kind of thing nobody files a bug about.
 *
 * Only names in a token family are checked. Tailwind's own palette (red-500,
 * zinc-800) and its keywords (bg-white, text-transparent) are left alone —
 * this is about tokens that were meant to resolve and did not.
 *
 * Run: pnpm verify:tokens
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web/src');
const css = join(web, 'app/globals.css');

/** Utility prefixes that take a colour. */
const PREFIXES = [
  'bg',
  'text',
  'border',
  'from',
  'to',
  'via',
  'ring',
  'fill',
  'stroke',
  'divide',
  'outline',
  'shadow',
  'accent',
  'caret',
  'decoration',
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

/** The tokens declared in `@theme`, as Tailwind would name them. */
function declaredTokens(): Set<string> {
  const text = readFileSync(css, 'utf8');
  const names = new Set<string>();
  for (const match of text.matchAll(/--color-([a-z0-9-]+)\s*:/g)) names.add(match[1]!);
  return names;
}

const tokens = declaredTokens();
/*
 * A class belongs to a token family when its first segment is one — that is
 * what separates `bg-success-subtle` (meant to be a token, is not one) from
 * `bg-red-500` (Tailwind's own, and none of this script's business).
 */
const families = new Set([...tokens].map((token) => token.split('-')[0]!));

const pattern = new RegExp(
  String.raw`\b(?:${PREFIXES.join('|')})-([a-z][a-z0-9-]*)(?![a-z0-9-])`,
  'g',
);

interface Dead {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

const dead: Dead[] = [];

for (const file of sourceFiles(web)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      const name = match[1]!;
      if (tokens.has(name)) continue;
      if (!families.has(name.split('-')[0]!)) continue;
      dead.push({ name, file: relative(root, file), line: index + 1 });
    }
  });
}

console.log(`Colour tokens declared: ${tokens.size}`);

if (dead.length === 0) {
  console.log('  PASS  every colour class resolves to a declared token');
  process.exit(0);
}

console.log(`  FAIL  ${dead.length} class${dead.length === 1 ? '' : 'es'} name a token that does not exist\n`);
for (const item of dead) {
  console.log(`        ${item.file}:${item.line} — ${item.name}`);
}
console.log(`\nDeclared tokens: ${[...tokens].sort().join(', ')}`);
process.exit(1);
