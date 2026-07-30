/**
 * DoNowSchoolBridge (Task 12, spec §6 "The approval gap"): the school
 * lifecycle's subscription to `donow.dispatched`, closing the loop for a
 * `launch:` unit whose scan PENDED and was approved later, out of band, by a
 * grown-up working the approvals queue — nobody is scanning a card at that
 * moment for `ResolveScanAction` to answer synchronously.
 *
 * Ownership is a REPOSITORY LOOKUP, never shape matching: only
 * `requestedBy === 'school-scan'` AND a `ref` this store resolves to a real
 * session sitting at `created` gets acted on. Everything else — a different
 * provenance, an unresolvable ref, a ref already past `created` — is ignored
 * by construction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoNowSchoolBridge } from '#apps/school/DoNowSchoolBridge.mjs';
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
  bridge = new DoNowSchoolBridge({ eventBus, sessions, closeSessionOutcome: close, clock: clock.now, logger: silentLogger });
};

beforeEach(() => build());

describe('construction', () => {
  it('requires eventBus, sessions and closeSessionOutcome', () => {
    expect(() => new DoNowSchoolBridge({})).toThrow();
    expect(() => new DoNowSchoolBridge({ eventBus, sessions })).toThrow();
    expect(() => new DoNowSchoolBridge({ eventBus, closeSessionOutcome: close })).toThrow();
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
    await eventBus.emit('donow', { type: 'donow.dispatched', ref: sid, surface: 'garage-fitness', requestedBy: 'school-scan' });
    expect(close.execute).not.toHaveBeenCalled();
    expect(sessions.types(sid)).not.toContain('launch_dispatched');
  });
});

describe('the ownership filter (spec §6)', () => {
  it('acts on a school-scan dispatch whose ref resolves to a session at created: appends launch_dispatched and honor-closes', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    bridge.start();

    await eventBus.emit('donow', { type: 'donow.dispatched', ref: sid, surface: 'garage-fitness', requestedBy: 'school-scan' });

    expect(sessions.types(sid)).toContain('launch_dispatched');
    const event = (await sessions.readEvents(sid)).find((e) => e.type === 'launch_dispatched');
    expect(event).toMatchObject({ surface: 'garage-fitness' });
    expect(close.execute).toHaveBeenCalledWith({ sessionId: sid, honorClose: true });
  });

  it('ignores a different requestedBy (e.g. school-program) even if the ref happens to resolve to a session', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    bridge.start();

    await eventBus.emit('donow', { type: 'donow.dispatched', ref: sid, surface: 'portal', requestedBy: 'school-program' });

    expect(close.execute).not.toHaveBeenCalled();
    expect(sessions.types(sid)).not.toContain('launch_dispatched');
  });

  it('ignores an event type other than donow.dispatched', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    bridge.start();

    await eventBus.emit('donow', { type: 'donow.pending', ref: sid, surface: 'garage-fitness', requestedBy: 'school-scan' });

    expect(close.execute).not.toHaveBeenCalled();
  });

  it('ignores a ref this store cannot resolve to any session (unknown id) — never a shape check', async () => {
    bridge.start();
    await eventBus.emit('donow', { type: 'donow.dispatched', ref: 'ses_nope', surface: 'garage-fitness', requestedBy: 'school-scan' });
    expect(close.execute).not.toHaveBeenCalled();
  });

  it('ignores a ref whose session has already moved past created (not this bridge\'s to close)', async () => {
    const sid = 'ses_1';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: 'unit-1' });
    await sessions.appendEvent(sid, { type: 'launch_dispatched', at: clock.iso(), sessionId: sid, surface: 'garage-fitness' });
    bridge.start();

    await eventBus.emit('donow', { type: 'donow.dispatched', ref: sid, surface: 'garage-fitness', requestedBy: 'school-scan' });

    // Still only the one launch_dispatched event that was already there — the
    // bridge did not append a second one or re-honor-close.
    expect(close.execute).not.toHaveBeenCalled();
    expect(sessions.types(sid).filter((t) => t === 'launch_dispatched')).toHaveLength(1);
  });

  it('a colliding ref belonging to a different caller (e.g. a program id) reads back as "not mine"', async () => {
    // 'language' is never a real sessionId in this store — readEvents resolves
    // empty, reduceSession yields no sessionId, and the bridge ignores it.
    bridge.start();
    await eventBus.emit('donow', { type: 'donow.dispatched', ref: 'language', surface: 'portal', requestedBy: 'school-scan' });
    expect(close.execute).not.toHaveBeenCalled();
  });

  it('a session-read failure is swallowed, never thrown out of the handler', async () => {
    const throwingSessions = { readEvents: async () => { throw new Error('disk unavailable'); } };
    bridge = new DoNowSchoolBridge({
      eventBus, sessions: throwingSessions, closeSessionOutcome: close, clock: clock.now, logger: silentLogger,
    });
    bridge.start();
    await expect(eventBus.emit('donow', {
      type: 'donow.dispatched', ref: 'ses_1', surface: 'garage-fitness', requestedBy: 'school-scan',
    })).resolves.not.toThrow();
    expect(close.execute).not.toHaveBeenCalled();
  });
});
