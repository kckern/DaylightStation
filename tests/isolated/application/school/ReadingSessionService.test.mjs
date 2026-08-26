import { describe, it, expect } from 'vitest';
import { ReadingSessionService } from '#apps/school/ReadingSessionService.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

describe('ReadingSessionService', () => {
  it('has no session at a location until a card opens one', () => {
    expect(new ReadingSessionService({ logger: silent }).current('livingroom')).toBeNull();
  });

  it('opens a session for a learner at a location', () => {
    const s = new ReadingSessionService({ clock: () => new Date('2026-08-26T18:00:00Z'), logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(s.current('livingroom')).toMatchObject({ learnerId: 'learner-c', location: 'livingroom' });
    expect(s.current('livingroom').openedAt).toBe('2026-08-26T18:00:00.000Z');
  });

  it('a second card REPLACES the first — last tap wins', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    s.open({ location: 'livingroom', learnerId: 'learner-d' });
    expect(s.current('livingroom').learnerId).toBe('learner-d');
  });

  it('scopes sessions per location', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(s.current('study')).toBeNull();
  });

  it('closes a session', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    s.close('livingroom');
    expect(s.current('livingroom')).toBeNull();
  });

  it('broadcasts the open so the screen can render it', () => {
    const sent = [];
    const s = new ReadingSessionService({
      eventBus: { broadcast: (t, p) => sent.push({ topic: t, payload: p }) }, logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(sent[0]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-open', learnerId: 'learner-c' },
    });
  });

  it('broadcasts the close too', () => {
    const sent = [];
    const s = new ReadingSessionService({
      eventBus: { broadcast: (t, p) => sent.push({ topic: t, payload: p }) }, logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    s.close('livingroom');
    expect(sent[1]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-close', learnerId: 'learner-c' },
    });
  });

  it('does not broadcast a close for a location with no session', () => {
    const sent = [];
    const s = new ReadingSessionService({
      eventBus: { broadcast: (t, p) => sent.push({ topic: t, payload: p }) }, logger: silent,
    });
    expect(s.close('livingroom')).toBeNull();
    expect(sent).toEqual([]);
  });

  // A card tap has to answer. A dead bus costs the screen an update; it must
  // never cost the child the session they just opened.
  it('opens even when the event bus throws', () => {
    const s = new ReadingSessionService({
      eventBus: { broadcast: () => { throw new Error('bus down'); } }, logger: silent,
    });
    expect(() => s.open({ location: 'livingroom', learnerId: 'learner-c' })).not.toThrow();
    expect(s.current('livingroom').learnerId).toBe('learner-c');
  });

  it('closes even when the event bus throws', () => {
    const s = new ReadingSessionService({
      eventBus: { broadcast: () => { throw new Error('bus down'); } }, logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(() => s.close('livingroom')).not.toThrow();
    expect(s.current('livingroom')).toBeNull();
  });

  it('refuses an open with no location or no learner', () => {
    const s = new ReadingSessionService({ logger: silent });
    expect(() => s.open({ learnerId: 'learner-c' })).toThrow();
    expect(() => s.open({ location: 'livingroom' })).toThrow();
  });

  // The session's STATE (prompt / confirm / reading) is what the interceptor
  // reads to decide whether a book tap lands mid-story. It is stored; the
  // MODE (assignment/browsing) never is — that is derived on every evaluation.
  it('opens at the prompt state', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(s.current('livingroom').state).toBe('prompt');
  });

  it('updates a session in place and broadcasts the update', () => {
    const sent = [];
    const s = new ReadingSessionService({
      eventBus: { broadcast: (t, p) => sent.push({ topic: t, payload: p }) }, logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    const updated = s.update('livingroom', { state: 'reading' });
    expect(updated).toMatchObject({ learnerId: 'learner-c', state: 'reading' });
    expect(s.current('livingroom').state).toBe('reading');
    expect(sent[1]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-update', learnerId: 'learner-c', state: 'reading' },
    });
  });

  it('updating a location with no session answers null and changes nothing', () => {
    const s = new ReadingSessionService({ logger: silent });
    expect(s.update('livingroom', { state: 'reading' })).toBeNull();
    expect(s.current('livingroom')).toBeNull();
  });

  it('an update cannot reassign the learner — a swap is a new open', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    s.update('livingroom', { learnerId: 'learner-d', location: 'study', state: 'reading' });
    expect(s.current('livingroom')).toMatchObject({
      learnerId: 'learner-c', location: 'livingroom', state: 'reading',
    });
  });

  it('a session is frozen — nobody mutates it through the handle they were given', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'learner-c' });
    expect(Object.isFrozen(s.current('livingroom'))).toBe(true);
  });
});

