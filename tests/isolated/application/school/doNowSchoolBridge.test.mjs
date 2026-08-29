/**
 * DoNowSchoolBridge (Task 12, spec §6 "The approval gap"): the school
 * lifecycle's subscription to `donow.dispatched`, closing the loop for a
 * `launch:` unit whose scan PENDED and was approved later, out of band, by a
 * grown-up working the approvals queue — nobody is scanning a card at that
 * moment for `ResolveScanAction` to answer synchronously.
 *
 * `donow.dispatched` fires identically for BOTH the immediate dispatch path
 * (already handled inline by the scan) and the out-of-band approval path
 * this bridge exists for. `payload.approved === true` is the ONLY
 * deterministic discriminator (set by `DoNowService` only on the approved
 * path) — checked FIRST, before any I/O, so the immediate case never even
 * reaches the repository lookup. Ownership below that gate is a REPOSITORY
 * LOOKUP, never shape matching: `requestedBy === 'school-scan'` AND a `ref`
 * this store resolves to a real session sitting at `created` gets acted on.
 * Everything else — unapproved, a different provenance, an unresolvable ref,
 * a ref already past `created` — is ignored by construction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoNowSchoolBridge } from '#apps/school/DoNowSchoolBridge.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';
import { FakeSessionRepository, fakeClock, silentLogger } from '#testlib/school/lifecycleFakes.mjs';

class FakeEventBus {
  constructor() {
    this.handlers = new Map();
    this.unsubscribeCalls = 0;
  }

  subscribe(topic, handler) {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
    return () => {
      this.unsubscribeCalls += 1;
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  /** Fans out to every subscriber and awaits each one — lets a test observe
   * the bridge's async append+honor-close deterministically. */
  async emit(topic, payload) {
    await Promise.all((this.handlers.get(topic) ?? []).map((h) => h(payload)));
  }

  subscriberCount(topic) { return (this.handlers.get(topic) ?? []).length; }
}

let clock, sessions, eventBus, close, bridge;

const build = () => {
  clock = fakeClock();
  sessions = new FakeSessionRepository();
  eventBus = new FakeEventBus();
  close = { execute: vi.fn(async ({ sessionId }) => ({ status: 'settled', sessionId, result: 'passed' })) };
  bridge = new DoNowSchoolBridge({ realtime: new EventBusSchoolRealtimeAdapter({ eventBus }), sessions, closeSessionOutcome: close, clock: clock.now, logger: silentLogger });
};

/** The shape DoNowService actually broadcasts for an approved dispatch. */
const approvedPayload = (over = {}) => ({
  type: 'donow.dispatched', surface: 'garage-fitness', requestedBy: 'school-scan',
  approved: true, approvalId: 'dnr_1', ...over,
});

beforeEach(() => build());

describe('construction', () => {
  it('requires eventBus, sessions and closeSessionOutcome', () => {
    expect(() => new DoNowSchoolBridge({})).toThrow();
    const realtime = new EventBusSchoolRealtimeAdapter({ eventBus });
    expect(() => new DoNowSchoolBridge({ realtime, sessions })).toThrow();
    expect(() => new DoNowSchoolBridge({ realtime, closeSessionOutcome: close })).toThrow();
  });
});

describe('start/stop', () => {
  it('start() subscribes to the donow topic', () => {
    bridge.start();
    expect(eventBus.subscriberCount('donow')).toBe(1);
  });

  it('start() twice does not double-subscribe', () => {
    bridge.start();
    bridge.start();
    expect(eventBus.subscriberCount('donow')).toBe(1);
  });

  it('stop() unsubscribes, and is safe to call again', () => {
    bridge.start();
    bridge.stop();
    expect(eventBus.subscriberCount('donow')).toBe(0);
    expect(() => bridge.stop()).not.toThrow();
  });

  it('stop() before start() is a safe no-op', () => {
    expect(() => bridge.stop()).not.toThrow();
  });

  it('after stop(), a donow event is no longer acted on', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    bridge.start();
    bridge.stop();
    await eventBus.emit('donow', approvedPayload({ ref: sid }));
    expect(close.execute).not.toHaveBeenCalled();
    expect(sessions.types(sid)).not.toContain('launch_dispatched');
  });
});

