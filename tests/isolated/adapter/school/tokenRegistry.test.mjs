import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlTokenRegistry } from '#adapters/persistence/yaml/YamlTokenRegistry.mjs';
import { ITokenRegistry } from '#apps/school/ports/ITokenRegistry.mjs';
import { mintToken, resolveTokenState } from '#domains/school/sessions/tokens.mjs';

const AT = '2026-07-27T10:00:00.000Z';
const SID = 'ses_abc123';

let tmp, registry;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-tokens-'));
  registry = new YamlTokenRegistry({ configService: { getDataDir: () => tmp } });
});

const tokensRoot = () => path.join(tmp, 'apps', 'school', 'tokens');
const seededRng = (seed = 1) => {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
};
// One shared stream, so every mint in a test yields a distinct token.
let rng = seededRng(1);
beforeEach(() => { rng = seededRng(1); });
const mint = (over = {}) => mintToken({
  tokenClass: 'issue_document', subject: { sessionId: SID }, at: AT, rng, ...over,
});

describe('construction', () => {
  it('extends its port (decision D7)', () => {
    expect(registry).toBeInstanceOf(ITokenRegistry);
  });

  it('requires a configService', () => {
    expect(() => new YamlTokenRegistry({})).toThrow(/configService/);
  });
});

describe('put / get', () => {
  it('round-trips a minted record', async () => {
    const record = mint();
    expect(await registry.put(record)).toEqual(record);
    expect(await registry.get(record.token)).toEqual(record);
  });

  it('strips the sch: prefix out of the filename — a colon is not a path segment', async () => {
    const record = mint();
    await registry.put(record);
    const body = record.token.slice('sch:'.length);
    expect(fs.readdirSync(tokensRoot())).toEqual([`${body}.yml`]);
  });

  it('resolves a scan with or without the prefix, and with scanner whitespace', async () => {
    const record = mint();
    await registry.put(record);
    const body = record.token.slice('sch:'.length);
    expect((await registry.get(body)).token).toBe(record.token);
    expect((await registry.get(` ${record.token}\r\n`)).token).toBe(record.token);
  });

  it('returns null for an unknown token — the caller prints an explanation slip', async () => {
    expect(await registry.get('sch:ZZZZZZZZZZZZZZZZ')).toBe(null);
  });

  it('returns null rather than resolving a path for a traversal attempt', async () => {
    fs.mkdirSync(tokensRoot(), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'apps', 'school', 'secret.yml'), 'token: leaked\n');
    expect(await registry.get('sch:../secret')).toBe(null);
    expect(await registry.get('../secret')).toBe(null);
    expect(await registry.get('sch:a/b')).toBe(null);
    expect(await registry.get('sch:.')).toBe(null);
  });

  it.each([null, undefined, 7, {}, '', 'sch:'])('returns null for the malformed token %s', async (token) => {
    expect(await registry.get(token)).toBe(null);
  });

  it('rejects a put whose token is not a school token', async () => {
    await expect(registry.put({ ...mint(), token: 'plex:1234' })).rejects.toThrow(/token/);
    await expect(registry.put(null)).rejects.toThrow(/record/);
  });

  it('returns null for a corrupt record file instead of throwing', async () => {
    const record = mint();
    await registry.put(record);
    fs.writeFileSync(path.join(tokensRoot(), `${record.token.slice(4)}.yml`), '{{ not yaml\n');
    expect(await registry.get(record.token)).toBe(null);
  });

  it('a corrupt record isolates to itself', async () => {
    const bad = mint();
    const good = mint();
    await registry.put(bad);
    await registry.put(good);
    fs.writeFileSync(path.join(tokensRoot(), `${bad.token.slice(4)}.yml`), ': :\n- [\n');
    expect(await registry.get(bad.token)).toBe(null);
    expect(await registry.get(good.token)).toEqual(good);
  });

  it('overwrites a re-put of the same token rather than duplicating it', async () => {
    const record = mint();
    await registry.put(record);
    await registry.put({ ...record, expiresAt: '2026-07-28T00:00:00.000Z' });
    expect(fs.readdirSync(tokensRoot())).toHaveLength(1);
    expect((await registry.get(record.token)).expiresAt).toBe('2026-07-28T00:00:00.000Z');
  });
});

describe('revoke', () => {
  it('stamps revokedAt and keeps the record for the audit trail', async () => {
    const record = mint();
    await registry.put(record);
    const revoked = await registry.revoke(record.token, { at: '2026-07-27T12:00:00.000Z' });
    expect(revoked.revokedAt).toBe('2026-07-27T12:00:00.000Z');
    expect((await registry.get(record.token)).revokedAt).toBe('2026-07-27T12:00:00.000Z');
    expect(fs.existsSync(path.join(tokensRoot(), `${record.token.slice(4)}.yml`))).toBe(true);
  });

  it('makes the domain resolve the token as expired', async () => {
    const record = mint();
    await registry.put(record);
    await registry.revoke(record.token, { at: AT });
    const stored = await registry.get(record.token);
    expect(resolveTokenState(stored, { sessionState: { state: 'created', terminal: false }, now: AT }).status)
      .toBe('expired');
  });

  it('returns null for an unknown token', async () => {
    expect(await registry.revoke('sch:ZZZZZZZZZZZZZZZZ', { at: AT })).toBe(null);
  });

  it('requires a revocation time — the adapter reads no clock of its own', async () => {
    const record = mint();
    await registry.put(record);
    await expect(registry.revoke(record.token, {})).rejects.toThrow(/at/);
  });

  it('is idempotent: re-revoking keeps the first revocation time', async () => {
    const record = mint();
    await registry.put(record);
    await registry.revoke(record.token, { at: AT });
    const again = await registry.revoke(record.token, { at: '2026-07-27T23:00:00.000Z' });
    expect(again.revokedAt).toBe(AT);
  });
});
