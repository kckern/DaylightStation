import { describe, it, expect } from 'vitest';
import { ReadingSessionService as ProductionReadingSessionService } from '#apps/school/ReadingSessionService.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const TEST_SCHEDULER = {
  withDeadline: (work) => work,
  every: () => () => {},
  wait: async () => {},
};
class ReadingSessionService extends ProductionReadingSessionService {
  constructor(config = {}) { super({ scheduler: TEST_SCHEDULER, ...config }); }
}
const realtimeFor = (sent) => ({
  readingRoomChanged: (location, { kind, ...payload }) => sent.push({ topic: `reading:${location}`, payload: { event: kind, ...payload } }),
});

describe('ReadingSessionService', () => {
  it('requires the scheduler that drives delivery deadlines and idle recovery', () => {
    expect(() => new ProductionReadingSessionService({ logger: silent })).toThrow(/requires scheduler methods/);
  });

  it('has no session at a location until a card opens one', () => {
    expect(new ReadingSessionService({ logger: silent }).current('livingroom')).toBeNull();
  });

  it('opens a session for a learner at a location', () => {
    const s = new ReadingSessionService({ clock: () => new Date('2026-08-26T18:00:00Z'), logger: silent });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    expect(s.current('livingroom')).toMatchObject({ learnerId: 'user_5', location: 'livingroom' });
    expect(s.current('livingroom').openedAt).toBe('2026-08-26T18:00:00.000Z');
  });

  it('publishes its own idle window, so the screen can draw the clock it is actually running', () => {
    const sessions = new ReadingSessionService({ logger: silent, idleTimeoutMs: 90_000 });
    const session = sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    expect(session.idleTimeoutMs).toBe(90_000);
  });

  it('the trusted open seam may replace a fixture/session directly', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    s.open({ location: 'livingroom', learnerId: 'user_3' });
    expect(s.current('livingroom').learnerId).toBe('user_3');
  });

  it('scopes sessions per location', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    expect(s.current('study')).toBeNull();
  });

  it('closes a session', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    s.close('livingroom');
    expect(s.current('livingroom')).toBeNull();
  });

  it('keeps a bounded, timestamped transition timeline for diagnosis', () => {
    const s = new ReadingSessionService({ clock: () => new Date('2026-08-28T19:00:00Z'), logger: silent });
    const opened = s.open({ location: 'livingroom', learnerId: 'user_5', state: 'starting' });
    const presenting = s.activate('livingroom', opened.sessionId);
    s.acknowledge('livingroom', opened.sessionId);
    s.update('livingroom', { state: 'confirm' });
    expect(s.observations('livingroom')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reserved', sessionId: opened.sessionId, at: '2026-08-28T19:00:00.000Z' }),
      expect.objectContaining({ type: 'presentation-requested', presentationId: presenting.pendingPresentation.presentationId }),
      expect.objectContaining({ type: 'presentation-acknowledged' }),
      expect.objectContaining({ type: 'updated', state: 'confirm' }),
    ]));
  });

  it('turns a missing screen acknowledgement into a bounded false result', async () => {
    let deadline = null;
    const scheduler = {
      withDeadline: async (_work, options) => {
        deadline = options;
        throw new Error('screen did not acknowledge');
      },
      every: () => () => {},
      wait: async () => {},
    };
    const s = new ProductionReadingSessionService({ scheduler, logger: silent });
    const opened = s.open({ location: 'livingroom', learnerId: 'user_5', state: 'starting' });
    const presenting = s.activate('livingroom', opened.sessionId);

    await expect(s.waitForAcknowledgement(presenting.pendingPresentation.presentationId, 321)).resolves.toBe(false);
    expect(deadline).toMatchObject({ milliseconds: 321 });
  });

  it('resolves a pending delivery wait when the mounted screen acknowledges it', async () => {
    const s = new ReadingSessionService({ logger: silent });
    const opened = s.open({ location: 'livingroom', learnerId: 'user_5', state: 'starting' });
    const presenting = s.activate('livingroom', opened.sessionId);
    const acknowledgement = s.waitForAcknowledgement(presenting.pendingPresentation.presentationId, 8_000);

    s.acknowledge('livingroom', opened.sessionId);

    await expect(acknowledgement).resolves.toBe(true);
  });

  it('does not mint a second presentation if activation is replayed', () => {
    const s = new ReadingSessionService({ logger: silent });
    const opened = s.open({ location: 'livingroom', learnerId: 'user_5', state: 'starting' });
    const presenting = s.activate('livingroom', opened.sessionId);

    expect(s.activate('livingroom', opened.sessionId)).toBeNull();
    expect(s.current('livingroom')).toBe(presenting);
  });

  it('keeps the old learner authoritative until the exact presented face is acknowledged', () => {
    const s = new ReadingSessionService({ logger: silent });
    const old = s.open({ location: 'livingroom', learnerId: 'user_5' });
    const requested = s.beginSwitch({ location: 'livingroom', learnerId: 'user_3' });

    expect(s.current('livingroom')).toMatchObject({
      learnerId: 'user_5', sessionId: old.sessionId, state: 'presenting',
      pendingPresentation: { learnerId: 'user_3' },
    });
    expect(s.acknowledge('livingroom', { ...requested.presentation, revision: requested.presentation.revision - 1 })).toBeNull();
    expect(s.current('livingroom').learnerId).toBe('user_5');

    const committed = s.acknowledge('livingroom', requested.presentation);
    expect(committed).toMatchObject({
      learnerId: 'user_3', sessionId: requested.presentation.sessionId,
      state: 'prompt', presentedAt: expect.any(String),
    });
  });

  it('makes a finished story non-switchable until the returning face is rendered', () => {
    const s = new ReadingSessionService({ logger: silent });
    const opened = s.open({ location: 'livingroom', learnerId: 'user_5' });
    s.update('livingroom', { state: 'reading', pick: { pickId: 'p' }, playing: { pickId: 'p' } });
    const returning = s.beginReturn('livingroom');
    expect(s.isSwitchable('livingroom')).toBe(false);
    expect(s.current('livingroom')).toMatchObject({ state: 'returning', pick: null, playing: null });
    s.acknowledge('livingroom', returning.presentation);
    expect(s.isSwitchable('livingroom')).toBe(true);
    expect(s.current('livingroom')).toMatchObject({ learnerId: 'user_5', sessionId: opened.sessionId });
  });

  it('broadcasts the open so the screen can render it', () => {
    const sent = [];
    const s = new ReadingSessionService({
      realtime: realtimeFor(sent), logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    expect(sent[0]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-open', learnerId: 'user_5' },
    });
  });

  it('broadcasts the close too', () => {
    const sent = [];
    const s = new ReadingSessionService({
      realtime: realtimeFor(sent), logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    s.close('livingroom');
    expect(sent[1]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-close', learnerId: 'user_5' },
    });
  });

  it('does not broadcast a close for a location with no session', () => {
    const sent = [];
    const s = new ReadingSessionService({
      realtime: realtimeFor(sent), logger: silent,
    });
    expect(s.close('livingroom')).toBeNull();
    expect(sent).toEqual([]);
  });

  // A card tap has to answer. A dead bus costs the screen an update; it must
  // never cost the child the session they just opened.
  it('opens even when the event bus throws', () => {
    const s = new ReadingSessionService({
      realtime: { readingRoomChanged: () => { throw new Error('bus down'); } }, logger: silent,
    });
    expect(() => s.open({ location: 'livingroom', learnerId: 'user_5' })).not.toThrow();
    expect(s.current('livingroom').learnerId).toBe('user_5');
  });

  it('closes even when the event bus throws', () => {
    const s = new ReadingSessionService({
      realtime: { readingRoomChanged: () => { throw new Error('bus down'); } }, logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    expect(() => s.close('livingroom')).not.toThrow();
    expect(s.current('livingroom')).toBeNull();
  });

  it('refuses an open with no location or no learner', () => {
    const s = new ReadingSessionService({ logger: silent });
    expect(() => s.open({ learnerId: 'user_5' })).toThrow();
    expect(() => s.open({ location: 'livingroom' })).toThrow();
  });

  // The session's STATE (prompt / confirm / reading) is what the interceptor
  // reads to decide whether a book tap lands mid-story. It is stored; the
  // MODE (assignment/browsing) never is — that is derived on every evaluation.
  it('opens at the prompt state', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    expect(s.current('livingroom').state).toBe('prompt');
  });

  it('updates a session in place and broadcasts the update', () => {
    const sent = [];
    const s = new ReadingSessionService({
      realtime: realtimeFor(sent), logger: silent,
    });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    const updated = s.update('livingroom', { state: 'reading' });
    expect(updated).toMatchObject({ learnerId: 'user_5', state: 'reading' });
    expect(s.current('livingroom').state).toBe('reading');
    expect(sent[1]).toMatchObject({
      topic: 'reading:livingroom',
      payload: { event: 'session-update', learnerId: 'user_5', state: 'reading' },
    });
  });

  it('updating a location with no session answers null and changes nothing', () => {
    const s = new ReadingSessionService({ logger: silent });
    expect(s.update('livingroom', { state: 'reading' })).toBeNull();
    expect(s.current('livingroom')).toBeNull();
  });

  it('an update cannot reassign the learner — a swap is a new open', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
    s.update('livingroom', { learnerId: 'user_3', location: 'study', state: 'reading' });
    expect(s.current('livingroom')).toMatchObject({
      learnerId: 'user_5', location: 'livingroom', state: 'reading',
    });
  });

  it('a session is frozen — nobody mutates it through the handle they were given', () => {
    const s = new ReadingSessionService({ logger: silent });
    s.open({ location: 'livingroom', learnerId: 'user_5' });
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
        withDeadline: (work) => work,
        every: (ms, fn) => { ticks.push({ fn, ms }); const handle = ticks.length; return () => cleared.push(handle); },
        wait: async () => {},
      },
      realtime: realtimeFor(sent),
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
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.advance(119_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).not.toBeNull();
    expect(r.torn).toEqual([]);
  });

  it('tears the session down once the room has been quiet long enough', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.advance(120_001);
    await r.service.sweep();
    expect(r.service.current('livingroom')).toBeNull();
    expect(r.torn).toHaveLength(1);
    expect(r.torn[0]).toMatchObject({ location: 'livingroom', learnerId: 'user_5' });
  });

  it('tells the screen the session closed, and says why', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.advance(200_000);
    await r.service.sweep();
    const close = r.sent.filter((m) => m.payload.event === 'session-close');
    expect(close).toHaveLength(1);
    expect(close[0]).toMatchObject({ topic: 'reading:livingroom', payload: { reason: 'timeout' } });
  });

  it('every tap resets the clock — a child picking a book is not idle', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.advance(119_000);
    r.service.update('livingroom', { state: 'confirm', pick: { contentId: 'plex:1' } });
    r.advance(119_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).not.toBeNull();
  });

  it('times out at CONFIRM too — a pick nobody confirmed is still an empty room', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.service.update('livingroom', { state: 'confirm', pick: { contentId: 'plex:1' } });
    r.advance(200_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).toBeNull();
  });

  it('NEVER times out mid-story — a long book is not an idle room', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.service.update('livingroom', { state: 'reading' });
    r.advance(45 * 60_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).not.toBeNull();
    expect(r.torn).toEqual([]);
  });

  it('sweeps every reader, not just the first one it finds', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.service.open({ location: 'study', learnerId: 'user_3' });
    r.advance(200_000);
    await r.service.sweep();
    expect(r.service.list()).toEqual([]);
    expect(r.torn.map((s) => s.location).sort()).toEqual(['livingroom', 'study']);
  });

  it('a teardown that THROWS still closes the session — a stuck TV must not strand it', async () => {
    const r = rig({ onTimeout: async () => { throw new Error('tv unreachable'); } });
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.advance(200_000);
    await expect(r.service.sweep()).resolves.toBeDefined();
    expect(r.service.current('livingroom')).toBeNull();
  });

  it('tears down only once, however many sweeps run', async () => {
    const r = rig();
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.advance(200_000);
    await r.service.sweep();
    await r.service.sweep();
    expect(r.torn).toHaveLength(1);
  });

  it('start() arms a sweep on the injected scheduler, and stop() disarms it', async () => {
    const r = rig();
    r.service.start();
    expect(r.ticks).toHaveLength(1);
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
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
    r.service.open({ location: 'livingroom', learnerId: 'user_5' });
    r.advance(10 * 60_000);
    await r.service.sweep();
    expect(r.service.current('livingroom')).not.toBeNull();
  });

  it('with no onTimeout wired at all, the sweep still closes the session', async () => {
    const service = new ReadingSessionService({
      clock: () => new Date(Date.now() - 0), idleTimeoutMs: 1, logger: silent,
    });
    service.open({ location: 'livingroom', learnerId: 'user_5' });
    await new Promise((r) => { setTimeout(r, 5); });
    await service.sweep();
    expect(service.current('livingroom')).toBeNull();
  });
});

