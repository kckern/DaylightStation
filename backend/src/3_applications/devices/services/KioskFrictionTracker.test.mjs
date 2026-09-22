// backend/src/3_applications/devices/services/KioskFrictionTracker.test.mjs
import { describe, it, expect, vi, afterEach } from 'vitest';
import { KioskFrictionTracker } from './KioskFrictionTracker.mjs';

// None of the non-debounce tests below need a trailing flush to ever
// actually fire (every ping they make is either first-ever for its device
// or spaced past the debounce window), so a scheduler that never invokes
// its task is a faithful, inert stand-in for the real
// IApplicationScheduler port.
function inertScheduler() {
  return { after: () => () => {} };
}

function setup({ now = Date.UTC(2026, 8, 21, 12, 0, 0) } = {}) {
  const ingress = { observe: vi.fn(async () => ({ accepted: true })) };
  let clockValue = now;
  const clock = () => clockValue;
  const principal = { service: 'kiosk-friction-tracker' };
  const tracker = new KioskFrictionTracker({
    ingress, householdId: 'test-household', principal, windowMs: 60000, clock, logger: { warn: vi.fn() },
    scheduler: inertScheduler(),
  });
  return { tracker, ingress, advance: (ms) => { clockValue += ms; } };
}

describe('KioskFrictionTracker', () => {
  it('publishes a stable per-device-per-day assertion with the current rolling count', async () => {
    const { tracker, ingress } = setup();
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
    expect(ingress.observe).toHaveBeenCalledTimes(1);
    const [householdId, principal, assertion] = ingress.observe.mock.calls[0];
    expect(householdId).toBe('test-household');
    expect(principal).toEqual({ service: 'kiosk-friction-tracker' });
    expect(assertion).toMatchObject({
      claimTypeId: 'kiosk.friction-score',
      subject: { kind: 'device', id: 'portal' },
      value: 1,
    });
    expect(typeof assertion.assertionId).toBe('string');
    expect(assertion.assertionId).toContain('portal');
    expect(Number.isInteger(assertion.sourceRevision)).toBe(true);
    expect(assertion.sourceRevision).toBeGreaterThan(0);
    expect(typeof assertion.period?.id).toBe('string');
    expect(assertion.period?.kind).toBe('interval');
    expect(Number.isFinite(assertion.period?.startsAt)).toBe(true);
    expect(Number.isFinite(assertion.period?.endsAt)).toBe(true);
    // observedAt/validFrom/validUntil are epoch-ms numbers (State Gates'
    // `instant()` support fn requires Number.isFinite — an ISO string fails
    // that check), matching SchoolStateGatesProducer's own convention.
    expect(Number.isFinite(assertion.observedAt)).toBe(true);
    expect(Number.isFinite(assertion.validFrom)).toBe(true);
    expect(assertion.validUntil).toBeLessThanOrEqual(assertion.period.endsAt);
  });

  it('corrects the SAME assertion id in place across multiple pings the same day, with a strictly increasing sourceRevision', async () => {
    const { tracker, ingress, advance } = setup();
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
    // Past the default publish debounce (3s, see "debounce" describe block
    // below) so both pings publish immediately rather than the second being
    // collapsed into a later trailing flush.
    advance(3_500);
    await tracker.recordFriction({ deviceId: 'portal', kind: 'code-rejected' });
    const [, , first] = ingress.observe.mock.calls[0];
    const [, , second] = ingress.observe.mock.calls[1];
    expect(second.assertionId).toBe(first.assertionId);
    expect(second.sourceRevision).toBeGreaterThan(first.sourceRevision);
    expect(second.value).toBe(2);
  });

  it('keeps separate rolling counts and separate assertion ids per device', async () => {
    const { tracker, ingress } = setup();
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
    await tracker.recordFriction({ deviceId: 'yellow-room-tablet', kind: 'video-restart' });
    const [, , portalAssertion] = ingress.observe.mock.calls[0];
    const [, , pianoAssertion] = ingress.observe.mock.calls[1];
    expect(portalAssertion.assertionId).not.toBe(pianoAssertion.assertionId);
    expect(portalAssertion.value).toBe(1);
    expect(pianoAssertion.value).toBe(1);
  });

  it('rolls the friction count off after the window elapses', async () => {
    const { tracker, ingress, advance } = setup();
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
    advance(120000); // well past the 60s window
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
    const [, , second] = ingress.observe.mock.calls[1];
    expect(second.value).toBe(1);
  });

  it('a null or empty deviceId is dropped silently — never reaches ingress, never throws', async () => {
    const { tracker, ingress } = setup();
    await expect(tracker.recordFriction({ deviceId: null, kind: 'code-rejected' })).resolves.not.toThrow();
    await expect(tracker.recordFriction({ deviceId: '', kind: 'code-rejected' })).resolves.not.toThrow();
    await expect(tracker.recordFriction({ deviceId: '   ', kind: 'code-rejected' })).resolves.not.toThrow();
    await expect(tracker.recordFriction({ deviceId: undefined, kind: 'code-rejected' })).resolves.not.toThrow();
    expect(ingress.observe).not.toHaveBeenCalled();
  });

  it('a failed publish does not throw back to the caller (fire-and-forget posture)', async () => {
    const ingress = { observe: vi.fn(async () => { throw new Error('state gates unreachable'); }) };
    const logger = { warn: vi.fn() };
    const tracker = new KioskFrictionTracker({
      ingress, householdId: 'test-household', principal: { service: 'kiosk-friction-tracker' },
      windowMs: 60000, clock: () => 0, logger, scheduler: inertScheduler(),
    });
    await expect(tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' })).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('KioskFrictionTracker publish debounce', () => {
  afterEach(() => { vi.useRealTimers(); });

  // Fake timers + `clock: () => Date.now()` is the established pattern for
  // testing a debounce/timer path in this codebase (see
  // backend/src/5_composition/modules/stateGates.retry.test.mjs). The fake
  // scheduler mirrors NodeApplicationScheduler.after exactly (setTimeout +
  // a clearTimeout cancel), which vi's fake timers intercept the same way.
  function fakeScheduler() {
    return { after: (delayMs, task) => { const t = setTimeout(task, delayMs); return () => clearTimeout(t); } };
  }

  function debounceSetup({ now = Date.UTC(2026, 8, 21, 12, 0, 0), ...overrides } = {}) {
    vi.useFakeTimers({ now });
    const ingress = { observe: vi.fn(async () => ({ accepted: true })) };
    const tracker = new KioskFrictionTracker({
      ingress, householdId: 'test-household', principal: { service: 'kiosk-friction-tracker' },
      windowMs: 60_000, clock: () => Date.now(), logger: { warn: vi.fn() },
      scheduler: fakeScheduler(), debounceMs: 1_000, ...overrides,
    });
    return { tracker, ingress };
  }

  it('collapses a rapid burst for one device into far fewer than 10 publishes, and the LAST published value reflects the true final rolling count', async () => {
    // denialThreshold pushed well above the burst size (10) so threshold
    // crossing — covered by its own test below — cannot also trigger an
    // immediate publish here; this test isolates pure debounce collapsing.
    const { tracker, ingress } = debounceSetup({ debounceMs: 1_000, denialThreshold: 1_000 });
    for (let i = 0; i < 10; i += 1) {
      await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
      await vi.advanceTimersByTimeAsync(50); // 10 pings, 500ms burst — well inside the 1s debounce window
    }
    // Only the very first ping (first-ever for this device) published so far.
    expect(ingress.observe).toHaveBeenCalledTimes(1);
    expect(ingress.observe.mock.calls[0][2].value).toBe(1);

    // Let the trailing flush fire — it re-reads the rolling window at fire
    // time, so it must reflect all 10 pings, not just the state when the
    // timer was originally scheduled.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ingress.observe.mock.calls.length).toBeLessThan(10);
    const last = ingress.observe.mock.calls.at(-1)[2];
    expect(last.value).toBe(10);
  });

  it('publishes immediately when a ping crosses the denial threshold, even mid-debounce-window', async () => {
    const { tracker, ingress } = debounceSetup({ debounceMs: 5_000, denialThreshold: 3 });
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' }); // 1st: first-ever -> publishes immediately (value 1)
    await vi.advanceTimersByTimeAsync(100);
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' }); // 2nd: value 2, still below threshold -> debounced
    await vi.advanceTimersByTimeAsync(100);
    expect(ingress.observe).toHaveBeenCalledTimes(1);

    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' }); // 3rd: value 3 crosses the threshold (2 < 3 -> 3 < 3 is false)
    expect(ingress.observe).toHaveBeenCalledTimes(2);
    expect(ingress.observe.mock.calls[1][2].value).toBe(3);
  });

  it('debounces separate devices independently', async () => {
    const { tracker, ingress } = debounceSetup({ debounceMs: 3_000 });
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' }); // first-ever for portal -> publishes
    await tracker.recordFriction({ deviceId: 'yellow-room-tablet', kind: 'video-restart' }); // first-ever for the other device -> publishes
    expect(ingress.observe).toHaveBeenCalledTimes(2);

    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' }); // debounced against portal's own last publish
    await tracker.recordFriction({ deviceId: 'yellow-room-tablet', kind: 'video-restart' }); // debounced independently
    expect(ingress.observe).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3_000); // both devices' trailing flushes fire
    expect(ingress.observe).toHaveBeenCalledTimes(4);
    const flushed = ingress.observe.mock.calls.slice(2).map(([, , assertion]) => `${assertion.subject.id}:${assertion.value}`);
    expect(flushed).toEqual(expect.arrayContaining(['portal:2', 'yellow-room-tablet:2']));
  });
});
