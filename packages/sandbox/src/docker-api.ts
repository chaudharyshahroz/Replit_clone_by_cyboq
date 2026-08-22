/**
 * A small client for Docker's Engine API.
 *
 * Spoken directly over HTTP rather than by shelling out to the `docker` CLI.
 * The CLI would have to exist inside Reklu's own container, and every call
 * would be a shell command assembled from generated file paths — a place where
 * a quoting mistake becomes command injection. The HTTP API takes structured
 * JSON and needs no shell at all.
 *
 * Engine API reference: https://docs.docker.com/reference/api/engine/
 */
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DockerTarget {
  /** unix:///var/run/docker.sock, tcp://host:2376, https://host:2376 */
  readonly host: string;
}

interface Endpoint {
  readonly socketPath?: string;
  readonly hostname?: string;
  readonly port?: number;
  readonly tls: boolean;
}

/**
 * Where the daemon is, from the configured host string.
 *
 * `tcp://` is Docker's own spelling and means TLS on 2376 by convention and
 * plaintext on 2375. Resolved here rather than guessed at call time, so an
 * unencrypted remote daemon is a visible decision.
 */
export function parseDockerHost(host: string): Endpoint {
  if (host.startsWith('unix://')) {
    return { socketPath: host.slice('unix://'.length), tls: false };
  }

  const url = new URL(host.replace(/^tcp:\/\//, 'http://'));
  const port = url.port ? Number(url.port) : 2375;

  return {
    hostname: url.hostname,
    port,
    // 2376 is Docker's TLS port; an explicit https:// scheme says the same.
    tls: host.startsWith('https://') || port === 2376,
  };
}

/** Client certificates, if the standard Docker variables point at them. */
function clientCertificates(): { cert?: Buffer; key?: Buffer; ca?: Buffer } {
  const certPath = process.env.DOCKER_CERT_PATH;
  if (!certPath) return {};

  try {
    return {
      cert: readFileSync(join(certPath, 'cert.pem')),
      key: readFileSync(join(certPath, 'key.pem')),
      ca: readFileSync(join(certPath, 'ca.pem')),
    };
  } catch {
    // Reported by the caller's first request failing, with Docker's own error.
    return {};
  }
}

export interface DockerResponse {
  readonly status: number;
  readonly body: Buffer;
}

export class DockerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DockerError';
  }
}

/** One request to the daemon. Returns the raw body; callers decide how to read it. */
export function dockerRequest(
  target: DockerTarget,
  method: string,
  path: string,
  options: {
    readonly json?: unknown;
    readonly body?: Buffer;
    readonly contentType?: string;
    readonly timeoutMs?: number;
  } = {},
): Promise<DockerResponse> {
  const endpoint = parseDockerHost(target.host);
  const payload = options.json !== undefined ? Buffer.from(JSON.stringify(options.json)) : options.body;

  const requestOptions: RequestOptions = {
    method,
    path,
    headers: {
      Host: 'docker',
      ...(payload
        ? {
            'Content-Type': options.contentType ?? 'application/json',
            'Content-Length': String(payload.length),
          }
        : {}),
    },
    ...(endpoint.socketPath
      ? { socketPath: endpoint.socketPath }
      : { hostname: endpoint.hostname, port: endpoint.port }),
    ...(endpoint.tls ? clientCertificates() : {}),
  };

  const send = endpoint.tls ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = send(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const status = res.statusCode ?? 0;

        if (status >= 400) {
          let detail = body.toString('utf8').slice(0, 500);
          try {
            const parsed = JSON.parse(detail) as { message?: string };
            if (parsed.message) detail = parsed.message;
          } catch {
            // Not JSON. The raw text is what there is.
          }
          reject(new DockerError(status, detail || `Docker returned ${status}`));
          return;
        }

        resolve({ status, body });
      });
    });

    req.setTimeout(options.timeoutMs ?? 120_000, () => {
      req.destroy(new Error(`Docker did not answer ${method} ${path} in time`));
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Split Docker's multiplexed stream into stdout and stderr.
 *
 * With no TTY the daemon interleaves both on one connection, each chunk behind
 * an eight-byte header: one byte of stream type, three reserved, then a
 * big-endian length. Reading the stream without demultiplexing leaves those
 * header bytes embedded in the output, which shows up as corrupted characters
 * scattered through a build log.
 */
export function demultiplex(buffer: Buffer): { stdout: string; stderr: string } {
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const stream = buffer[offset];
    const length = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = Math.min(start + length, buffer.length);

    /*
     * A frame header always has zero in its three reserved bytes and a stream
     * type of 0, 1 or 2. Anything else means this is not a multiplexed stream —
     * some daemon configurations return raw output — and the right move is to
     * treat the whole buffer as stdout rather than slice it up as frames.
     */
    const looksFramed =
      (stream === 0 || stream === 1 || stream === 2) &&
      buffer[offset + 1] === 0 &&
      buffer[offset + 2] === 0 &&
      buffer[offset + 3] === 0;

    if (!looksFramed) {
      return { stdout: buffer.subarray(offset).toString('utf8'), stderr: '' };
    }

    (stream === 2 ? err : out).push(buffer.subarray(start, end));
    offset = end;
  }

  return {
    stdout: Buffer.concat(out).toString('utf8'),
    stderr: Buffer.concat(err).toString('utf8'),
  };
}
