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
const MODEL_BLOCK = /^(\s*)model\s+(\w+)\s*\{([\s\S]*?)^\1\}/gm;

interface PrismaField {
  readonly name: string;
  readonly type: string;
  readonly modifier: string;
  readonly attributes: string;
}

interface PrismaModel {
  readonly name: string;
  readonly body: string;
  readonly closeIndex: number;
  readonly indent: string;
  readonly fields: readonly PrismaField[];
}

function prismaFields(body: string): readonly PrismaField[] {
  return body.split('\n').flatMap((line) => {
    const match = /^\s*(\w+)\s+(\w+)(\?|\[\])?\s*(.*)$/.exec(line);
    if (!match || match[1]?.startsWith('@@')) return [];
    return [
      {
        name: match[1]!,
        type: match[2]!,
        modifier: match[3] ?? '',
        attributes: match[4] ?? '',
      },
    ];
  });
}

function relationName(attributes: string): string | undefined {
  return /@relation\s*\(\s*["']([^"']+)["']/.exec(attributes)?.[1];
}

function lowerFirst(value: string): string {
  return value ? value[0]!.toLowerCase() + value.slice(1) : value;
}

function pluralize(value: string): string {
  if (/[^aeiou]y$/i.test(value)) return `${value.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(value)) return `${value}es`;
  return `${value}s`;
}

/**
 * Add the inverse side of generated Prisma relations when the target model exists.
 * Prisma requires both sides even when the foreign key lives on only one model.
 */
export function repairPrismaRelationOpposites(source: string): string {
  const models: PrismaModel[] = [...source.matchAll(MODEL_BLOCK)].map((match) => {
    const full = match[0];
    const body = match[3] ?? '';
    const fieldIndent = /\n(\s+)\w+\s+\w+/.exec(body)?.[1] ?? `${match[1] ?? ''}  `;
    return {
      name: match[2]!,
      body,
      closeIndex: match.index! + full.lastIndexOf('}'),
      indent: fieldIndent,
      fields: prismaFields(body),
    };
  });
  const byName = new Map(models.map((model) => [model.name, model]));
  const additions = new Map<string, string[]>();
  const plannedRelations = new Set<string>();
  const plannedNames = new Map(
    models.map((model) => [model.name, new Set(model.fields.map((f) => f.name))]),
  );

  for (const model of models) {
    const relationFields = model.fields.filter(
      (field) => byName.has(field.type) && field.type !== model.name,
    );
    for (const field of relationFields) {
      const target = byName.get(field.type)!;
      const name = relationName(field.attributes);
      const hasOpposite = target.fields.some(
        (candidate) =>
          candidate.type === model.name &&
          (name
            ? relationName(candidate.attributes) === name
            : !relationName(candidate.attributes)),
      );
      const relationKey = `${target.name}:${model.name}:${name ?? '__unnamed'}`;
      if (hasOpposite || plannedRelations.has(relationKey)) continue;

      // Multiple unnamed relations between the same models are ambiguous. Do not guess
      // which relation a generated inverse belongs to; named relations are repaired safely.
      if (
        !name &&
        relationFields.filter(
          (candidate) => candidate.type === field.type && !relationName(candidate.attributes),
        ).length > 1
      ) {
        continue;
      }

      const baseName = name
        ? `${pluralize(lowerFirst(model.name))}As${field.name[0]!.toUpperCase()}${field.name.slice(1)}`
        : pluralize(lowerFirst(model.name));
      const names = plannedNames.get(target.name)!;
      let oppositeName = baseName;
      let suffix = 2;
      while (names.has(oppositeName)) oppositeName = `${baseName}${suffix++}`;
      names.add(oppositeName);

      const foreignKeys = /fields\s*:\s*\[([^\]]+)\]/
        .exec(field.attributes)?.[1]
        ?.split(',')
        .map((key) => key.trim())
        .filter(Boolean);
      const oneToOne =
        Boolean(foreignKeys?.length) &&
        foreignKeys!.every((key) =>
          model.fields.some(
            (candidate) => candidate.name === key && /@unique\b/.test(candidate.attributes),
          ),
        );
      const oppositeType = oneToOne ? `${model.name}?` : `${model.name}[]`;
      const annotation = name ? ` @relation("${name}")` : '';
      additions.set(target.name, [
        ...(additions.get(target.name) ?? []),
        `${target.indent}${oppositeName} ${oppositeType}${annotation}`,
      ]);
      plannedRelations.add(relationKey);
    }
  }

  if (additions.size === 0) return source;
  let repaired = source;
  for (const model of [...models].sort((left, right) => right.closeIndex - left.closeIndex)) {
    const fields = additions.get(model.name);
    if (!fields?.length) continue;
    const separator = repaired[model.closeIndex - 1] === '\n' ? '' : '\n';
    repaired = `${repaired.slice(0, model.closeIndex)}${separator}${fields.join('\n')}\n${repaired.slice(model.closeIndex)}`;
  }
  return repaired;
}

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

  return repairPrismaRelationOpposites(changed ? output.join('\n') : source);
}

/** Every Prisma schema in a tree, reformatted where it would not parse. */
export function repairPrismaSchemas(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  return files.map((file) => {
    if (!file.path.endsWith('.prisma')) return file;

    const content = repairPrismaSchema(file.content);
    return content === file.content ? file : { ...file, content };
  });
}
