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

  it('exposes the chip id from the token so renewal can address the existing chip', () => {
    const chipId = '0f5a1c3d-1111-2222-3333-444455556666';
    const body = Buffer.from(JSON.stringify({ exp: 2_000, chip: { id: chipId } })).toString('base64url');
    const provider = new LibbyCredentialProvider({
      filePath: '/auth/libby.yml', now: () => 1_000_000,
      stat: () => ({ ino: 7, size: 1, mtimeMs: 1 }),
      load: () => ({ token: `eyJhbGciOiJSUzI1NiJ9.${body}.signature` }),
    });
    expect(provider.getSnapshot().chipId).toBe(chipId);
  });

  it('persists a renewed token atomically, preserving operator comments', async () => {
    const next = token(3_000, 'renewed');
    const writes = [];
    let stored = { token: token(2_000, 'current') };
    let generation = 1;
    const provider = new LibbyCredentialProvider({
      filePath: '/auth/libby.yml', now: () => 1_000_000,
      stat: () => ({ ino: 7, size: generation, mtimeMs: generation }),
      load: () => stored,
      readText: () => `# keep me\ntoken: ${stored.token}\n`,
      writeAtomic: (p, contents) => {
        writes.push([p, contents]);
        generation += 1;
        stored = { token: next };
      },
    });

    await provider.persist(next);

    expect(writes).toEqual([['/auth/libby.yml', `# keep me\ntoken: ${next}\n`]]);
    expect(provider.getSnapshot().token).toBe(next);
  });

  it('surfaces an unreadable credential file instead of overwriting it', async () => {
    const provider = new LibbyCredentialProvider({
      filePath: '/auth/libby.yml', now: () => 1_000_000,
      stat: () => ({ ino: 7, size: 1, mtimeMs: 1 }),
      load: () => ({ token: token(2_000) }),
      readText: () => { const error = new Error('permission denied'); error.code = 'EACCES'; throw error; },
      writeAtomic: () => { throw new Error('must not write over an unreadable file'); },
    });

    await expect(provider.persist(token(3_000))).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('refuses to persist a token that is malformed or already expired', async () => {
    const provider = new LibbyCredentialProvider({
      filePath: '/auth/libby.yml', now: () => 1_000_000,
      stat: () => ({ ino: 7, size: 1, mtimeMs: 1 }),
      load: () => ({ token: token(2_000) }),
      readText: () => 'token: x\n',
      writeAtomic: () => { throw new Error('must not write'); },
    });

    await expect(provider.persist('not-a-jwt')).rejects.toThrow(/refused/i);
    await expect(provider.persist(token(999))).rejects.toThrow(/refused/i);
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
