import { describe, it, expect, vi } from 'vitest';
import { DataServiceAuthSessionStore } from './DataServiceAuthSessionStore.mjs';

function store({ now = '2026-09-11T10:00:00.000Z' } = {}) {
  let file = null;
  let clockValue = new Date(now);
  let n = 0;
  const dataService = {
    system: { read: () => file, write: (_path, value) => { file = structuredClone(value); } },
  };
  const s = new DataServiceAuthSessionStore({
    dataService,
    clock: () => clockValue,
    idFn: () => `sid-${++n}`,
    logger: { info: vi.fn(), warn: vi.fn() },
  });
  return { s, advance: ms => { clockValue = new Date(clockValue.getTime() + ms); }, file: () => file };
}

describe('DataServiceAuthSessionStore', () => {
  it('makes a session active, and revoking it makes it not', () => {
    const { s } = store();
    const { id } = s.create({ username: 'kckern' });
    expect(s.isActive(id)).toBe(true);
    expect(s.revoke(id)).toBe(true);
    // The whole point: the JWT is configured for ten years, so this record is
    // the only thing that can end a session.
    expect(s.isActive(id)).toBe(false);
  });

  it('never writes the token — a readable backup grants nobody anything', () => {
    const { s, file } = store();
    s.create({ username: 'kckern', userAgent: 'Mozilla/5.0', ip: '10.0.0.5' });
    const serialized = JSON.stringify(file());
    expect(serialized).not.toMatch(/eyJ/);        // no JWT
    expect(serialized).toContain('kckern');
    expect(serialized).toContain('10.0.0.5');
  });

  it('reports an unknown or absent id as inactive rather than throwing', () => {
    const { s } = store();
    expect(s.isActive('never-existed')).toBe(false);
    expect(s.isActive(null)).toBe(false);
    expect(s.revoke('never-existed')).toBe(false);
  });

  it('throttles last-seen, because this runs on every authenticated request', () => {
    const { s, advance, file } = store();
    const { id } = s.create({ username: 'kckern' });
    const created = file().sessions[0].lastSeenAt;
    advance(5_000);
    s.touch(id);
    expect(file().sessions[0].lastSeenAt).toBe(created);   // too soon to rewrite
    advance(120_000);
    s.touch(id);
    expect(file().sessions[0].lastSeenAt).not.toBe(created);
  });

  it('signs out everywhere else while keeping the device that asked', () => {
    const { s } = store();
    const phone = s.create({ username: 'kckern' });
    const laptop = s.create({ username: 'kckern' });
    const lost = s.create({ username: 'kckern' });
    expect(s.revokeAllExcept(laptop.id)).toEqual({ removed: 2 });
    expect(s.isActive(laptop.id)).toBe(true);
    expect(s.isActive(phone.id)).toBe(false);
    expect(s.isActive(lost.id)).toBe(false);
  });

  it('lists newest-seen first, so the device you are on is findable', () => {
    const { s, advance } = store();
    const first = s.create({ username: 'kckern' });
    advance(120_000);
    const second = s.create({ username: 'elizabeth' });
    advance(120_000);
    s.touch(first.id);
    expect(s.list().map(r => r.id)).toEqual([first.id, second.id]);
    expect(s.list()[0]).toMatchObject({ username: 'kckern' });
  });

  it('truncates a user agent instead of storing a paragraph', () => {
    const { s } = store();
    s.create({ username: 'kckern', userAgent: 'x'.repeat(500) });
    expect(s.list()[0].userAgent.length).toBe(180);
  });

  it('survives an empty or malformed file rather than refusing every request', () => {
    // isActive runs inside tokenResolver; throwing here would 500 the whole API.
    const dataService = { system: { read: () => ({ sessions: 'not-an-array' }), write: () => {} } };
    const s = new DataServiceAuthSessionStore({ dataService, logger: { info: vi.fn(), warn: vi.fn() } });
    expect(s.isActive('anything')).toBe(false);
    expect(s.list()).toEqual([]);
  });
});
