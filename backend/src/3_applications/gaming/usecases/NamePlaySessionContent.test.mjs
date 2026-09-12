import { describe, it, expect } from 'vitest';
import { NamePlaySessionContent } from './NamePlaySessionContent.mjs';
import { PlaySession } from '#domains/gaming/entities/PlaySession.mjs';

const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const TRUSTED_GAP_MS = 30_000;

function openSession({ content = null, startedAt = '2026-09-11T18:00:00.000Z' } = {}) {
  const session = PlaySession.open({
    id: 's1', deviceId: 'tv', surface: 'console', content, trustedGapMs: TRUSTED_GAP_MS,
  });
  session.observe({ state: 'playing', observedAt: startedAt });
  return session;
}

const CATALOG = {
  '/Games/GB/mario.gb': {
    contentId: 'retroarch:gb/super-mario-land', title: 'Super Mario Land',
    console: 'gb', consoleLabel: 'Game Boy',
  },
};

function build({ entries, saved = [], resolve = (p) => CATALOG[p] || null } = {}) {
  return new NamePlaySessionContent({
    sessions: { save: async (s) => { saved.push(s); } },
    logReader: { listRecentSessions: async () => entries },
    resolveContent: resolve,
    logger: quiet,
  });
}

describe('NamePlaySessionContent', () => {
  it('names a session from the device log that matches its start', async () => {
    const saved = [];
    const session = openSession();
    const result = await build({
      entries: [{ startedAt: '2026-09-11T18:00:04.000Z', contentPath: '/Games/GB/mario.gb' }],
      saved,
    }).execute(session);

    expect(result.named).toBe(true);
    expect(session.content.contentId).toBe('retroarch:gb/super-mario-land');
    expect(session.content.console).toBe('gb');
    expect(saved).toHaveLength(1);
  });

  // Two games played back to back must never be confused for each other.
  it('ignores a log entry too far from this session to be the same game', async () => {
    const saved = [];
    const result = await build({
      entries: [{ startedAt: '2026-09-11T17:30:00.000Z', contentPath: '/Games/GB/mario.gb' }],
      saved,
    }).execute(openSession());

    expect(result.named).toBe(false);
    expect(result.reason).toMatch(/no device log/);
    expect(saved).toHaveLength(0);
  });

  it('leaves an already-named session alone', async () => {
    const saved = [];
    const named = { contentId: 'retroarch:snes/zelda', title: 'Zelda', console: 'snes' };
    const session = openSession({ content: named });
    const result = await build({
      entries: [{ startedAt: '2026-09-11T18:00:01.000Z', contentPath: '/Games/GB/mario.gb' }],
      saved,
    }).execute(session);

    expect(result.named).toBe(false);
    expect(session.content).toEqual(named);
    expect(saved).toHaveLength(0);
  });

  it('does not name a session that has not started', async () => {
    const pending = PlaySession.open({ id: 's2', deviceId: 'tv', surface: 'console', trustedGapMs: TRUSTED_GAP_MS });
    const result = await build({ entries: [] }).execute(pending);
    expect(result).toEqual({ named: false, reason: 'not started' });
  });

  // A ROM on the device the launcher does not list: worth saying, never guessed at.
  it('refuses to invent content the catalog does not know', async () => {
    const saved = [];
    const session = openSession();
    const result = await build({
      entries: [{ startedAt: '2026-09-11T18:00:02.000Z', contentPath: '/Games/GB/homebrew.gb' }],
      saved,
    }).execute(session);

    expect(result.named).toBe(false);
    expect(result.reason).toMatch(/not in catalog/);
    expect(session.content).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('handles a log entry with no content path', async () => {
    const result = await build({
      entries: [{ startedAt: '2026-09-11T18:00:02.000Z', contentPath: null }],
    }).execute(openSession());
    expect(result.named).toBe(false);
  });

  it('does nothing without a log source', async () => {
    const useCase = new NamePlaySessionContent({ sessions: {}, logReader: null, resolveContent: null, logger: quiet });
    expect(await useCase.execute(openSession())).toEqual({ named: false, reason: 'no log source' });
  });

  // Naming must never be able to move the meter.
  it('never changes the time already accrued', async () => {
    const session = openSession();
    session.observe({ state: 'playing', observedAt: '2026-09-11T18:00:20.000Z' });
    const before = session.playedMs;

    await build({ entries: [{ startedAt: '2026-09-11T18:00:01.000Z', contentPath: '/Games/GB/mario.gb' }] })
      .execute(session);

    expect(session.playedMs).toBe(before);
  });
});
