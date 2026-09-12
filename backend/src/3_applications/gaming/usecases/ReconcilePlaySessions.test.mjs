import { describe, it, expect, beforeEach } from 'vitest';
import { ReconcilePlaySessions } from './ReconcilePlaySessions.mjs';
import { PlaySession } from '#domains/gaming/entities/PlaySession.mjs';
import { PlayState } from '#domains/gaming/value-objects/PlayState.mjs';

const T0 = Date.parse('2026-09-11T19:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const quiet = { info() {}, warn() {}, debug() {} };
const ROM = '/storage/emulated/0/Games/GB/Test Game.gb';

const recordedSession = (id, startSec, content = { contentId: 'game:a' }) => {
  const s = PlaySession.open({ id, deviceId: 'tv', surface: 'console-emulator', content, trustedGapMs: 25_000 });
  s.observe({ state: PlayState.PLAYING, observedAt: at(startSec) });
  return s;
};

let sessions, logReader, warns;
beforeEach(() => {
  warns = [];
  sessions = { list: [], async listForDeviceSince() { return sessions.list; } };
  logReader = { entries: [], async listRecentSessions() { return logReader.entries; } };
});

const build = (over = {}) => new ReconcilePlaySessions({
  sessions, logReader,
  resolveContent: (p) => (p === ROM ? { contentId: 'retroarch:gb/test-game', title: 'Test Game' } : null),
  logger: { ...quiet, warn: (e, d) => warns.push([e, d]) },
  ...over,
});

describe('ReconcilePlaySessions', () => {
  it('matches a device session to the one we recorded', async () => {
    sessions.list = [recordedSession('ps_1', 0)];
    logReader.entries = [{ startedAt: at(3), contentPath: ROM }];
    const r = await build().execute({ deviceId: 'tv', since: at(-600) });
    expect(r.matched).toEqual(['ps_1']);
    expect(r.unrecorded).toEqual([]);
  });

  it('reports a session the meter never saw — loudly, and without billing it', async () => {
    sessions.list = [];
    logReader.entries = [{ startedAt: at(0), contentPath: ROM }];
    const r = await build().execute({ deviceId: 'tv', since: at(-600) });
    expect(r.unrecorded).toHaveLength(1);
    expect(r.unrecorded[0].content.contentId).toBe('retroarch:gb/test-game');
    // No duration is invented anywhere in the result.
    expect(JSON.stringify(r)).not.toMatch(/playedMs|durationMs|endedAt/);
    expect(warns.map((w) => w[0])).toContain('play.session.unrecorded');
  });

  it('repairs attribution when the session played something we could not name', async () => {
    sessions.list = [recordedSession('ps_1', 0, null)];
    logReader.entries = [{ startedAt: at(2), contentPath: ROM }];
    const r = await build().execute({ deviceId: 'tv', since: at(-600) });
    expect(r.enriched).toEqual([{ sessionId: 'ps_1', content: { contentId: 'retroarch:gb/test-game', title: 'Test Game' } }]);
  });

  it('leaves an already-attributed session alone', async () => {
    sessions.list = [recordedSession('ps_1', 0)];
    logReader.entries = [{ startedAt: at(2), contentPath: ROM }];
    expect((await build().execute({ deviceId: 'tv', since: at(-600) })).enriched).toEqual([]);
  });

  it('does not match a session that started far from the device record', async () => {
    sessions.list = [recordedSession('ps_1', 0)];
    logReader.entries = [{ startedAt: at(3600), contentPath: ROM }];
    const r = await build().execute({ deviceId: 'tv', since: at(-600) });
    expect(r.matched).toEqual([]);
    expect(r.unrecorded).toHaveLength(1);
  });

  it('ignores device sessions older than the window', async () => {
    logReader.entries = [{ startedAt: at(-7200), contentPath: ROM }];
    const r = await build().execute({ deviceId: 'tv', since: at(-600) });
    expect(r.unrecorded).toEqual([]);
  });

  it('survives an unresolvable content path', async () => {
    logReader.entries = [{ startedAt: at(0), contentPath: '/unknown/rom.bin' }];
    const r = await build().execute({ deviceId: 'tv', since: at(-600) });
    expect(r.unrecorded[0].content).toBeNull();
  });
});