/**
 * D6 — a session that nobody is using times out.
 *
 * Without it the failure is not an error anywhere: a child taps their card,
 * wanders off before picking a book, and the living-room TV stays on all night
 * — and the next card tapped tomorrow lands in a session belonging to whoever
 * left the room. Two minutes of quiet at the prompt or the countdown ends it,
 * through the SAME teardown a finished session runs.
 *
 * The clock and the sweep are both injected, so this suite takes milliseconds
 * rather than the two minutes the field waits.
 */
describe('ReadingSessionService — the idle timeout (D6)', () => {
  /** A hand-cranked clock plus a hand-cranked scheduler: no real time passes. */
  function rig({ idleTimeoutMs = 120_000, onTimeout = null } = {}) {
    let now = Date.parse('2026-08-26T18:00:00.000Z');
    const ticks = [];
    const cleared = [];
    const torn = [];
    const sent = [];
    const service = new ReadingSessionService({
      clock: () => new Date(now),
      idleTimeoutMs,
      onTimeout: onTimeout ?? (async (session) => { torn.push(session); }),
      scheduler: {
        setInterval: (fn, ms) => { ticks.push({ fn, ms }); return ticks.length; },
        clearInterval: (handle) => cleared.push(handle),
      },
      eventBus: { broadcast: (topic, payload) => sent.push({ topic, payload }) },
      logger: silent,
    });
    return {
      service, torn, sent, cleared, ticks,
      advance: (ms) => { now += ms; },
      tick: () => ticks[0]?.fn?.(),
    };
  }

  it('leaves a session alone while the clock is still inside the window', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.advance(119_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).not.toBeNull();
    expect(r.torn).toEqual([]);
  });

  it('tears the session down once the room has been quiet long enough', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.advance(120_001);
    await r.service.sweep();
    expect(r.service.current('livingroom')).toBeNull();
    expect(r.torn).toHaveLength(1);
    expect(r.torn[0]).toMatchObject({ location: 'livingroom', learnerId: 'learner-c' });
  });

  it('tells the screen the session closed, and says why', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.advance(200_000);
    await r.service.sweep();
    const close = r.sent.filter((m) => m.payload.event === 'session-close');
    expect(close).toHaveLength(1);
    expect(close[0]).toMatchObject({ topic: 'reading:livingroom', payload: { reason: 'timeout' } });
  });

  it('every tap resets the clock — a child picking a book is not idle', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.advance(119_000);
    r.service.update('livingroom', { state: 'confirm', pick: { contentId: 'plex:1' } });
    r.advance(119_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).not.toBeNull();
  });

  it('times out at CONFIRM too — a pick nobody confirmed is still an empty room', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.service.update('livingroom', { state: 'confirm', pick: { contentId: 'plex:1' } });
    r.advance(200_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).toBeNull();
  });

  it('NEVER times out mid-story — a long book is not an idle room', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.service.update('livingroom', { state: 'reading' });
    r.advance(45 * 60_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).not.toBeNull();
    expect(r.torn).toEqual([]);
  });

  it('sweeps every reader, not just the first one it finds', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.service.open({ location: 'study', learnerId: 'learner-d' });
    r.advance(200_000);
    await r.service.sweep();
    expect(r.service.list()).toEqual([]);
    expect(r.torn.map((s) => s.location).sort()).toEqual(['livingroom', 'study']);
  });

  it('a teardown that THROWS still closes the session — a stuck TV must not strand it', async () => {
    const r = rig({ onTimeout: async () => { throw new Error('tv unreachable'); } });
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.advance(200_000);
    await expect(r.service.sweep()).resolves.toBeDefined();
    expect(r.service.current('livingroom')).toBeNull();
  });

  it('tears down only once, however many sweeps run', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.advance(200_000);
    await r.service.sweep();
    await r.service.sweep();
    expect(r.torn).toHaveLength(1);
  });

  it('start() arms a sweep on the injected scheduler, and stop() disarms it', async () => {
    const r = rig();
    r.service.start();
    expect(r.ticks).toHaveLength(1);
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.advance(200_000);
    await r.tick();
    expect(r.service.current('livingroom')).toBeNull();
    r.service.stop();
    expect(r.cleared).toHaveLength(1);
  });

  it('start() is idempotent — a second call does not arm a second sweep', () => {
    const r = rig();
    r.service.start();
    r.service.start();
    expect(r.ticks).toHaveLength(1);
  });

  it('idleTimeoutMs 0 disables the timeout rather than expiring everything instantly', async () => {
    const r = rig({ idleTimeoutMs: 0 });
    r.service.open({ location: 'livingroom', learnerId: 'learner-c' });
    r.advance(10 * 60_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).not.toBeNull();
  });

  it('with no onTimeout wired at all, the sweep still closes the session', async () => {
    const service = new ReadingSessionService({
      clock: () => new Date(Date.now() - 0), idleTimeoutMs: 1, logger: silent,
    });
    service.open({ location: 'livingroom', learnerId: 'learner-c' });
    await new Promise((r) => { setTimeout(r, 5); });
    await service.sweep();
    expect(service.current('livingroom')).toBeNull();
  });
});
