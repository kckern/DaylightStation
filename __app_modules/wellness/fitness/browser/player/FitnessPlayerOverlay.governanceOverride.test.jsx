import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// --- Isolation mocks -------------------------------------------------------
// Audio host plays cue files on mount; stub it (mirrors GovernanceStateOverlay.unlock.test.jsx).
vi.mock("./overlays/GovernanceAudioPlayer.jsx", () => ({
  __esModule: true,
  default: ({ trackKey }) => <audio aria-label={`Governance cue ${trackKey}`} />
}));
// Off-screen demo owns chart and microphone dependencies; the real lock UI stays live.
vi.mock("../widgets/CycleChallengeDemo/CycleChallengeDemo.jsx", () => ({ default: () => null }));
// No overlay app is open; avoid initializing the unrelated widget registry.
vi.mock('./FitnessModuleContainer.jsx', () => ({ default: () => null }));
// Render profiler is a dev-only no-op hook; stub so it never touches perf APIs.
vi.mock("../hooks/fitness/useRenderProfiler.js", () => ({ __esModule: true, useRenderProfiler: () => {} }));
vi.mock('@/lib/api.mjs', () => ({
  __esModule: true,
  DaylightMediaPath: (p) => p,
  DaylightImagePath: (p) => `/api/v1/static/img/${p}`,
  DaylightAPI: vi.fn().mockResolvedValue({})
}));
// Logger init touches a shared WebSocket transport; stub it so a mount-time
// logger call can never surface as a confusing transport error instead of the
// assertion under test. Mirrors the pattern in FitnessShow.unlock.test.jsx, but
// supports BOTH the default-import (FitnessPlayerOverlay) and named-import
// (GovernanceStateOverlay) call sites, with a full child-logger surface.
vi.mock('@/lib/logging/Logger.js', () => {
  const child = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(), child: () => child() });
  const logger = { child };
  const getLogger = () => logger;
  return { __esModule: true, default: getLogger, getLogger };
});

// Controllable context: the test sets `mockGovernanceState` before each render.
let mockGovernanceState = null;
vi.mock("../context/FitnessContext.jsx", () => ({
  __esModule: true,
  useFitnessContext: () => ({
    governanceState: mockGovernanceState,
    voiceMemoOverlayState: { open: false },
    fitnessSessionInstance: null,
    participantDisplayMap: new Map(),
    zoneMetadata: {},
    activeHeartRateParticipants: [],
    zones: [],
    overlayApp: null,
    closeApp: () => {},
    getDisplayName: (uid) => ({ displayName: uid }),
    pauseMusicPlayer: () => {}
  })
}));

import FitnessPlayerOverlay from "./FitnessPlayerOverlay.jsx";

// A real "locked + governed" engine snapshot: useGovernanceDisplay returns show:true for this.
const LOCKED_STATE = {
  isGoverned: true,
  status: 'locked',
  videoLocked: true,
  challenge: null,
  deadline: null,
  requirements: [],
  activeUserCount: 2
};

// The bypass-aware snapshot FitnessPlayer builds when a bypass is active:
// isGoverned:false short-circuits useGovernanceDisplay to null ⇒ overlay suppressed.
const BYPASSED_STATE = {
  isGoverned: false,
  status: 'unlocked',
  videoLocked: false,
  challenge: null,
  deadline: null,
  audioDuck: null
};

function renderOverlay(props) {
  return render(
    <MemoryRouter>
      <FitnessPlayerOverlay playerRef={{ current: null }} showFullscreenVitals={false} {...props} />
    </MemoryRouter>
  );
}

describe('FitnessPlayerOverlay governance override', () => {
  afterEach(() => { cleanup(); mockGovernanceState = null; });

  it('shows the governance lock panel from context when no override is given (regression guard)', () => {
    mockGovernanceState = LOCKED_STATE;
    const { container } = renderOverlay({});
    expect(container.querySelector('.governance-overlay')).not.toBeNull();
  });

  it('hides the governance lock panel when the override reports an unlocked/bypassed state', () => {
    mockGovernanceState = LOCKED_STATE; // context still says LOCKED…
    const { container } = renderOverlay({ governanceStateOverride: BYPASSED_STATE }); // …but override wins.
    expect(container.querySelector('.governance-overlay')).toBeNull();
  });
});

const CYCLE_CHALLENGE = {
  id: 'cycle-1', type: 'cycle', status: 'pending', cycleState: 'locked', lockReason: 'health',
  rider: { id: 'rider', name: 'Rider' }, currentPhase: { hiRpm: 70, loRpm: 50 },
  currentRpm: 0, currentPhaseIndex: 0, totalPhases: 2, phaseProgressPct: 0.4,
  cycleHealthPct: 0, baseReqSatisfiedForRider: true,
};
const CYCLE_STATE = { ...LOCKED_STATE, status: 'unlocked', challenge: CYCLE_CHALLENGE };

