/**
 * A minimal tar writer and reader.
 *
 * Docker's Engine API moves files in and out of containers as tar streams and
 * offers no other route, so this is the price of talking to it directly rather
 * than shelling out to the `docker` CLI — which would mean the CLI has to exist
 * inside Reklu's own container, and a shell command built from generated file
 * paths.
 *
 * Only what that needs: regular files and directories, ustar format. No
 * symlinks, no devices, no sparse files — none of which a generated project
 * should contain, and each of which is a way to write outside the destination.
 */

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;

export interface TarEntry {
  readonly path: string;
  readonly content: string;
  /** Octal file mode. Defaults to 0644 — never executable unless asked. */
  readonly mode?: number;
}

export interface TarOptions {
  /**
   * Who owns the extracted files.
   *
   * Docker's archive endpoint honours the uid and gid in the tar header, so
   * this is not cosmetic: a container running as an unprivileged user cannot
   * write into a tree it does not own, and `npm install` fails with EACCES on
   * a directory it can see perfectly well. Defaults to root, which is correct
   * for an archive nobody unpacks as another user.
   */
  readonly uid?: number;
  readonly gid?: number;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

/**
 * Split a path across tar's `name` and `prefix` fields.
 *
 * ustar stores at most 100 bytes of name plus 155 of prefix, joined by a slash.
 * A path that fits neither is rejected rather than silently truncated — a
 * truncated path writes a file somewhere nobody expects.
 */
function splitPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= NAME_MAX) return { name: path, prefix: '' };

  const parts = path.split('/');
  let prefix = '';
  let name = parts.pop() ?? '';

  while (parts.length > 0 && Buffer.byteLength(name) <= NAME_MAX) {
    const candidate = parts.join('/');
    if (Buffer.byteLength(candidate) <= PREFIX_MAX) {
      prefix = candidate;
      break;
    }
    name = `${parts.pop()}/${name}`;
  }

  if (Buffer.byteLength(name) > NAME_MAX || Buffer.byteLength(prefix) > PREFIX_MAX) {
    throw new Error(`Path is too long for a tar archive: ${path}`);
  }

  return { name, prefix };
}

function header(entry: {
  path: string;
  size: number;
  mode: number;
  type: '0' | '5';
  uid: number;
  gid: number;
}): Buffer {
  const block = Buffer.alloc(BLOCK);
  const { name, prefix } = splitPath(entry.path);

  block.write(name, 0, NAME_MAX, 'utf8');
  block.write(octal(entry.mode, 8), 100, 8, 'utf8');
  block.write(octal(entry.uid, 8), 108, 8, 'utf8');
  block.write(octal(entry.gid, 8), 116, 8, 'utf8');
  block.write(octal(entry.size, 12), 124, 12, 'utf8');
  block.write(octal(Math.floor(Date.now() / 1000), 12), 136, 12, 'utf8');
  block.write('        ', 148, 8, 'utf8'); // checksum placeholder: eight spaces
  block.write(entry.type, 156, 1, 'utf8');
  block.write('ustar\0', 257, 6, 'utf8');
  block.write('00', 263, 2, 'utf8');
  block.write(prefix, 345, PREFIX_MAX, 'utf8');

  /*
   * The checksum is the sum of every header byte with the checksum field itself
   * read as spaces — which is why the placeholder above is written first.
   */
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');

  return block;
}

function pad(size: number): Buffer {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

/** Every directory an entry needs, deepest last, so tar creates them in order. */
function directoriesFor(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      seen.add(current);
    }
  }
  return [...seen].sort();
}

/** Pack files into a tar archive. */
export function createTar(entries: readonly TarEntry[], options: TarOptions = {}): Buffer {
  const blocks: Buffer[] = [];
  const uid = options.uid ?? 0;
  const gid = options.gid ?? 0;

  for (const dir of directoriesFor(entries.map((entry) => entry.path))) {
    blocks.push(header({ path: `${dir}/`, size: 0, mode: 0o755, type: '5', uid, gid }));
  }

  for (const entry of entries) {
    const content = Buffer.from(entry.content, 'utf8');
    blocks.push(
      header({
        path: entry.path,
        size: content.length,
        mode: entry.mode ?? 0o644,
        type: '0',
        uid,
        gid,
      }),
    );
    blocks.push(content, pad(content.length));
  }

  // Two zero blocks mark the end of the archive.
  blocks.push(Buffer.alloc(BLOCK * 2));

  return Buffer.concat(blocks);
}

export interface ExtractedFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Unpack a tar archive.
 *
 * Directories and anything that is not a regular file are skipped: this reads
 * back what a build produced, and a symlink or device node in that stream is
 * not something to reconstruct.
 */
export function extractTar(buffer: Buffer): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  let offset = 0;

  while (offset + BLOCK <= buffer.length) {
    const block = buffer.subarray(offset, offset + BLOCK);

    // A zero block ends the archive.
    if (block.every((byte) => byte === 0)) break;

    const readField = (start: number, length: number): string =>
      block.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim();

    const name = readField(0, NAME_MAX);
    const prefix = readField(345, PREFIX_MAX);
    const size = Number.parseInt(readField(124, 12) || '0', 8) || 0;
    const type = block.subarray(156, 157).toString('utf8');

    offset += BLOCK;

    if (type === '0' || type === '\0' || type === '') {
      const content = buffer.subarray(offset, offset + size).toString('utf8');
      files.push({ path: prefix ? `${prefix}/${name}` : name, content });
    }

    offset += size + (size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK));
  }

  return files;
}
