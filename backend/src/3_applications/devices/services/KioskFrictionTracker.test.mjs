// backend/src/3_applications/devices/services/KioskFrictionTracker.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { KioskFrictionTracker } from './KioskFrictionTracker.mjs';

function setup({ now = Date.UTC(2026, 8, 21, 12, 0, 0) } = {}) {
  const ingress = { observe: vi.fn(async () => ({ accepted: true })) };
  let clockValue = now;
  const clock = () => clockValue;
  const principal = { service: 'kiosk-friction-tracker' };
  const tracker = new KioskFrictionTracker({
    ingress, householdId: 'test-household', principal, windowMs: 60000, clock, logger: { warn: vi.fn() },
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
    const { tracker, ingress } = setup();
    await tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' });
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

  it('a failed publish does not throw back to the caller (fire-and-forget posture)', async () => {
    const ingress = { observe: vi.fn(async () => { throw new Error('state gates unreachable'); }) };
    const logger = { warn: vi.fn() };
    const tracker = new KioskFrictionTracker({
      ingress, householdId: 'test-household', principal: { service: 'kiosk-friction-tracker' },
      windowMs: 60000, clock: () => 0, logger,
    });
    await expect(tracker.recordFriction({ deviceId: 'portal', kind: 'stray-press' })).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });
});