describe('FitnessPlayerOverlay cycling bypass and recovery', () => {
  afterEach(() => { cleanup(); mockGovernanceState = null; });

  it.each(['init', 'ramp', 'health', 'failed'])('offers one pointer unlock on a promoted %s cycle screen', (reason) => {
    mockGovernanceState = {
      ...CYCLE_STATE,
      challenge: { ...CYCLE_CHALLENGE, lockReason: reason, status: reason === 'failed' ? 'failed' : 'pending' }
    };
    const onGovernanceUnlock = vi.fn();
    renderOverlay({ onGovernanceUnlock });
    const button = screen.getByRole('button', { name: 'Skip / Unlock' });
    expect(button).toBeVisible();
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(onGovernanceUnlock).toHaveBeenCalledTimes(1);
  });

  it.each(['Enter', ' '])('supports one %s keyboard unlock on the cycle dialog', (key) => {
    mockGovernanceState = CYCLE_STATE;
    const onGovernanceUnlock = vi.fn();
    renderOverlay({ onGovernanceUnlock });
    const button = screen.getByRole('button', { name: 'Skip / Unlock' });
    button.focus();
    fireEvent.keyDown(button, { key });
    fireEvent.keyUp(button, { key });
    expect(button).toHaveFocus();
    expect(onGovernanceUnlock).toHaveBeenCalledTimes(1);
  });

  it('omits cycling unlock when the callback is absent', () => {
    mockGovernanceState = CYCLE_STATE;
    renderOverlay({});
    expect(screen.getByRole('dialog', { name: 'Cycle challenge locked' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Skip / Unlock' })).not.toBeInTheDocument();
  });

  it('suppresses the cycle stage, dial and lock audio under a bypass-aware snapshot', () => {
    mockGovernanceState = CYCLE_STATE;
    const { container } = renderOverlay({ governanceStateOverride: BYPASSED_STATE });
    expect(container.querySelector('.cycle-lock-screen')).toBeNull();
    expect(container.querySelector('.cycle-challenge-overlay')).toBeNull();
    expect(container.querySelector('audio')).toBeNull();
  });

  it('keeps the recovery dial without a cycle dialog or lock audio when base HR is satisfied, and restores on fresh signal', () => {
    mockGovernanceState = {
      ...CYCLE_STATE, videoLocked: false,
      challenge: { ...CYCLE_CHALLENGE, sensorUnavailable: true, sensorGraceRemainingMs: 9000 }
    };
    const view = renderOverlay({});
    expect(screen.getByRole('status', { name: 'Cadence sensor unavailable' })).toBeVisible();
    expect(view.container.querySelector('.cycle-challenge-overlay')).not.toBeNull();
    expect(view.container.querySelector('.cycle-lock-screen')).toBeNull();
    expect(view.container.querySelector('.governance-overlay')).toBeNull();
    expect(view.container.querySelector('audio')).toBeNull();
    mockGovernanceState = { ...CYCLE_STATE, challenge: { ...CYCLE_CHALLENGE, sensorUnavailable: false } };
    view.rerender(<MemoryRouter><FitnessPlayerOverlay playerRef={{ current: null }} /></MemoryRouter>);
    expect(screen.getByRole('dialog', { name: 'Cycle challenge locked' })).toBeVisible();
    expect(view.container.querySelector('audio[aria-label="Governance cue locked"]')).not.toBeNull();
  });

  it('shows the base HR panel and its configured unlock while cadence recovers in the background', () => {
    mockGovernanceState = {
      ...LOCKED_STATE,
      requirements: [{ satisfied: false, zone: 'warm', zoneLabel: 'Warm', missingUsers: ['rider'], metUsers: [], requiredCount: 1 }],
      challenge: { ...CYCLE_CHALLENGE, sensorUnavailable: true, sensorGraceRemainingMs: 9000 },
    };
    const onGovernanceUnlock = vi.fn();
    const { container } = renderOverlay({ onGovernanceUnlock });
    expect(screen.queryByRole('status', { name: 'Cadence sensor unavailable' })).not.toBeInTheDocument();
    expect(container.querySelector('.cycle-lock-screen')).toBeNull();
    expect(container.querySelector('.governance-overlay')).not.toBeNull();
    expect(screen.getByText('0 of 1 in Warm')).toBeVisible();
    fireEvent.pointerDown(screen.getByRole('button', { name: /skip or unlock/i }));
    expect(onGovernanceUnlock).toHaveBeenCalledTimes(1);
  });
});

describe('FitnessPlayerOverlay foreground floor priority', () => {
  afterEach(() => { cleanup(); mockGovernanceState = null; });
  it.each(['warning', 'locked'])('backgrounds a cadence lock whenever the floor is %s', (status) => {
    mockGovernanceState = {
      ...LOCKED_STATE, status,
      deadline: Date.now() + 30000, gracePeriodTotal: 30,
      requirements: [{ satisfied: false, zone: 'active', zoneLabel: 'Active', missingUsers: ['rider'], metUsers: [], requiredCount: 1 }],
      challenge: { ...CYCLE_CHALLENGE, paused: true, pauseReason: 'floor_unmet' },
    };
    const { container } = renderOverlay({});
    expect(container.querySelector(status === 'warning' ? '.governance-progress-overlay' : '.governance-overlay')).not.toBeNull();
    expect(container.querySelector('.cycle-lock-screen')).toBeNull();
    expect(container.querySelector('.cycle-challenge-overlay')).toBeNull();
  });
});
