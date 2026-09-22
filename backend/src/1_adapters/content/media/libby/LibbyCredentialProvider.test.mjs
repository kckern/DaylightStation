import { describe, expect, it, vi } from 'vitest';
import { LibbyCredentialProvider } from './LibbyCredentialProvider.mjs';

function token(exp, marker = 'a') {
  const body = Buffer.from(JSON.stringify({ exp, marker })).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${body}.signature`;
}

describe('LibbyCredentialProvider', () => {
  it('rotates atomically and retains the last valid token across a partial YAML write', () => {
    let generation = 1;
    const firstToken = token(2_000, 'first');
    const secondToken = token(3_000, 'second');
    let body = { token: firstToken };
    const provider = new LibbyCredentialProvider({
      filePath: '/auth/libby.yml',
      now: () => 1_000_000,
      stat: () => ({ ino: 7, size: generation, mtimeMs: generation }),
      load: () => {
        if (body instanceof Error) throw body;
        return body;
      },
    });

    expect(provider.getSnapshot().token).toBe(firstToken);
    generation = 2;
    body = new Error('partial yaml');
    expect(provider.getSnapshot().token).toBe(firstToken);
    generation = 3;
    body = { token: secondToken };
    expect(provider.getSnapshot().token).toBe(secondToken);
  });

  it('does not retain a last-known-good token past its JWT expiry', () => {
    let now = 1_000_000;
    let broken = false;
    const provider = new LibbyCredentialProvider({
      filePath: '/auth/libby.yml', now: () => now,
      stat: () => ({ ino: 7, size: broken ? 2 : 1, mtimeMs: broken ? 2 : 1 }),
      load: () => broken ? (() => { throw new Error('partial'); })() : ({ token: token(1_001) }),
    });
    expect(provider.getSnapshot().token).toBeTruthy();
    broken = true;
    now = 1_002_000;
    expect(() => provider.getSnapshot()).toThrow(/credential unavailable/i);
  });

  it('rejects a parseable partial JWT and keeps the old token only until expiry', () => {
    let now = 1_000_000;
    let generation = 1;
    const firstToken = token(1_001);
    let body = { token: firstToken };
    const provider = new LibbyCredentialProvider({
      filePath: '/auth/libby.yml', now: () => now,
      stat: () => ({ ino: 7, size: generation, mtimeMs: generation }),
      load: () => body,
    });
    expect(provider.getSnapshot().token).toBe(firstToken);
    generation = 2;
    body = { token: firstToken.split('.').slice(0, 2).join('.') };
    expect(provider.getSnapshot().token).toBe(firstToken);
    now = 1_002_000;
    expect(() => provider.getSnapshot()).toThrow(/credential unavailable/i);
  });

  it('never includes token material in warnings', () => {
    const secret = token(2_000, 'secret-marker');
    const logger = { warn: vi.fn() };
    let fail = false;
    const provider = new LibbyCredentialProvider({
      filePath: '/auth/libby.yml', now: () => 1_000_000, logger,
      stat: () => ({ ino: 7, size: fail ? 2 : 1, mtimeMs: fail ? 2 : 1 }),
      load: () => fail ? (() => { throw new Error(`bad ${secret}`); })() : ({ token: secret }),
    });
    provider.getSnapshot();
    fail = true;
    provider.getSnapshot();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret-marker');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(secret);
  });
});
