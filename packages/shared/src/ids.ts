/**
 * Identifiers.
 *
 * Reklu uses prefixed, sortable, URL-safe ids rather than bare UUIDs. The prefix
 * makes a stray id in a log or a support ticket self-describing ("which table is
 * `art_...`?"), and makes it impossible to silently pass a project id where a
 * conversation id was expected once the branded types below are used.
 *
 * Format: `<prefix>_<48 bits of time, base36><random>` — lexicographically
 * sortable by creation time, which keeps B-tree index inserts local.
 */
import { customAlphabet } from 'nanoid';

/** Unambiguous alphabet: no look-alike 0/O/I/l. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const RANDOM_LENGTH = 16;
const randomPart = customAlphabet(ALPHABET, RANDOM_LENGTH);

export const ID_PREFIXES = {
  user: 'usr',
  session: 'ses',
  account: 'acc',
  workspace: 'wsp',
  workspaceMember: 'wsm',
  invitation: 'inv',
  project: 'prj',
  projectMember: 'prm',
  projectMemory: 'mem',
  conversation: 'cnv',
  message: 'msg',
  attachment: 'att',
  aiProvider: 'aip',
  aiModel: 'mdl',
  aiRequest: 'req',
  usage: 'usg',
  file: 'fil',
  fileChunk: 'chk',
  artifact: 'art',
  artifactVersion: 'arv',
  research: 'rsh',
  researchSource: 'src',
  researchCitation: 'cit',
  build: 'bld',
  buildVersion: 'blv',
  buildFile: 'blf',
  sandbox: 'sbx',
  repository: 'rep',
  deployment: 'dep',
  connection: 'con',
  credential: 'crd',
  mcpServer: 'mcp',
  mcpTool: 'mct',
  toolExecution: 'tex',
  skill: 'skl',
  skillVersion: 'skv',
  skillInstall: 'ski',
  agentRun: 'agr',
  agentStep: 'ags',
  agentApproval: 'aga',
  plan: 'pln',
  subscription: 'sub',
  payment: 'pay',
  job: 'job',
  notification: 'ntf',
  activity: 'act',
  auditLog: 'aud',
  featureFlag: 'flg',
  webhookDelivery: 'whd',
  buildEvent: 'bev',
  publication: 'pub',
  waitlistSignup: 'wls',
} as const;

export type IdPrefixKey = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdPrefixKey];

/**
 * Branded id types. `Id<'project'>` is not assignable to `Id<'conversation'>`,
 * so mixing them up is a compile error rather than a 404 in production.
 */
export type Id<K extends IdPrefixKey> = string & { readonly __idBrand: K };

const EPOCH = 1_700_000_000_000; // 2023-11-14; keeps the time component compact.

/** Generate a new prefixed, time-sortable id. */
export function newId<K extends IdPrefixKey>(kind: K): Id<K> {
  const elapsed = Math.max(0, Date.now() - EPOCH);
  const time = elapsed.toString(32).padStart(9, '0');
  return `${ID_PREFIXES[kind]}_${time}${randomPart()}` as Id<K>;
}

/**
 * Structural shape of an id.
 *
 * Note the two halves use different alphabets: the time prefix is
 * `Number.prototype.toString(32)`, whose digits are `0-9a-v` (and so may include
 * i/l/o/u), while the random suffix uses the reduced look-alike-free ALPHABET.
 * Validating against the narrow alphabet alone would intermittently reject
 * perfectly valid ids depending on the wall clock.
 */
const ID_SHAPE = new RegExp(`^[a-z]{3}_[0-9a-z]{${9 + RANDOM_LENGTH}}$`);

/** Structural check plus prefix check. Use at trust boundaries. */
export function isId<K extends IdPrefixKey>(kind: K, value: unknown): value is Id<K> {
  return (
    typeof value === 'string' && value.startsWith(`${ID_PREFIXES[kind]}_`) && ID_SHAPE.test(value)
  );
}

/**
 * Narrow an untrusted string to a typed id, or return undefined. Callers should
 * turn `undefined` into a 404 rather than a 400 — a malformed id and a
 * non-existent one should be indistinguishable to an unauthorized caller.
 */
export function parseId<K extends IdPrefixKey>(kind: K, value: unknown): Id<K> | undefined {
  return isId(kind, value) ? value : undefined;
}

/** Approximate creation time encoded in an id. Useful for debugging only. */
export function idCreatedAt(id: string): Date | undefined {
  const underscore = id.indexOf('_');
  if (underscore === -1) return undefined;
  const time = id.slice(underscore + 1, underscore + 10);
  const elapsed = parseInt(time, 32);
  return Number.isFinite(elapsed) ? new Date(EPOCH + elapsed) : undefined;
}

/**
 * A short, human-friendly slug derived from a title. Used for project and
 * artifact URLs. Always returns something non-empty.
 */
export function slugify(input: string, maxLength = 60): string {
  const base = input
    .normalize('NFKD')
    // Drop combining diacritics left behind by NFKD, so "Café" -> "cafe".
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Collapse every run of non-alphanumerics into a single hyphen.
    .replace(/[^a-z0-9]+/g, '-')
    // Trim leading/trailing hyphens produced by the collapse above.
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    // The slice may have landed mid-separator; trim again.
    .replace(/-+$/g, '');
  return base.length > 0 ? base : 'untitled';
}
