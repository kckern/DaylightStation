import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import { IdentityProvider, useIdentity, UNLOCK_COOLDOWN_MS, CEREMONY_DEBOUNCE_MS } from './IdentityProvider';

const emergency = {
  phase: 'normal', lockedUntil: null, lockedBy: null,
  commit: vi.fn(), abort: vi.fn(), release: vi.fn(), triggerCeremony: vi.fn(), dismissCeremony: vi.fn(),
};
vi.mock('@/modules/Fitness/hooks/useEmergencyLockdown.js', () => ({
  __esModule: true,
  default: () => emergency,
  PHASE_NORMAL: 'normal', PHASE_TRIGGERING: 'triggering', PHASE_LOCKED: 'locked',
}));

let wsHandler = null;
vi.mock('@/services/WebSocketService.js', () => ({
  __esModule: true,
  // subscribe wires the identity handler; send/connect are no-ops so the logging
  // framework's buffered WS transport (which imports this same module) doesn't
  // throw a "WS batch send failed" warning when its queue flushes.
  wsService: {
    subscribe: (_topics, cb) => { wsHandler = cb; return () => { wsHandler = null; }; },
    send: () => {},
    connect: () => {},
  },
}));
vi.mock('@/context/FitnessContext.jsx', () => ({
  __esModule: true,
  useFitness: () => ({ fitnessConfiguration: {}, userCollections: { all: [{ id: 'kc', name: 'KC' }] } }),
}));
// Chime: resolve immediately so granted verdicts settle in tests. `autoDone`
// is controllable so a test can HOLD the success screen (chime pending) and
// exercise the cancel-during-granted race.
const chime = vi.hoisted(() => ({ autoDone: true }));
vi.mock('@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js', () => ({
  __esModule: true, playCueOnce: ({ onDone }) => { if (chime.autoDone) onDone?.(); return true; },
}));
vi.mock('@/modules/Fitness/player/hooks/audioCuePlayer.js', () => ({
  __esModule: true, primeCueAudio: vi.fn(),
}));

function emit(payload) { act(() => { wsHandler({ topic: 'fitness.identity.detected', ...payload }); }); }
function Probe({ onReady }) { const id = useIdentity(); onReady(id); return <div>{id.unlockState}</div>; }
beforeEach(() => { emergency.phase = 'normal'; chime.autoDone = true; vi.clearAllMocks(); });