describe('the approved gate — deterministic, checked before any I/O', () => {
  // THE double-fire fix: the immediate dispatch path (already handled
  // inline by ResolveScanAction, in the SAME call that produced this very
  // broadcast) reaches this bridge too, on the same synchronous bus, and its
  // session still reads `created` at that instant — a race, not a filter.
  // `approved` is the deterministic answer: the immediate path never sets it.
  it('ignores an unapproved dispatched event outright, even though the ref resolves to a session at created', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    bridge.start();

    await eventBus.emit('donow', {
      type: 'donow.dispatched', ref: sid, surface: 'garage-fitness', requestedBy: 'school-scan',
      // no `approved` key — exactly what the immediate dispatch path broadcasts.
    });

    expect(close.execute).not.toHaveBeenCalled();
    expect(sessions.types(sid)).not.toContain('launch_dispatched');
  });

  it('also ignores approved: false explicitly', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    bridge.start();

    await eventBus.emit('donow', approvedPayload({ ref: sid, approved: false }));

    expect(close.execute).not.toHaveBeenCalled();
  });
});

describe('the ownership filter (spec §6)', () => {
  it('an approved event on a session at created appends launch_dispatched (with approvalId) and honor-closes', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    bridge.start();

    await eventBus.emit('donow', approvedPayload({ ref: sid, approvalId: 'dnr_42' }));

    expect(sessions.types(sid)).toContain('launch_dispatched');
    const event = (await sessions.readEvents(sid)).find((e) => e.type === 'launch_dispatched');
    expect(event).toMatchObject({ surface: 'garage-fitness', decision: 'dispatched', approvalId: 'dnr_42' });
    expect(close.execute).toHaveBeenCalledWith({ sessionId: sid, honorClose: true });
  });

  it('ignores a different requestedBy (e.g. school-program) even if approved and the ref resolves to a session', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    bridge.start();

    await eventBus.emit('donow', approvedPayload({ ref: sid, surface: 'portal', requestedBy: 'school-program' }));

    expect(close.execute).not.toHaveBeenCalled();
    expect(sessions.types(sid)).not.toContain('launch_dispatched');
  });

  it('ignores an event type other than donow.dispatched', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    bridge.start();

    await eventBus.emit('donow', approvedPayload({ ref: sid, type: 'donow.pending' }));

    expect(close.execute).not.toHaveBeenCalled();
  });

  it('ignores a ref this store cannot resolve to any session (unknown id) — never a shape check', async () => {
    bridge.start();
    await eventBus.emit('donow', approvedPayload({ ref: 'ses_nope' }));
    expect(close.execute).not.toHaveBeenCalled();
  });

  // Belt-and-braces even with `approved` as the deterministic gate: a
  // double-approval (or a replayed event) must skip silently, not re-append
  // or re-close.
  it('an approved event whose session has already moved past created skips silently (already launch_dispatched)', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    await sessions.appendEvent(sid, { type: 'launch_dispatched', at: clock.iso(), sessionId: sid, surface: 'garage-fitness' });
    bridge.start();

    await eventBus.emit('donow', approvedPayload({ ref: sid }));

    // Still only the one launch_dispatched event that was already there — the
    // bridge did not append a second one or re-honor-close.
    expect(close.execute).not.toHaveBeenCalled();
    expect(sessions.types(sid).filter((t) => t === 'launch_dispatched')).toHaveLength(1);
  });

  it('a colliding ref belonging to a different caller (e.g. a program id) reads back as "not mine"', async () => {
    // 'language' is never a real sessionId in this store — readEvents resolves
    // empty, reduceSession yields no sessionId, and the bridge ignores it.
    bridge.start();
    await eventBus.emit('donow', approvedPayload({ ref: 'language', surface: 'portal' }));
    expect(close.execute).not.toHaveBeenCalled();
  });

  it('a session-read failure is swallowed, never thrown out of the handler', async () => {
    const throwingSessions = { readEvents: async () => { throw new Error('disk unavailable'); } };
    bridge = new DoNowSchoolBridge({
      realtime: new EventBusSchoolRealtimeAdapter({ eventBus }), sessions: throwingSessions, closeSessionOutcome: close, clock: clock.now, logger: silentLogger,
    });
    bridge.start();
    await expect(eventBus.emit('donow', approvedPayload({ ref: 'ses_1' }))).resolves.not.toThrow();
    expect(close.execute).not.toHaveBeenCalled();
  });
});