/**
 * The nine seconds between a teardown and the book card that was already on
 * its way to the reader. See `REOPEN_GRACE_MS`.
 *
 * The window edges are pinned to the millisecond on purpose: a grace quietly
 * narrowed to ten seconds would still pass a "+9s works, +69s does not" pair,
 * and ten seconds is not long enough to walk to a shelf — which is the whole
 * failure this exists to prevent.
 */
describe('ReadingSessionService — the session that just closed', () => {
  it('remembers a timed-out session, to the last millisecond of the grace', () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.close('livingroom', { reason: 'timeout' });

    now += 9_000; // the nine seconds that cost a real child his credit
    const record = sessions.recentlyClosed('livingroom');
    expect(record).toBeTruthy();
    expect(record.session.learnerId).toBe('user_5');
    expect(record.reason).toBe('timeout');

    now += 35_999; // 44_999ms — the last millisecond inside the window
    expect(sessions.recentlyClosed('livingroom')).toBeTruthy();
    now += 2; // 45_001ms — the first millisecond outside it
    expect(sessions.recentlyClosed('livingroom')).toBeNull();
  });

  it('hands out a frozen record — nobody resurrects an expired session from outside', () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.close('livingroom', { reason: 'timeout' });
    const record = sessions.recentlyClosed('livingroom');
    expect(Object.isFrozen(record)).toBe(true);

    now += 60_000;
    try { record.closedAt = now; } catch { /* strict-mode throw is the same answer */ }
    expect(sessions.recentlyClosed('livingroom')).toBeNull();
  });

  it('forgets the closed session once a new one is open — a live session is never "recently closed"', () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.close('livingroom', { reason: 'timeout' });
    sessions.open({ location: 'livingroom', learnerId: 'user_3' });
    expect(sessions.recentlyClosed('livingroom')).toBeNull();
  });

  // The grace is a FRACTION of the idle timeout, not a second timeout. A
  // household that shortened its timeout must not end up with a grace longer
  // than the timeout it chose.
  it('clamps the grace to a shorter configured idle timeout', () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({
      logger: silent, clock: () => new Date(now), idleTimeoutMs: 30_000,
    });
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.close('livingroom', { reason: 'timeout' });

    now += 29_999;
    expect(sessions.recentlyClosed('livingroom')).toBeTruthy();
    now += 2; // 30_001ms — past this instance's own idle timeout
    expect(sessions.recentlyClosed('livingroom')).toBeNull();
  });

  // `idleTimeoutMs: 0` disables the sweep; it must not silently disable the
  // grace as well, or `Math.min(45_000, 0)` would kill the feature outright.
  it('a disabled idle timeout keeps the full grace, not a zero one', () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({
      logger: silent, clock: () => new Date(now), idleTimeoutMs: 0,
    });
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.close('livingroom', { reason: 'timeout' });
    now += 44_999;
    expect(sessions.recentlyClosed('livingroom')).toBeTruthy();
  });

  // Everything above closes by hand. THIS is the one that actually fires in
  // the field, and the one Task 2 will be wired behind.
  it('the idle SWEEP records the teardown it performed, with reason timeout', async () => {
    let now = 1_000_000;
    const sessions = new ReadingSessionService({ logger: silent, clock: () => new Date(now) });
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });

    now += 120_001;
    await sessions.sweep();

    expect(sessions.current('livingroom')).toBeNull();
    const record = sessions.recentlyClosed('livingroom');
    expect(record).toBeTruthy();
    expect(record.reason).toBe('timeout');
    expect(record.session.learnerId).toBe('user_5');
  });

  // The two facts Task 2's `reason === 'timeout'` guard rests on. A day-done
  // close is a finished child: reopening it re-arms a ceremony that already ran.
  it('records every teardown, and keeps the reasons apart', () => {
    const sessions = new ReadingSessionService({ logger: silent });
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.close('livingroom');
    expect(sessions.recentlyClosed('livingroom').reason).toBeNull();

    sessions.open({ location: 'study', learnerId: 'user_3' });
    sessions.close('study', { reason: 'day-done' });
    expect(sessions.recentlyClosed('study').reason).toBe('day-done');
  });
});
