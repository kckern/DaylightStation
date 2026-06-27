import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import { IdentityProvider, useIdentity } from './IdentityProvider';

const emergency = {
  phase: 'normal', lockedUntil: null, lockedBy: null,
  commit: vi.fn(), abort: vi.fn(), release: vi.fn(), triggerCeremony: vi.fn(),
};
vi.mock('@/modules/Fitness/hooks/useEmergencyLockdown.js', () => ({
  __esModule: true,
  default: () => emergency,
  PHASE_NORMAL: 'normal', PHASE_TRIGGERING: 'triggering', PHASE_LOCKED: 'locked',
}));

let wsHandler = null;
vi.mock('@/services/WebSocketService.js', () => ({
  __esModule: true,
  wsService: { subscribe: (_topics, cb) => { wsHandler = cb; return () => { wsHandler = null; }; } },
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
  render(<IdentityProvider><Probe onReady={() => {}} /></IdentityProvider>);
  emit({ matched: true, userId: 'kc', finger: 'right-index', authz: { admin: true, locks: ['emergency'] } });
  expect(emergency.triggerCeremony).toHaveBeenCalledTimes(1);
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
