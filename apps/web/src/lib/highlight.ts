/**
 * Syntax colouring for the code viewer.
 *
 * A lexer, not a parser — it recognises comments, strings, numbers, keywords and
 * types by shape, and knows nothing about scope or meaning. That is enough to
 * read code by and honest about what it is: no dependency, nothing to load, and
 * no chance of a heavyweight highlighter blocking the panel it decorates.
 *
 * The order of the patterns is the whole design. Comments and strings are
 * matched *first*, so a `//` inside a string stays a string and a keyword inside
 * a comment stays a comment — which is the mistake that makes a naive
 * highlighter look broken on exactly the files people read most.
 */

export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'type' | 'plain';

export interface Token {
  readonly text: string;
  readonly kind: TokenKind;
}

const KEYWORDS = [
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function',
  'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'new', 'class', 'extends', 'implements', 'interface', 'type',
  'enum', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof',
  'instanceof', 'in', 'of', 'this', 'super', 'static', 'public', 'private',
  'protected', 'readonly', 'as', 'satisfies', 'true', 'false', 'null',
  'undefined', 'void', 'delete', 'yield',
];

/** Language families the viewer actually encounters. */
function familyFor(language: string): 'js' | 'css' | 'json' | 'markup' | 'plain' {
  const id = language.toLowerCase();
  if (/^(ts|tsx|js|jsx|javascript|typescript|mjs|cjs)$/.test(id)) return 'js';
  if (/^(css|scss|sass|less)$/.test(id)) return 'css';
  if (/^(json|jsonc)$/.test(id)) return 'json';
  if (/^(html|xml|svg|vue)$/.test(id)) return 'markup';
  return 'plain';
}

/**
 * One expression per family, with the alternatives in priority order.
 *
 * A single pass with ordered alternation is what keeps the precedence honest:
 * whichever alternative matches at a position wins, so a string opening before
 * a comment marker consumes it and vice versa.
 */
function patternFor(family: ReturnType<typeof familyFor>): RegExp | undefined {
  switch (family) {
    case 'js':
      return new RegExp(
        [
          '(?<comment>\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)',
          '(?<string>`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')',
          '(?<number>\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)',
          `(?<keyword>\\b(?:${KEYWORDS.join('|')})\\b)`,
          // Capitalised identifiers read as types or components in this codebase.
          '(?<type>\\b[A-Z][A-Za-z0-9_]*\\b)',
        ].join('|'),
        'g',
      );
    case 'css':
      return new RegExp(
        [
          '(?<comment>\\/\\*[\\s\\S]*?\\*\\/)',
          '(?<string>"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')',
          '(?<number>\\b-?\\d*\\.?\\d+(?:px|rem|em|%|vh|vw|dvh|s|ms|deg|fr)?\\b)',
          '(?<keyword>@[a-z-]+|--[a-z0-9-]+)',
          '(?<type>[.#][a-zA-Z_][\\w-]*)',
        ].join('|'),
        'g',
      );
    case 'json':
      return new RegExp(
        [
          '(?<string>"(?:\\\\.|[^"\\\\])*")',
          '(?<number>-?\\b\\d+(?:\\.\\d+)?\\b)',
          '(?<keyword>\\b(?:true|false|null)\\b)',
        ].join('|'),
        'g',
      );
    case 'markup':
      return new RegExp(
        [
          '(?<comment><!--[\\s\\S]*?-->)',
          '(?<string>"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')',
          '(?<type></?[a-zA-Z][\\w:-]*)',
        ].join('|'),
        'g',
      );
    default:
      return undefined;
  }
}

/**
 * Split source into coloured runs.
 *
 * Everything not matched comes back as `plain`, so the output always
 * reconstitutes the input exactly — a highlighter that loses a character is
 * worse than one that colours nothing.
 */
export function tokenize(code: string, language: string): readonly Token[] {
  const pattern = patternFor(familyFor(language));
  if (!pattern) return code.length > 0 ? [{ text: code, kind: 'plain' }] : [];

  const tokens: Token[] = [];
  let lastIndex = 0;

  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ text: code.slice(lastIndex, index), kind: 'plain' });
    }

    const groups = match.groups ?? {};
    const kind = (Object.keys(groups).find((name) => groups[name] !== undefined) ??
      'plain') as TokenKind;

    tokens.push({ text: match[0], kind });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex), kind: 'plain' });
  }

  return tokens;
}

/** Token colours, drawn from the design tokens rather than invented per view. */
export const TOKEN_CLASS: Readonly<Record<TokenKind, string>> = {
  comment: 'text-text-muted italic',
  string: 'text-success',
  number: 'text-warning',
  keyword: 'text-accent',
  type: 'text-text',
  plain: 'text-text-secondary',
};
