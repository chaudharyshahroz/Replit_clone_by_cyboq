import { describe, expect, it } from 'vitest';
import { createLogger, redact } from '../logger';

function capture() {
  const lines: string[] = [];
  const log = createLogger({
    level: 'trace',
    format: 'json',
    sink: (line) => lines.push(line),
  });
  return { log, lines, joined: () => lines.join('\n') };
}

describe('redact', () => {
  it('replaces values under sensitive key names', () => {
    const out = redact({
      apiKey: 'super-secret',
      api_key: 'super-secret',
      password: 'hunter2',
      authorization: 'Basic abc',
      clientSecret: 'shh',
      safe: 'visible',
    }) as Record<string, unknown>;

    expect(out.apiKey).toBe('[redacted]');
    expect(out.api_key).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.clientSecret).toBe('[redacted]');
    expect(out.safe).toBe('visible');
  });

  it('redacts secret-shaped values even under innocent key names', () => {
    const out = redact({
      note: 'the key is sk-ant-api03-AAAAAAAAAAAAAAAAAAAA and it works',
      repo: 'token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAA here',
      db: 'postgresql://user:pw@host:5432/db',
    }) as Record<string, string>;

    expect(out.note).toContain('[redacted]');
    expect(out.note).not.toContain('sk-ant-api03');
    expect(out.repo).not.toContain('ghp_');
    expect(out.db).not.toContain('pw@host');
  });

  it('redacts nested structures', () => {
    const out = redact({ a: { b: { c: { token: 'x' } } } }) as any;
    expect(out.a.b.c.token).toBe('[redacted]');
  });

  it('survives circular references', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
    expect(JSON.stringify(redact(cyclic))).toContain('[circular]');
  });

  it('caps depth rather than recursing without bound', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 30; i++) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain('[max depth]');
  });

  it('serializes Errors including cause', () => {
    const out = redact(new Error('outer', { cause: new Error('inner') })) as any;
    expect(out.name).toBe('Error');
    expect(out.message).toBe('outer');
    expect(out.cause.message).toBe('inner');
  });

  it('truncates very long strings', () => {
    const out = redact('x'.repeat(10_000)) as string;
    expect(out.length).toBeLessThan(4_100);
    expect(out).toContain('[truncated]');
  });
});

describe('logger', () => {
  it('honours the level threshold', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', format: 'json', sink: (l) => lines.push(l) });
    log.debug('hidden');
    log.info('hidden');
    log.warn('shown');
    log.error('shown');
    expect(lines).toHaveLength(2);
  });

  it('redacts fields and message text', () => {
    const { log, joined } = capture();
    log.info('connecting with sk-ant-api03-AAAAAAAAAAAAAAAAAAAA', { apiKey: 'leak-me' });
    expect(joined()).not.toContain('leak-me');
    expect(joined()).not.toContain('sk-ant-api03');
  });

  it('stamps child bindings onto every record', () => {
    const { log, joined } = capture();
    log.child({ requestId: 'req_1', workspaceId: 'wsp_1' }).info('handled');
    const record = JSON.parse(joined());
    expect(record.requestId).toBe('req_1');
    expect(record.workspaceId).toBe('wsp_1');
  });

  it('merges nested child bindings', () => {
    const { log, joined } = capture();
    log.child({ a: 1 }).child({ b: 2 }).info('x');
    const record = JSON.parse(joined());
    expect(record.a).toBe(1);
    expect(record.b).toBe(2);
  });

  it('emits parseable JSON with time, level and msg', () => {
    const { log, joined } = capture();
    log.error('boom', { code: 'X' });
    const record = JSON.parse(joined());
    expect(record.level).toBe('error');
    expect(record.msg).toBe('boom');
    expect(record.code).toBe('X');
    expect(() => new Date(record.time)).not.toThrow();
  });

  it('does not throw on unserializable payloads', () => {
    const { log } = capture();
    const bad = { toJSON() { throw new Error('nope'); } };
    expect(() => log.info('m', { bad })).not.toThrow();
  });
});
