import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';

beforeAll(() => {
  if (!global.ResizeObserver) {
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => logSpy }) }));
vi.mock('@mantine/core', () => ({ LoadingOverlay: () => null, Alert: ({ children }) => <div>{children}</div> }));
let mockCtx;
vi.mock('../context/FitnessContext.jsx', () => ({ useFitness: () => mockCtx }));
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => p,
  DaylightImagePath: (p) => `/api/v1/static/img/${p}`,
  ContentDisplayUrl: (id) => `display:${id}`,
  normalizeImageUrl: (u) => u || '',
}));
vi.mock('@/lib/kioskEnv.js', () => ({ isKioskEnv: () => true }));
const identity = vi.hoisted(() => ({}));
vi.mock('../identity/useIdentity.js', () => ({ __esModule: true, useIdentity: () => identity }));

import { DaylightAPI } from '@/lib/api.mjs';
import FitnessShow from './FitnessShow.jsx';
import { __resetPresenceGateStore } from '../hooks/usePresenceGate.js';

// Presence gate at show entry: while the supervising adult is away the show's
// contents never render until an admin fingerprint unlocks the kiosk.
const SHOW = {
  info: { type: 'show', title: 'Plain Show', labels: [], image: 'poster.jpg' },
  items: [{ plex: '101', id: 'plex:101', label: 'Ep 1', parentId: 'p1', itemIndex: 1, image: 'e1.jpg', duration: 600, isWatched: false }],
  parents: { p1: { index: 1, title: 'Season 1' } },
};
const GATE_CFG = { enabled: true, entity: 'binary_sensor.adult_home', gate: ['play', 'show'] };
const STABLE = [];
const ctx = (fitnessConfiguration) => ({
  setMusicAutoEnabled: vi.fn(), setCurrentMedia: vi.fn(), nomusicLabels: STABLE,
  fitnessConfiguration, governedLabels: [], governedTypes: [], plexConfig: {},
});
let presence;
const presenceCalls = () => DaylightAPI.mock.calls.filter(([u]) => String(u).includes('/fitness/presence'));

function renderShow(config, onBack = vi.fn()) {
  mockCtx = ctx(config);
  render(<FitnessShow showId="plex:9000" setFitnessPlayQueue={vi.fn()} onPlay={vi.fn()} onBack={onBack} />);
  return onBack;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetPresenceGateStore();
  Object.assign(identity, {
    registerUnlock: vi.fn(() => new Promise(() => {})),
    registerAdmin: vi.fn(() => new Promise(() => {})),
    clearUnlock: vi.fn(), unlockState: 'scanning', unlockedUser: null, activeLock: null,
  });
  presence = { enabled: true, home: true, state: 'on', reason: null };
  DaylightAPI.mockImplementation(async (url) => (String(url).includes('/fitness/presence') ? presence : SHOW));
});
afterEach(() => { cleanup(); __resetPresenceGateStore(); });

describe('FitnessShow presence gate', () => {
  it('no presence_gate config → show opens, presence never requested', async () => {
    renderShow({ locks: {} });
    await screen.findByText('Plain Show', {}, { timeout: 4000 });
    expect(presenceCalls()).toHaveLength(0);
    expect(identity.registerAdmin).not.toHaveBeenCalled();
  });

  it('adult home → show opens without a prompt', async () => {
    renderShow({ presence_gate: GATE_CFG });
    await screen.findByText('Plain Show', {}, { timeout: 4000 });
    expect(presenceCalls().length).toBeGreaterThan(0);
    expect(identity.registerAdmin).not.toHaveBeenCalled();
  });

  it('gate: [play] only → show entry is not gated', async () => {
    presence = { enabled: true, home: false, state: 'off', reason: null };
    renderShow({ presence_gate: { ...GATE_CFG, gate: ['play'] } });
    await screen.findByText('Plain Show', {}, { timeout: 4000 });
    expect(identity.registerAdmin).not.toHaveBeenCalled();
  });

  it('adult away → contents hidden and the admin prompt opens', async () => {
    presence = { enabled: true, home: false, state: 'off', reason: null };
    renderShow({ presence_gate: GATE_CFG });
    await waitFor(() => expect(identity.registerAdmin).toHaveBeenCalledExactlyOnceWith('presence_gate'));
    expect(screen.queryByText('Plain Show')).not.toBeInTheDocument();
    expect(screen.queryByText('Ep 1')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Fingerprint unlock' })).toBeVisible();
  });

  it('sensor unavailable → gated (fail closed)', async () => {
    presence = { enabled: true, home: false, state: 'unavailable', reason: 'unavailable' };
    renderShow({ presence_gate: GATE_CFG });
    await waitFor(() => expect(identity.registerAdmin).toHaveBeenCalled());
    expect(screen.queryByText('Plain Show')).not.toBeInTheDocument();
  });

  it('admin unlock → the show opens', async () => {
    presence = { enabled: true, home: false, state: 'off', reason: null };
    let resolveScan;
    identity.registerAdmin = vi.fn(() => new Promise((r) => { resolveScan = r; }));
    renderShow({ presence_gate: GATE_CFG });
    await waitFor(() => expect(identity.registerAdmin).toHaveBeenCalled());
    await act(async () => resolveScan({ matched: true, userId: 'parent' }));
    await screen.findByText('Plain Show', {}, { timeout: 4000 });
    expect(logSpy.info).toHaveBeenCalledWith('fitness.presence_gate.unlocked', expect.objectContaining({ userId: 'parent', kind: 'show' }));
  });

  it('cancelled prompt → goes back', async () => {
    presence = { enabled: true, home: false, state: 'off', reason: null };
    let resolveScan;
    identity.registerAdmin = vi.fn(() => new Promise((r) => { resolveScan = r; }));
    const onBack = renderShow({ presence_gate: GATE_CFG });
    await waitFor(() => expect(identity.registerAdmin).toHaveBeenCalled());
    await act(async () => resolveScan({ matched: false, reason: 'cancelled' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByTestId('presence-gate-notice')).toBeInTheDocument();
  });
});
