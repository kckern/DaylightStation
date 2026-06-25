import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// --- Isolation mocks -------------------------------------------------------
// Audio host plays cue files on mount; stub it (mirrors GovernanceStateOverlay.unlock.test.jsx).
vi.mock('./overlays/GovernanceAudioPlayer.jsx', () => ({ __esModule: true, default: () => null }));
// Render profiler is a dev-only no-op hook; stub so it never touches perf APIs.
vi.mock('@/hooks/fitness/useRenderProfiler.js', () => ({ __esModule: true, useRenderProfiler: () => {} }));
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
vi.mock('@/context/FitnessContext.jsx', () => ({
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

import FitnessPlayerOverlay from './FitnessPlayerOverlay.jsx';

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
