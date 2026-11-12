import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  localDev: false,
  payload: { items: [] },
  api: null,
  stateGates: null,
  log: { info: () => {}, warn: () => {} },
  components: [],
}));
vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: (_topic, handler) => { mocks.stateGates = handler; } }));
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...args) => mocks.api(...args) }));
vi.mock('@/lib/kioskEnv.js', () => ({ isLocalDevHost: () => mocks.localDev }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: (context) => { mocks.components.push(context.component); return mocks.log; } }) }));

import useSkylineAccess, { activeSkylineDecision } from "./useSkylineAccess.js";

const decision = (overrides = {}) => ({
  capabilityId: 'fitness.skyline-glider',
  decision: 'granted',
  subject: { kind: 'learner', id: 'test-rider' },
  period: { kind: 'interval', id: 'school-day:2026-10-07', startsAt: 1_000, endsAt: 10_000 },
  validFrom: 2_000,
  validUntil: 8_000,
  ...overrides,
});

describe('activeSkylineDecision', () => {
  it('accepts a decision only inside both its school period and validity window', () => {
    expect(activeSkylineDecision({ items: [decision()] }, 'test-rider', 5_000)).toMatchObject({ decision: 'granted' });
  });

  it('rejects decisions that are not yet valid, expired, or missing validity bounds', () => {
    expect(activeSkylineDecision({ items: [decision()] }, 'test-rider', 1_500)).toBeNull();
    expect(activeSkylineDecision({ items: [decision()] }, 'test-rider', 8_000)).toBeNull();
    expect(activeSkylineDecision({ items: [decision({ validFrom: undefined })] }, 'test-rider', 5_000)).toBeNull();
    expect(activeSkylineDecision({ items: [decision({ validUntil: undefined })] }, 'test-rider', 5_000)).toBeNull();
  });
});

describe('useSkylineAccess with a capability id', () => {
  const INVADERS = { schoolLearner: true, capabilityId: 'fitness.skyline-invaders', logScope: 'skyline_invaders' };
  // A decision whose school day and validity window contain the real clock.
  const live = (overrides = {}) => {
    const now = Date.now();
    return decision({
      period: { kind: 'interval', id: 'school-day:2026-10-07', startsAt: now - 60_000, endsAt: now + 3_600_000 },
      validFrom: now - 60_000,
      validUntil: now + 3_600_000,
      ...overrides,
    });
  };
  const askedFor = () => mocks.api.mock.calls.map(([url]) => new URLSearchParams(url.split('?')[1]).get('capabilityId'));

  beforeEach(() => {
    mocks.localDev = false;
    mocks.payload = { items: [] };
    mocks.api = vi.fn(async () => {
      if (mocks.payload instanceof Error) throw mocks.payload;
      return mocks.payload;
    });
    mocks.log = { info: vi.fn(), warn: vi.fn() };
    mocks.components = [];
    mocks.stateGates = null;
  });

  it('reads a decision for the capability it is asked about', () => {
    const items = [decision(), decision({ capabilityId: 'fitness.skyline-invaders', decision: 'denied' })];
    expect(activeSkylineDecision({ items }, 'test-rider', 5_000, 'fitness.skyline-invaders')).toMatchObject({ decision: 'denied' });
    expect(activeSkylineDecision({ items }, 'test-rider', 5_000)).toMatchObject({ decision: 'granted' });
  });

  it('gates another capability under its own log scope', async () => {
    mocks.payload = { items: [live({ capabilityId: 'fitness.skyline-invaders' })] };
    const { result } = renderHook(() => useSkylineAccess('test-rider', INVADERS));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(askedFor()).toEqual(['fitness.skyline-invaders']);
    expect(result.current).toMatchObject({ unlocked: true, state: 'complete' });
    expect(mocks.log.info).toHaveBeenCalledWith('skyline_invaders.access.verdict', expect.objectContaining({ unlocked: true }));
    expect(mocks.components).toContain('skyline-invaders-access');
    expect(mocks.components).not.toContain('skyline-glider-access');
  });

  it('does not unlock one game with the other game\'s entitlement', async () => {
    mocks.payload = { items: [live()] };   // a Skyline Glider grant
    const { result } = renderHook(() => useSkylineAccess('test-rider', INVADERS));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.unlocked).toBe(false);
  });

  it('still defaults to Skyline Glider', async () => {
    mocks.payload = { items: [live()] };
    const { result } = renderHook(() => useSkylineAccess('test-rider', { schoolLearner: true }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(askedFor()).toEqual(['fitness.skyline-glider']);
    expect(result.current.unlocked).toBe(true);
    expect(mocks.log.info).toHaveBeenCalledWith('skyline_glider.access.verdict', expect.objectContaining({ unlocked: true }));
    expect(mocks.components).toContain('skyline-glider-access');
  });

  it('refreshes on a state-gates change for its own capability only', async () => {
    const { result } = renderHook(() => useSkylineAccess('test-rider', INVADERS));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.unlocked).toBe(false);
    mocks.payload = { items: [live({ capabilityId: 'fitness.skyline-invaders' })] };
    await act(async () => { mocks.stateGates({ payload: { capabilityId: 'fitness.skyline-glider', subject: { id: 'test-rider' } } }); });
    expect(mocks.api).toHaveBeenCalledTimes(1);
    await act(async () => { mocks.stateGates({ payload: { capabilityId: 'fitness.skyline-invaders', subject: { id: 'test-rider' } } }); });
    await waitFor(() => expect(result.current.unlocked).toBe(true));
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it('logs a failed read under the caller\'s scope and stays locked', async () => {
    mocks.payload = new Error('offline');
    const { result } = renderHook(() => useSkylineAccess('test-rider', INVADERS));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.unlocked).toBe(false);
    expect(mocks.log.warn).toHaveBeenCalledWith('skyline_invaders.access.read_failed', expect.objectContaining({ error: 'offline' }));
  });
});