test('no modal + emergency-authorized → starts ceremony', () => {
  vi.useFakeTimers();
  try {
    render(<IdentityProvider><Probe onReady={() => {}} /></IdentityProvider>);
    emit({ matched: true, userId: 'kc', finger: 'right-index', authz: { admin: true, locks: ['emergency'] } });
    // The open is debounced — it fires only after CEREMONY_DEBOUNCE_MS with no unlock.
    act(() => { vi.advanceTimersByTime(CEREMONY_DEBOUNCE_MS); });
    expect(emergency.triggerCeremony).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
test('triggering + emergency-authorized → abort', () => {
  emergency.phase = 'triggering';
  render(<IdentityProvider><Probe onReady={() => {}} /></IdentityProvider>);
  emit({ matched: true, userId: 'kc', authz: { admin: true, locks: ['emergency'] } });
  expect(emergency.abort).toHaveBeenCalledTimes(1);
});
test('modal open + authorized for that lock → granted verdict resolves', async () => {
  let api; render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  let verdict; act(() => { api.registerUnlock('dance_party').then((v) => { verdict = v; }); });
  emit({ matched: true, userId: 'kc', authz: { admin: false, locks: ['dance_party'] } });
  await waitFor(() => expect(verdict).toEqual({ matched: true, userId: 'kc' }));
});
test('modal open + recognized but NOT authorized → unauthorized, no resolve until cancel', async () => {
  let api; render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  let verdict; act(() => { api.registerUnlock('dance_party').then((v) => { verdict = v; }); });
  // A known person whose finger doesn't carry this lock → recognized, not allowed.
  emit({ matched: true, userId: 'kc', authz: { admin: false, locks: ['skip_content'] } });
  await waitFor(() => expect(api.unlockState).toBe('unauthorized'));
  expect(api.unlockedUser).toMatchObject({ userId: 'kc' });
  expect(verdict).toBeUndefined();
  act(() => { api.clearUnlock(); });
  await waitFor(() => expect(verdict).toEqual({ matched: false, reason: 'cancelled' }));
});
test('modal open + UNrecognized finger → denied (distinct from unauthorized)', async () => {
  let api; render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  act(() => { api.registerUnlock('dance_party'); });
  emit({ matched: false, userId: null, authz: { admin: false, locks: [] } });
  await waitFor(() => expect(api.unlockState).toBe('denied'));
});
test('grant during the success-hold survives a cancel — a decided grant is NOT downgraded to cancelled', async () => {
  // Hold the success screen open (chime hasn't finished) so the grant verdict is
  // decided but not yet resolved — the exact window a stray tap on Close hits.
  chime.autoDone = false;
  let api; render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  let verdict; act(() => { api.registerIdentify('emulator-save').then((v) => { verdict = v; }); });
  // First finger unrecognized → denied (no resolve).
  emit({ matched: false, userId: null });
  await waitFor(() => expect(api.unlockState).toBe('denied'));
  // Retry: recognized → granted, but held (chime pending), so not yet resolved.
  emit({ matched: true, userId: 'kc' });
  await waitFor(() => expect(api.unlockState).toBe('granted'));
  expect(verdict).toBeUndefined();
  // A tap on Close during the hold cancels — but the grant was already decided,
  // so the verdict must be the grant, not { matched:false }.
  act(() => { api.clearUnlock(); });
  await waitFor(() => expect(verdict).toEqual({ matched: true, userId: 'kc' }));
});

test('cancel with NO decided grant still resolves cancelled (play-without-saving path intact)', async () => {
  let api; render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  let verdict; act(() => { api.registerIdentify('emulator-save').then((v) => { verdict = v; }); });
  emit({ matched: false, userId: null });
  await waitFor(() => expect(api.unlockState).toBe('denied'));
  act(() => { api.clearUnlock(); });
  await waitFor(() => expect(verdict).toEqual({ matched: false, reason: 'cancelled' }));
});

test('no modal + non-emergency scan → ignored', () => {
  render(<IdentityProvider><Probe onReady={() => {}} /></IdentityProvider>);
  emit({ matched: true, userId: 'guest', authz: { admin: false, locks: ['dance_party'] } });
  expect(emergency.triggerCeremony).not.toHaveBeenCalled();
});

test('admin scan within the unlock cooldown does NOT open the emergency ceremony', () => {
  let api;
  render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  act(() => { api.registerAdmin('emulator'); });
  act(() => { api.clearUnlock(); });
  emit({ matched: true, userId: 'kc', finger: 'right-thumb', authz: { admin: true, locks: ['emergency'] } });
  expect(emergency.triggerCeremony).not.toHaveBeenCalled();
});

test('the unlock-cooldown boundary suppresses just before UNLOCK_COOLDOWN_MS and opens just after', () => {
  vi.useFakeTimers();
  try {
    // Move the clock via setSystemTime (not advanceTimersByTime) so we exercise the
    // Date.now()-based boundary without firing unrelated pending timers (e.g. the
    // logger's batch-flush) that would pollute the output.
    vi.setSystemTime(0);
    let api;
    render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
    // Stamp unlock activity at t0 (both calls stamp lastUnlockActivityRef to now).
    act(() => { api.registerAdmin('emulator'); });
    act(() => { api.clearUnlock(); });

    // Just BEFORE the boundary → still leftover unlock context → suppressed.
    vi.setSystemTime(UNLOCK_COOLDOWN_MS - 1);
    emit({ matched: true, userId: 'kc', finger: 'right-thumb', authz: { admin: true, locks: ['emergency'] } });
    expect(emergency.triggerCeremony).not.toHaveBeenCalled();

    // Branch (2) does not restamp, so the stamp is still at t0. Cross the boundary
    // (elapsed since t0 now exceeds UNLOCK_COOLDOWN_MS) → the scan ARMS the ceremony,
    // which then opens after the debounce elapses with no unlock.
    vi.setSystemTime(UNLOCK_COOLDOWN_MS + 1);
    emit({ matched: true, userId: 'kc', finger: 'right-thumb', authz: { admin: true, locks: ['emergency'] } });
    act(() => { vi.advanceTimersByTime(CEREMONY_DEBOUNCE_MS); });
    expect(emergency.triggerCeremony).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('the debounce cancels the ceremony when an unlock modal opens within the window', () => {
  vi.useFakeTimers();
  try {
    let api;
    render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
    // A cold admin emergency scan arrives (finger already down as the user taps a
    // game) → arms the debounced ceremony open, but does NOT open yet.
    emit({ matched: true, userId: 'kc', finger: 'right-thumb', authz: { admin: true, locks: ['emergency'] } });
    expect(emergency.triggerCeremony).not.toHaveBeenCalled();
    // Before the debounce elapses, the game's unlock modal registers → the scan was
    // an unlock, not an emergency. This must cancel the armed ceremony.
    act(() => { vi.advanceTimersByTime(CEREMONY_DEBOUNCE_MS - 100); });
    act(() => { api.registerAdmin('emulator'); });
    act(() => { vi.advanceTimersByTime(CEREMONY_DEBOUNCE_MS); });
    expect(emergency.triggerCeremony).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test('the debounce opens the ceremony when no unlock arrives within the window', () => {
  vi.useFakeTimers();
  try {
    render(<IdentityProvider><Probe onReady={() => {}} /></IdentityProvider>);
    emit({ matched: true, userId: 'kc', finger: 'right-thumb', authz: { admin: true, locks: ['emergency'] } });
    expect(emergency.triggerCeremony).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(CEREMONY_DEBOUNCE_MS); });
    expect(emergency.triggerCeremony).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('registerAdmin resolves only for an admin finger', async () => {
  let api;
  render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);
  let verdict;
  act(() => { api.registerAdmin('emulator').then((v) => { verdict = v; }); });

  // Recognized but non-admin → not granted; promise stays pending.
  emit({ matched: true, userId: 'kc', authz: { admin: false, locks: [] } });
  await waitFor(() => expect(api.unlockState).toBe('unauthorized'));
  expect(verdict).toBeUndefined();

  // Admin finger → granted.
  emit({ matched: true, userId: 'kc', authz: { admin: true } });
  await waitFor(() => expect(verdict).toMatchObject({ matched: true, userId: 'kc' }));
});
