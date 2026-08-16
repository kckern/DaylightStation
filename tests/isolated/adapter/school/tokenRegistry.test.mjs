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
  registry = new YamlTokenRegistry({ configService: { getDataDir: () => tmp, getHouseholdPath: (rel) => `${tmp}/${rel}` } });
});

// getHouseholdPath('school/tokens') resolves to <household>/school/tokens —
// there is no `apps/` segment on household-scoped school data (that layout
// applies only under users/{id}/apps/{app}/).
const tokensRoot = () => path.join(tmp, 'school', 'tokens');
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
    fs.writeFileSync(path.join(tmp, 'school', 'secret.yml'), 'token: leaked\n');
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

describe('claim', () => {
  it('atomically accepts a new opaque meaning and returns the original on retry', async () => {
    const record = mint();
    expect(await registry.claim(record)).toEqual({ status: 'accepted', record });
    const retry = { ...record, issuedAt: '2026-07-27T10:00:01.000Z' };
    expect(await registry.claim(retry)).toEqual({ status: 'duplicate', record });
    expect(await registry.get(record.token)).toEqual(record);
  });

  it('refuses to change what an already printed token means', async () => {
    const record = mint();
    await registry.claim(record);
    const changed = { ...record, subject: { sessionId: 'ses_other' } };
    expect(await registry.claim(changed)).toEqual({ status: 'conflict', record });
    expect(await registry.get(record.token)).toEqual(record);
  });

  it('preserves revocation and first issue time on a semantic duplicate', async () => {
    const record = mint();
    await registry.claim(record);
    const revoked = await registry.revoke(record.token, { at: AT });
    expect(await registry.claim({ ...record, issuedAt: '2099-01-01T00:00:00Z' }))
      .toEqual({ status: 'duplicate', record: revoked });
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

describe('prune', () => {
  // AT is 2026-07-27T10:00Z. A controllable clock: the registry reads ms time
  // through `now`, so tests move time instead of files.
  const NOW_MS = Date.parse('2026-08-10T10:00:00.000Z'); // AT + 14 days
  const DAY = 86_400_000;

  const build = (nowMs, over = {}) => new YamlTokenRegistry({
    configService: { getDataDir: () => tmp, getHouseholdPath: (rel) => `${tmp}/${rel}` }, now: () => nowMs, ...over,
  });

  const fileCount = () => fs.readdirSync(tokensRoot()).length;

  it('removes a record whose expiry is more than the grace period past', async () => {
    // Minted while still live (put() itself sweeps), judged 14 days later.
    const dead = mint({ expiresAt: '2026-07-28T10:00:00.000Z' });
    await build(Date.parse(AT)).put(dead);
    const reg = build(NOW_MS); // now the expiry is 13 days past
    expect(await reg.prune()).toEqual({ removed: 1, kept: 0 });
    expect(await reg.get(dead.token)).toBe(null);
  });

  it('keeps a record still inside the grace window — "out of date" beats "unknown ticket"', async () => {
    const reg = build(NOW_MS);
    const recent = mint({ expiresAt: '2026-08-05T10:00:00.000Z' }); // 5 days past
    await reg.put(recent);
    expect(await reg.prune()).toEqual({ removed: 0, kept: 1 });
    expect(await reg.get(recent.token)).toMatchObject({ token: recent.token });
  });

  it('never touches an unexpiring record', async () => {
    const reg = build(NOW_MS);
    const card = mint({ tokenClass: 'identify', subject: { learnerId: 'kid1' }, expiresAt: null });
    await reg.put(card);
    expect(await reg.prune()).toEqual({ removed: 0, kept: 1 });
  });

  it('leaves a corrupt file alone — deletion needs a legible timestamp', async () => {
    const reg = build(NOW_MS);
    fs.mkdirSync(tokensRoot(), { recursive: true });
    fs.writeFileSync(path.join(tokensRoot(), 'CORRUPTCORRUPT.yml'), '{{{ not yaml');
    expect(await reg.prune()).toEqual({ removed: 0, kept: 1 });
    expect(fileCount()).toBe(1);
  });

  it('reports a clean sweep on a registry that never minted anything', async () => {
    expect(await build(NOW_MS).prune()).toEqual({ removed: 0, kept: 0 });
  });

  it('a mint sweeps opportunistically, but at most once per interval', async () => {
    let nowMs = NOW_MS;
    const reg = build(0, { now: () => nowMs });
    const dead = mint({ expiresAt: '2026-07-28T10:00:00.000Z' });
    await reg.put(dead); // first put: sweeps, but `dead` was just written… and IS long-expired
    // The fresh mint is judged by its own timestamp like everything else —
    // BuildAgenda always mints with a future expiry, so live tickets survive.
    expect(fs.existsSync(tokensRoot())).toBe(true);
    const before = fileCount();

    const live = mint({ expiresAt: '2026-08-20T10:00:00.000Z' });
    await reg.put(live); // within the interval: no second sweep
    expect(fileCount()).toBe(before + 1);

    nowMs += 7 * 3_600_000; // 7h later: past the sweep interval
    const later = mint({ expiresAt: '2026-08-20T10:00:00.000Z' });
    await reg.put(later); // sweep runs now and clears the long-dead record
    expect(await reg.get(dead.token)).toBe(null);
    expect(await reg.get(live.token)).toMatchObject({ token: live.token });
    expect(await reg.get(later.token)).toMatchObject({ token: later.token });
  });

  it('logs what it removed', async () => {
    const events = [];
    const reg = build(NOW_MS, { logger: { info: (e, d) => events.push([e, d]) } });
    await reg.put(mint({ expiresAt: '2026-07-28T10:00:00.000Z' }));
    await reg.prune();
    expect(events).toContainEqual(['school.tokens.pruned', { removed: 1, kept: 0 }]);
  });

  it('a pruned token resolves like any unknown ticket — the explanation-slip path', async () => {
    const reg = build(NOW_MS);
    const dead = mint({ expiresAt: '2026-07-28T10:00:00.000Z' });
    await reg.put(dead);
    await reg.prune();
    // get() → null is exactly what ResolveScanAction turns into the
    // "we do not know that ticket" notice.
    expect(await reg.get(dead.token)).toBe(null);
  });

  it('a custom grace period is honoured', async () => {
    const reg = build(NOW_MS, { pruneGraceMs: 30 * DAY });
    const dead = mint({ expiresAt: '2026-07-28T10:00:00.000Z' }); // 13 days past
    await reg.put(dead);
    expect(await reg.prune()).toEqual({ removed: 0, kept: 1 });
  });
});
