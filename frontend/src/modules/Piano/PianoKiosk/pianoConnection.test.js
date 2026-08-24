import { describe, expect, it, vi } from 'vitest';
import { derivePianoHealth, runPianoRepair } from './pianoConnection.js';

describe('derivePianoHealth', () => {
  it.each([
    [{ midiHealth: { in: 'bridge', out: 'up' }, status: 'connected' }, 'ready'],
    [{ midiHealth: { in: 'webmidi', out: 'up' }, status: 'connected', bridgeUnavailable: true }, 'ready'],
    [{ midiHealth: { in: 'bridge', out: 'down' }, status: 'connected' }, 'input-only'],
    [{ midiHealth: { in: 'down', out: 'up' }, status: 'no-input', bridgeUnavailable: true }, 'output-only'],
    [{ midiHealth: { in: 'down', out: 'down' }, status: 'requesting' }, 'connecting'],
    [{ midiHealth: { in: 'down', out: 'down' }, status: 'no-input', bridgeLink: 'reconnecting', bridgeUnavailable: false }, 'connecting'],
    [{ midiHealth: { in: 'down', out: 'down' }, status: 'no-input', bridgeLink: 'closed', bridgeUnavailable: true }, 'offline'],
    [{ status: 'no-input', bridgeLink: 'closed', bridgeUnavailable: true }, 'offline'],
  ])('maps raw connection state to %s', (raw, expected) => expect(derivePianoHealth(raw)).toBe(expected));
});

const setup = (overrides = {}) => {
  const order = [];
  let snapshot = { health: 'offline', generation: 1 };
  const deps = {
    attemptId: 4,
    bridgeAvailable: true,
    resetBridge: vi.fn(async () => { order.push('bridge'); return { ok: true }; }),
    reacquireMidi: vi.fn(async () => { order.push('midi'); snapshot = { health: 'ready', generation: 2 }; return { ok: true }; }),
    getSnapshot: () => snapshot,
    waitForReady: vi.fn(async ({ afterGeneration }) => snapshot.generation > afterGeneration && snapshot.health === 'ready' ? snapshot : null),
    reassertSound: vi.fn(() => order.push('sound')),
    reassertLevel: vi.fn(() => order.push('level')),
    now: (() => { let n = 100; return () => n += 5; })(),
    ...overrides,
  };
  return { deps, order, setSnapshot: (value) => { snapshot = value; } };
};

describe('runPianoRepair', () => {
  it('resets bridge, reacquires, waits for fresh ready, then reasserts state in order', async () => {
    const { deps, order } = setup();
    const result = await runPianoRepair(deps);
    expect(order).toEqual(['bridge', 'midi', 'sound', 'level']);
    expect(result).toMatchObject({ ok: true, phase: 'complete', bridgeReset: 'succeeded', health: 'ready', reasserted: true });
  });

  it('skips bridge reset for non-kiosk fallback but keeps the rest of the protocol', async () => {
    const { deps, order } = setup({ bridgeAvailable: false });
    const result = await runPianoRepair(deps);
    expect(deps.resetBridge).not.toHaveBeenCalled();
    expect(order).toEqual(['midi', 'sound', 'level']);
    expect(result.bridgeReset).toBe('skipped');
  });

  it('returns structured bridge, MIDI, health, partial, and reassert failures', async () => {
    let subject = setup({ resetBridge: vi.fn(async () => ({ ok: false, reason: 'timeout' })) });
    await expect(runPianoRepair(subject.deps)).resolves.toMatchObject({ ok: false, phase: 'bridge-reset', reason: 'timeout' });
    subject = setup({ resetBridge: vi.fn(async () => { throw new Error('network'); }) });
    await expect(runPianoRepair(subject.deps)).resolves.toMatchObject({ ok: false, phase: 'bridge-reset', reason: 'request-failed' });
    subject = setup({ reacquireMidi: vi.fn(async () => ({ ok: false, reason: 'denied' })) });
    await expect(runPianoRepair(subject.deps)).resolves.toMatchObject({ ok: false, phase: 'midi-reacquire', reason: 'denied' });
    subject = setup({ reacquireMidi: vi.fn(async () => { throw new Error('denied'); }) });
    await expect(runPianoRepair(subject.deps)).resolves.toMatchObject({ ok: false, phase: 'midi-reacquire', reason: 'midi-reacquire-failed' });
    subject = setup({
      reacquireMidi: vi.fn(async () => ({ ok: true })),
      waitForReady: vi.fn(async () => null),
    });
    subject.setSnapshot({ health: 'input-only', generation: 2 });
    await expect(runPianoRepair(subject.deps)).resolves.toMatchObject({ ok: false, phase: 'health-wait', reason: 'health-timeout', health: 'input-only' });
    subject = setup({ reassertSound: vi.fn(() => { throw new Error('boom'); }) });
    await expect(runPianoRepair(subject.deps)).resolves.toMatchObject({ ok: false, phase: 'reassert', reason: 'reassert-failed' });
  });
});
