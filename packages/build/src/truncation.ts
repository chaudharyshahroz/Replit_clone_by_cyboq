/**
 * Whether a generated file actually finished.
 *
 * Truncation was inferred from two things that both lie. An odd number of code
 * fences in the response — which is even again the moment a model closes the
 * fence it was cut off inside — and `finishReason === 'length'`, which free
 * providers routinely report as `stop` after ending a stream early.
 *
 * When both missed, half a file was written into the sandbox and the reader was
 * shown a compiler error three layers from the cause. `property-data.ts` ended
 * mid-object and Next said `Unexpected eof`; `page.tsx` ended inside its JSX
 * tree and Next said "Unexpected token `div`. Expected jsx identifier" — which
 * names a perfectly ordinary tag and reads as though the tag were the problem.
 * It is what SWC says when an element is never closed.
 *
 * So the file itself is asked instead of the response around it: a source file
 * whose brackets do not close, or which ends inside a string or a comment, did
 * not finish arriving. Nothing here parses the language — it only counts, which
 * is enough to tell "cut off" from "complete" and cannot be fooled by a model
 * reporting the wrong finish reason.
 */
import type { GeneratedFile } from './parse';

/** Files whose structure this can judge. Anything else is left alone. */
const CHECKABLE = /\.(?:tsx?|jsx?|mts|cts|mjs|cjs|json|css|scss)$/;

const OPENERS: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
const CLOSERS = new Set(Object.values(OPENERS));

export type TruncationReason =
  | 'unclosed-bracket'
  | 'unterminated-string'
  | 'unterminated-template'
  | 'unterminated-comment';

export interface Truncation {
  readonly path: string;
  readonly reason: TruncationReason;
  /** What was still open at the end, for a message a person can act on. */
  readonly detail: string;
}

/** Keywords after which a `/` opens a pattern rather than divides. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await',
]);

/**
 * Does a `/` start a regular expression rather than divide?
 *
 * Division follows a value; a pattern follows an operator, a keyword, or the
 * start of an expression. Getting this wrong is why a naive counter reports a
 * finished file as truncated — `/[{(]/` is two unbalanced openers to anything
 * that cannot tell a pattern from arithmetic.
 *
 * It is answered from the last *meaningful* character the scan passed, not by
 * reading backwards through the source. Reading backwards cannot see that text
 * is a comment: a line ending `/g, // JWT` made the next line's pattern look as
 * though it followed the value `JWT`, so the pattern was read as division and
 * the quotes inside its character class became an unterminated string. One file
 * in this repository is written that way, which is how the bug was found.
 */
function startsRegex(source: string, lastMeaningful: number): boolean {
  if (lastMeaningful < 0) return true;

  const char = source[lastMeaningful]!;
  if (/[=(,:[!&|?{};+\-*%<>~^]/.test(char)) return true;

  if (/[A-Za-z_$0-9]/.test(char)) {
    const word = /[A-Za-z_$0-9]+$/.exec(source.slice(0, lastMeaningful + 1))?.[0];
    return word ? REGEX_PRECEDING_KEYWORDS.has(word) : false;
  }

  return false;
}

/** The first sign that a file stopped early, or undefined if it is whole. */
export function truncationOf(file: GeneratedFile): Truncation | undefined {
  /* A binary file's bytes live in storage; there is no text to judge. */
  if (file.binary) return undefined;
  if (!CHECKABLE.test(file.path)) return undefined;

  const source = file.content;
  const stack: { char: string; line: number }[] = [];
  let line = 1;
  /* The last character that was code — never whitespace, never a comment. */
  let lastMeaningful = -1;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    const next = source[i + 1];

    if (char === '\n') {
      line += 1;
      continue;
    }
    if (/\s/.test(char)) continue;

    /* Comments. An unterminated block comment swallowed the rest of the file. */
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      if (end === -1) return undefined; /* A trailing line comment is a complete file. */
      i = end;
      line += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) {
        return { path: file.path, reason: 'unterminated-comment', detail: `a block comment opened on line ${line} is never closed` };
      }
      line += source.slice(i, end).split('\n').length - 1;
      i = end + 1;
      continue;
    }

    /* Strings. */
    if (char === '"' || char === "'") {
      let i2 = i + 1;
      while (i2 < source.length) {
        if (source[i2] === '\\') { i2 += 2; continue; }
        if (source[i2] === char) break;
        /* A newline inside a quoted string is itself the truncation. */
        if (source[i2] === '\n') {
          return { path: file.path, reason: 'unterminated-string', detail: `a string opened on line ${line} is never closed` };
        }
        i2 += 1;
      }
      if (i2 >= source.length) {
        return { path: file.path, reason: 'unterminated-string', detail: `a string opened on line ${line} is never closed` };
      }
      lastMeaningful = i2;
      i = i2;
      continue;
    }

    /* Template literals, which may nest expressions containing more templates. */
    if (char === '`') {
      let i2 = i + 1;
      let closed = false;
      let depth = 0;
      while (i2 < source.length) {
        const c = source[i2]!;
        if (c === '\\') { i2 += 2; continue; }
        if (c === '\n') line += 1;
        if (c === '$' && source[i2 + 1] === '{') { depth += 1; i2 += 2; continue; }
        if (c === '}' && depth > 0) { depth -= 1; i2 += 1; continue; }
        if (c === '`' && depth === 0) { closed = true; break; }
        i2 += 1;
      }
      if (!closed) {
        return { path: file.path, reason: 'unterminated-template', detail: `a template literal opened on line ${line} is never closed` };
      }
      lastMeaningful = i2;
      i = i2;
      continue;
    }

    /* Regular expressions, so a character class cannot be read as a bracket. */
    if (char === '/' && startsRegex(source, lastMeaningful)) {
      let i2 = i + 1;
      let inClass = false;
      let closed = false;
      while (i2 < source.length) {
        const c = source[i2]!;
        if (c === '\\') { i2 += 2; continue; }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { closed = true; break; }
        i2 += 1;
      }
      /* An unclosed one is more likely a division this misread than a truncation. */
      if (closed) { lastMeaningful = i2; i = i2; }
      else lastMeaningful = i;
      continue;
    }

    lastMeaningful = i;

    if (OPENERS[char]) {
      stack.push({ char, line });
      continue;
    }
    if (CLOSERS.has(char)) {
      const open = stack[stack.length - 1];
      /*
       * Only a matching closer pops. A mismatch means this counter has lost
       * track — of JSX text, of a generic, of something — and guessing further
       * would report a complete file as truncated.
       */
      if (open && OPENERS[open.char] === char) stack.pop();
      else return undefined;
    }
  }

  const unclosed = stack[0];
  if (!unclosed) return undefined;

  return {
    path: file.path,
    reason: 'unclosed-bracket',
    detail: `a '${unclosed.char}' opened on line ${unclosed.line} is never closed`,
  };
}

/** Every file in a tree that stopped early. */
export function truncatedFiles(files: readonly GeneratedFile[]): readonly Truncation[] {
  return files.flatMap((file) => {
    const truncation = truncationOf(file);
    return truncation ? [truncation] : [];
  });
}
