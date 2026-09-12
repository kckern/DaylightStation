import { describe, it, expect, beforeEach } from 'vitest';
import { EnforcePlayBudget } from './EnforcePlayBudget.mjs';
import { PlaySession } from '#domains/gaming/entities/PlaySession.mjs';
import { PlayState } from '#domains/gaming/value-objects/PlayState.mjs';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const MIN = 60_000;
const quiet = { info() {}, warn() {}, error() {} };

/** A session with exactly `playedSec` of observed play. */
function session(playedSec) {
  const s = PlaySession.open({
    id: 'ps_1', deviceId: 'tv', surface: 'console-emulator',
    content: { contentId: 'g' }, trustedGapMs: 3_600_000,
  });
  s.observe({ state: PlayState.PLAYING, observedAt: at(0) });
  if (playedSec) s.observe({ state: PlayState.PLAYING, observedAt: at(playedSec) });
  return s;
}

let killed, spoken, notified, sessions;
const terminator = { endPlay: async (d) => { killed.push(d); return { ok: true }; } };
const speaker = { say: async (d, t) => { spoken.push(t); return true; } };
const notify = async (_s, p) => { notified.push(p); };

const build = (grantedMs, over = {}) => new EnforcePlayBudget({
  grants: { forSession: async () => (grantedMs === undefined ? null : { grantedMs, grantRef: 'g1' }) },
  terminator, speaker, notify, sessions, logger: quiet, ...over,
});

beforeEach(() => {
  killed = []; spoken = []; notified = [];
  sessions = { saved: [], save: async (s) => sessions.saved.push(s.id) };
});

describe('EnforcePlayBudget — refuses to act without authority', () => {
  it('does nothing when there is no grant', async () => {
    await build(undefined).progress(session(60 * 60));
    expect(killed).toEqual([]);
    expect(notified).toEqual([]);
  });

  it('does nothing when the grant cannot be fetched', async () => {
    const e = build(MIN, { grants: { forSession: async () => { throw new Error('economy down'); } } });
    await e.progress(session(60 * 60));
    expect(killed).toEqual([]);
  });

  it('an unlimited grant never warns and never expires', async () => {
    await build(null).progress(session(10 * 60 * 60));
    expect(killed).toEqual([]);
    expect(spoken).toEqual([]);
  });
});

describe('EnforcePlayBudget — the warning ladder runs before anything is killed', () => {
  it('warns on screen and out loud together', async () => {
    await build(30 * MIN).progress(session(25 * 60 + 1));
    expect(notified[0].warning).toMatch(/SAVE YOUR GAME/);
    expect(spoken[0]).toMatch(/save your game/i);
    expect(killed).toEqual([]);
  });

  it('does not repeat a rung it already announced', async () => {
    const e = build(30 * MIN);
    await e.progress(session(25 * 60 + 1));
    await e.progress(session(25 * 60 + 30));
    expect(notified).toHaveLength(1);
  });

  it('warns rather than expiring in the same tick', async () => {
    // A tick that crosses a rung says its piece; expiry waits for the next one.
    await build(30 * MIN).progress(session(30 * 60 - 10));
    expect(killed).toEqual([]);
  });
});

describe('EnforcePlayBudget — expiry', () => {
  it('stops play and settles the session as expired', async () => {
    const e = build(10 * MIN);
    const s = session(20 * 60);
    await e.progress(s);           // crosses rungs -> warns
    await e.progress(s);           // still warning down the ladder
    await e.progress(s);
    await e.progress(s);           // ladder exhausted -> expires
    expect(killed).toEqual(['tv']);
    expect(s.isEnded()).toBe(true);
    expect(s.endReason).toBe('expired');
    expect(sessions.saved).toEqual(['ps_1']);
  });

  it('does NOT settle the session when the stop failed', async () => {
    // The game is still running; recording it as finished would stop the meter
    // while a child keeps playing.
    const e = build(10 * MIN, { terminator: { endPlay: async () => ({ ok: false, error: 'adb gone' }) } });
    const s = session(20 * 60);
    for (let i = 0; i < 5; i += 1) await e.progress(s);
    expect(s.isEnded()).toBe(false);
    expect(sessions.saved).toEqual([]);
  });

  it('a failing speaker never blocks the stop', async () => {
    const e = build(10 * MIN, { speaker: { say: async () => { throw new Error('mute'); } } });
    const s = session(20 * 60);
    for (let i = 0; i < 5; i += 1) await e.progress(s);
    expect(killed).toEqual(['tv']);
  });

  it('ignores an already-ended session', async () => {
    const s = session(20 * 60);
    s.end({ endedAt: at(1300), reason: 'quit' });
    await build(MIN).progress(s);
    expect(killed).toEqual([]);
  });
});

describe('EnforcePlayBudget — construction', () => {
  it('requires the grant and terminator ports', () => {
    expect(() => new EnforcePlayBudget({ terminator })).toThrow(/grants/);
    expect(() => new EnforcePlayBudget({ grants: { forSession: async () => null } })).toThrow(/terminator/);
  });
});
