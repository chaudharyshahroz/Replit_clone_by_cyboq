/**
 * Talking to an MCP server over HTTP (spec §46, §49).
 *
 * An MCP endpoint is a URL a *user* supplies, which makes every request Reklu
 * makes on their behalf a potential SSRF: `http://169.254.169.254/` reaches a
 * cloud metadata service, `http://localhost:5432` reaches Reklu's own database.
 * So the endpoint goes through the same validate → resolve → re-validate
 * pipeline the research fetcher uses, and it is re-checked on every call
 * rather than once at connection time — DNS answers change.
 *
 * Everything a server sends back is untrusted: tool names, descriptions,
 * schemas, results. Nothing here interprets any of it as instruction.
 */
import { resolveSafeAddress } from '@reklu/research';
import { isProduction, logger } from '@reklu/shared';

export class McpError extends Error {
  readonly code: 'UNREACHABLE' | 'PROTOCOL' | 'BLOCKED' | 'TIMEOUT' | 'SERVER_ERROR';

  constructor(code: McpError['code'], message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'McpError';
    this.code = code;
  }
}

/** A tool exactly as the server described it. Untrusted. */
export interface DiscoveredTool {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema?: Record<string, unknown> | undefined;
  readonly annotations?:
    | { readOnlyHint?: boolean | undefined; destructiveHint?: boolean | undefined }
    | undefined;
}

const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 20_000;

/** Caps on what a server may return, so one cannot exhaust memory. */
const MAX_TOOLS = 200;
const MAX_RESPONSE_BYTES = 2 * 1_048_576;

interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { code?: number; message?: string };
}

export interface McpClientOptions {
  readonly endpoint: string;
  /** Sent as `Authorization`. Never logged. */
  readonly credential?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * Validate the endpoint against SSRF rules, every time.
 *
 * Checking once at connection time would leave a server free to re-point its
 * hostname at an internal address afterwards.
 */
/** Loopback only — never link-local, never a private range. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function safeEndpoint(endpoint: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new McpError('BLOCKED', 'That endpoint is not a valid URL.');
  }

  /**
   * Development runs MCP servers on loopback, so that one case is exempt —
   * and *only* that one.
   *
   * The obvious shortcut here is `allowInsecureLocal: !isProduction()`, which
   * is what this originally did and was wrong: that flag also opens
   * link-local and private ranges, so `http://169.254.169.254/` — the cloud
   * metadata endpoint — was reachable in development. On a developer's laptop
   * that address is unroutable and the mistake is invisible; on any cloud VM
   * it is credential disclosure. Loopback is the actual requirement, so
   * loopback is the actual exemption.
   */
  if (!isProduction() && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return url;
  }

  try {
    // Validates the shape, resolves DNS, then re-validates the resolved
    // address. Production rules always — re-resolving separately is the window
    // DNS rebinding exploits.
    const safe = await resolveSafeAddress(endpoint, { allowInsecureLocal: false });
    return safe.url;
  } catch (error) {
    throw new McpError(
      'BLOCKED',
      `That endpoint is not allowed: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}

async function rpc(
  options: McpClientOptions,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const url = await safeEndpoint(options.endpoint);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'User-Agent': 'Reklu/0.1 (+https://reklu.app)',
  };
  if (options.credential) headers.Authorization = options.credential;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      // Reklu follows no redirects here: a redirect is a second destination
      // that never went through the SSRF check.
      redirect: 'manual',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timed out') || message.includes('aborted')) {
      throw new McpError('TIMEOUT', `The server did not respond in time.`, error);
    }
    throw new McpError('UNREACHABLE', `Could not reach the server: ${message}`, error);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new McpError(
      'BLOCKED',
      'The server redirected the request. Reklu does not follow redirects to MCP endpoints.',
    );
  }

  if (!response.ok) {
    throw new McpError('SERVER_ERROR', `The server returned HTTP ${response.status}.`);
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new McpError('PROTOCOL', 'The server returned an unreasonably large response.');
  }

  // Servers may answer as SSE; take the last JSON data frame.
  const payload = text.trimStart().startsWith('event:') || text.includes('\ndata:')
    ? (text.split('\n').filter((line) => line.startsWith('data:')).pop() ?? '').slice(5).trim()
    : text;

  let parsed: JsonRpcResponse;
  try {
    parsed = JSON.parse(payload) as JsonRpcResponse;
  } catch {
    throw new McpError('PROTOCOL', 'The server did not return valid JSON-RPC.');
  }

  if (parsed.error) {
    throw new McpError(
      'SERVER_ERROR',
      `The server refused the call: ${parsed.error.message ?? 'unknown error'}`,
    );
  }

  return parsed.result;
}

/** Handshake, confirming the endpoint speaks MCP at all. */
export async function initialize(options: McpClientOptions): Promise<{ serverName: string }> {
  const result = (await rpc(options, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'Reklu', version: '0.1.0' },
  })) as { serverInfo?: { name?: string } } | undefined;

  return { serverName: result?.serverInfo?.name ?? 'MCP server' };
}

/**
 * List the server's tools.
 *
 * Returned verbatim, without interpretation. Classification and approval
 * happen against these values; nothing here decides they are safe.
 */
export async function listTools(options: McpClientOptions): Promise<DiscoveredTool[]> {
  const result = (await rpc(options, 'tools/list')) as { tools?: unknown } | undefined;

  if (!result || !Array.isArray(result.tools)) {
    throw new McpError('PROTOCOL', 'The server did not return a tool list.');
  }

  const tools: DiscoveredTool[] = [];
  for (const raw of result.tools.slice(0, MAX_TOOLS)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.name !== 'string' || entry.name.length === 0) continue;

    tools.push({
      name: entry.name.slice(0, 200),
      description:
        typeof entry.description === 'string' ? entry.description.slice(0, 4_000) : undefined,
      inputSchema:
        entry.inputSchema && typeof entry.inputSchema === 'object'
          ? (entry.inputSchema as Record<string, unknown>)
          : undefined,
      annotations:
        entry.annotations && typeof entry.annotations === 'object'
          ? (entry.annotations as DiscoveredTool['annotations'])
          : undefined,
    });
  }

  logger.debug('Discovered MCP tools', { count: tools.length });
  return tools;
}

export interface ToolCallResult {
  /** Text content, joined. Always treated as untrusted data downstream. */
  readonly text: string;
  readonly isError: boolean;
}

/**
 * Call a tool.
 *
 * The permission engine decides whether this is allowed; this function does
 * not, and deliberately has no access to the state it would need to.
 */
export async function callTool(
  options: McpClientOptions,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const result = (await rpc(options, 'tools/call', { name, arguments: args })) as
    | { content?: unknown; isError?: boolean }
    | undefined;

  const parts: string[] = [];
  if (Array.isArray(result?.content)) {
    for (const item of result.content) {
      if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
        parts.push((item as { text: string }).text);
      }
    }
  }

  return {
    text: parts.join('\n').slice(0, 100_000),
    isError: result?.isError === true,
  };
}

/** Reachability plus the tool list, for the connect flow. */
export async function probeServer(options: McpClientOptions): Promise<{
  serverName: string;
  tools: DiscoveredTool[];
}> {
  const { serverName } = await initialize(options);
  const tools = await listTools(options);
  return { serverName, tools };
}
