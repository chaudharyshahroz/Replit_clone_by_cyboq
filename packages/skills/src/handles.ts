/**
 * Skill handles (spec §41).
 *
 * A handle is how a skill is invoked: `@research-analyst`. It is typed by
 * users, appears in shared conversations, and is unique per workspace, so it
 * needs a narrow, predictable shape rather than whatever someone pastes.
 */
import { errors } from '@reklu/shared';

export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const MAX_HANDLE_LENGTH = 40;

/**
 * Handles that would collide with Reklu's own vocabulary or read as a system
 * authority the skill does not have. `@system` in a conversation should never
 * be ambiguous about who is speaking.
 */
const RESERVED = new Set([
  'system', 'reklu', 'admin', 'root', 'assistant', 'user', 'model',
  'me', 'all', 'here', 'everyone', 'channel', 'new', 'edit', 'delete',
  'settings', 'api', 'help', 'null', 'undefined',
]);

/** Derive a usable handle from a display name. */
export function toHandle(raw: string): string {
  const cleaned = raw
    .normalize('NFKD')
    // Combining marks are not letters; leaving them turns every accented
    // character into a separator (the bug already fixed in repo naming).
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_HANDLE_LENGTH);

  // Truncation can leave a trailing separator, which the pattern rejects.
  return cleaned.replace(/-+$/, '') || 'skill';
}

/** Why a handle is unusable, or undefined when it is fine. */
export function handleProblem(handle: string): string | undefined {
  if (handle.length < 3) return 'A handle needs at least 3 characters.';
  if (handle.length > MAX_HANDLE_LENGTH) {
    return `A handle can be at most ${MAX_HANDLE_LENGTH} characters.`;
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return 'Use lowercase letters, numbers and hyphens, starting and ending with a letter or number.';
  }
  if (RESERVED.has(handle)) return `"${handle}" is reserved. Choose another handle.`;
  return undefined;
}

export function assertUsableHandle(handle: string): string {
  const problem = handleProblem(handle);
  if (problem) throw errors.validation(problem, { handle: [problem] });
  return handle;
}

/**
 * Mentions in a message, in order, without duplicates.
 *
 * Deliberately conservative about what counts: an email address contains an
 * `@` and must not be read as a skill invocation, and neither must a handle
 * inside a fenced code block, which is content the user is discussing rather
 * than a command they are issuing.
 */
export function parseMentions(message: string): string[] {
  // Remove fenced and inline code before looking for mentions.
  const withoutCode = message
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');

  const found: string[] = [];
  // Preceded by start-of-string or whitespace — never by a word character,
  // which is what keeps `user@example.com` out.
  const pattern = /(^|\s)@([a-z0-9][a-z0-9-]{1,38}[a-z0-9])\b/g;

  for (const match of withoutCode.matchAll(pattern)) {
    const handle = match[2]!;
    if (!found.includes(handle)) found.push(handle);
  }
  return found;
}

/** Remove the invocation from the message the model is asked to act on. */
export function stripMention(message: string, handle: string): string {
  return message
    .replace(new RegExp(`(^|\\s)@${handle}\\b`, 'g'), '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
