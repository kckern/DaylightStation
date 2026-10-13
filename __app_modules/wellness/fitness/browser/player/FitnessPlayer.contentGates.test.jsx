import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

const fixture = vi.hoisted(() => ({ context: null, identity: null, duck: 1, cueAudio: null, videoVolume: null }));
vi.mock('../context/FitnessContext.jsx', () => ({ useFitness: () => fixture.context, useFitnessContext: () => fixture.context }));
vi.mock('../identity/useIdentity.js', () => ({ useIdentity: () => fixture.identity }));
vi.mock('@/lib/kioskEnv.js', () => ({ isKioskEnv: () => true }));
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({})),
  DaylightMediaPath: (path) => path,
  DaylightImagePath: (path) => path,
}));
vi.mock('@/lib/logging/Logger.js', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  return { default: () => logger, getLogger: () => logger };
});
// Playback is the external boundary: expose the actual player's autoplay decision
// without loading streaming media, and use its advance callback for item changes.
vi.mock('../../../../media/media/browser/playback.mjs', () => ({
  Player: React.forwardRef(({ play, advance, onProgress }, ref) => (
    <div data-testid="playback" data-autoplay={String(play.autoplay)} data-content-id={play.contentId}>
      <button onClick={advance}>Advance playback</button>
      <button onClick={() => onProgress({ currentTime: 1, duration: 600, paused: false })}>Playback progress</button>
    </div>
  )),
}));
vi.mock('../../../../../__capabilities/playback/browser/controller.mjs', () => ({
  usePlayerController: () => ({ seek: vi.fn(), getCurrentTime: () => 0, getDuration: () => 600, pause: vi.fn(), play: vi.fn() }),
}));
vi.mock('../../../../../__capabilities/screen-host/browser/data.mjs', () => ({ useScreenDataRefetch: () => null }));
// These panels own unrelated chart/demo dependencies, including recharts. The real
// FitnessPlayer, pause arbiter, progress enforcer, frame, and UnlockPrompt stay live.
vi.mock('./FitnessSidebar.jsx', () => ({ default: () => null }));
vi.mock('./FitnessPlayerFooter.jsx', () => ({ default: React.forwardRef(() => null) }));
// Keep the real cycling lock, resolver and unlock control; isolate only the unused demo.
vi.mock('../widgets/CycleChallengeDemo/CycleChallengeDemo.jsx', () => ({ default: () => null }));
// No overlay app is open; avoid initializing the unrelated widget registry.
vi.mock('./FitnessModuleContainer.jsx', () => ({ default: () => null }));
vi.mock('./overlays/GovernanceAudioPlayer.jsx', () => ({
  default: ({ trackKey }) => <audio aria-label={`Governance cue ${trackKey}`} />,
}));
vi.mock('../widgets/FitnessChart/index.jsx', () => ({ default: () => null }));
vi.mock('./SessionCameraCapture.jsx', () => ({ default: () => null }));
vi.mock('../hooks/fitness/usePlayerFrameCapture.js', () => ({ default: () => {} }));
vi.mock('../hooks/fitness/useRenderProfiler.js', () => ({ useRenderProfiler: () => {} }));
vi.mock('../hooks/fitness/useContentMode.js', () => ({ default: () => ({ resolved: true, captureDisabled: false, studyUx: false }) }));
vi.mock('../components/useMediaAmplifier.js', () => ({ useMediaAmplifier: () => ({ boostLevel: 1, setBoost: vi.fn() }) }));
vi.mock('../nav/useFitnessVolumeControls.js', () => ({ useFitnessVolumeControls: () => ({ videoVolume: fixture.videoVolume }) }));
// Cue element is the browser-media boundary; the real duck hook owns volume changes.
vi.mock('./hooks/audioCuePlayer.js', () => ({
  installCueAudioUnlock: () => () => {},
  getCueAudioElement: () => fixture.cueAudio,
  isCueAudioUnlocked: () => true,
}));

import FitnessPlayer from './FitnessPlayer.jsx';
import { createCycleAudioEngine } from '../../../../../tests/_fixtures/fitness/cycleAudioEngine.mjs';
import { useRecapUnlock } from '../widgets/FitnessSessionDetailWidget/useRecapUnlock.js';

const RULES = { lock: 'kids_playback', labels: ['KidsFun'], libraries: ['TV Shows'], session_recaps: true };
const KIDS_ITEM = {
  id: 'episode-1', plex: '673797', contentId: 'plex:673797', title: 'Kids episode',
  labels: ['KidsFun'], grandparentId: 'kids-show', duration: 600,
  mediaUrl: '/test/episode-1.mp4',
};
const NEXT_ITEM = { ...KIDS_ITEM, id: 'episode-2', plex: '673798', contentId: 'plex:673798', mediaUrl: '/test/episode-2.mp4' };
const PENDING = { isGoverned: true, status: 'pending', videoLocked: true, challenge: null, deadline: null, requirements: [] };
const UNLOCKED = { ...PENDING, status: 'unlocked', videoLocked: false };

function expectNoLiveScan() {
  expect(fixture.identity.registerUnlock).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Fingerprint unlock' })).not.toBeInTheDocument();
  expect(screen.queryByText('Access Granted')).not.toBeInTheDocument();
}

function playerNode(items = [KIDS_ITEM]) {
  return <MemoryRouter><FitnessPlayer playQueue={items} setPlayQueue={vi.fn()} /></MemoryRouter>;
}
function renderPlayer(items = [KIDS_ITEM]) {
  return render(playerNode(items));
}

beforeEach(() => {
  fixture.duck = 1;
  fixture.cueAudio = new EventTarget();
  fixture.cueAudio.play = vi.fn(async () => {});
  fixture.cueAudio.pause = vi.fn();
  fixture.videoVolume = { volume: 1, volumeRef: { current: 1 }, setDuck: (value) => { fixture.duck = value; } };
  fixture.identity = { registerUnlock: vi.fn(() => new Promise(() => {})), clearUnlock: vi.fn(), unlockState: 'scanning', phase: 'normal' };
  fixture.context = {
    fitnessConfiguration: { playback_unlock: RULES, locks: { kids_playback: ['parent'], governance_bypass: ['parent'] } },
    governanceState: PENDING, participantRoster: [], voiceMemos: [],
    voiceMemoOverlayState: { open: false }, participantDisplayMap: new Map(), zoneMetadata: {},
    activeHeartRateParticipants: [], zones: [], overlayApp: null, closeApp: vi.fn(),
    getDisplayName: (uid) => ({ displayName: uid }), pauseMusicPlayer: vi.fn(),
    setVideoPlayerPaused: vi.fn(), setGovernanceMedia: vi.fn(), setCurrentMedia: vi.fn(),
    trackRecentlyPlayed: vi.fn(), emitAppEvent: vi.fn(), setCaptureDisabled: vi.fn(), registerVideoPlayer: vi.fn(),
  };
});
afterEach(cleanup);

describe('FitnessPlayer live content gates', () => {
  it('holds KidsFun content only for pending exercise governance without requesting a fingerprint', async () => {
    renderPlayer();
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'false'));
    fireEvent.click(screen.getByRole('button', { name: 'Playback progress' }));
    expect(fixture.context.setVideoPlayerPaused).toHaveBeenCalledWith(true);
    expectNoLiveScan();
  });

  it('releases KidsFun playback when exercise governance unlocks without a content scan', async () => {
    const view = renderPlayer();
    fixture.context = { ...fixture.context, governanceState: UNLOCKED };
    view.rerender(playerNode());
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'true'), { timeout: 1000 });
    expectNoLiveScan();
  });

  it('uses the new item governance verdict when advancing the queue without requesting a content scan', async () => {
    fixture.context.governanceState = UNLOCKED;
    const view = renderPlayer([KIDS_ITEM, NEXT_ITEM]);
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-content-id', 'plex:673797'));
    expectNoLiveScan();
    fixture.context = { ...fixture.context, governanceState: PENDING };
    view.rerender(playerNode([KIDS_ITEM, NEXT_ITEM]));
    fireEvent.click(screen.getByRole('button', { name: 'Advance playback' }));
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-content-id', 'plex:673798'));
    expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'false');
    expectNoLiveScan();
  });

  it('restores a resumed KidsFun item under unlocked exercise governance without a content scan', async () => {
    fixture.context.governanceState = UNLOCKED;
    fixture.identity.unlockState = 'granted'; // previous unrelated identity confirmation
    renderPlayer([{ ...KIDS_ITEM, seconds: 120, watchSeconds: 120 }]);
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'true'), { timeout: 1000 });
    expectNoLiveScan();
  });
});

describe('Home replay content gate for the same KidsFun metadata', () => {
  it('requests kids_playback only when replay is requested and stays locked on denial', async () => {
    let resolveScan;
    const registerUnlock = vi.fn(() => new Promise((resolve) => { resolveScan = resolve; }));
    const media = [KIDS_ITEM];
    const clearUnlock = vi.fn();
    const fetchInfo = vi.fn(async () => ({}));
    const { result } = renderHook(() => useRecapUnlock({
      sessionId: 'recorded-session', media, rules: RULES, active: true,
      registerUnlock, clearUnlock, fetchInfo,
    }));
    await act(async () => {}); // finish the real asynchronous content classification
    expect(result.current.locked).toBe(true);
    expect(result.current.promptOpen).toBe(false);
    expect(registerUnlock).not.toHaveBeenCalled();
    act(() => result.current.request());
    expect(registerUnlock).toHaveBeenCalledExactlyOnceWith('kids_playback');
    expect(result.current.promptOpen).toBe(true);
    await act(async () => resolveScan({ matched: false, reason: 'unauthorized' }));
    expect(result.current.locked).toBe(true);
  });
});

const CYCLE_LOCKED = {
  ...UNLOCKED, videoLocked: true,
  challenge: {
    id: 'cycle-1', type: 'cycle', status: 'pending', cycleState: 'locked', lockReason: 'health',
    rider: { id: 'rider', name: 'Rider' }, currentPhase: { hiRpm: 70, loRpm: 50 },
    currentRpm: 0, currentPhaseIndex: 0, totalPhases: 2, phaseProgressPct: 0.4,
    cycleHealthPct: 0, baseReqSatisfiedForRider: true,
  },
  audioDuck: { cueId: 'cycle_lock', token: 'cycle-1:locked', trigger: 'cycle_fail', sound: 'cycle-lock.mp3', duckTo: 0.1 },
};

function startCycleScan(items = [KIDS_ITEM]) {
  let resolveScan;
  fixture.identity.registerUnlock = vi.fn(() => new Promise((resolve) => { resolveScan = resolve; }));
  fixture.context.governanceState = CYCLE_LOCKED;
  const view = renderPlayer(items);
  expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'false');
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Skip / Unlock' }));
  expect(fixture.identity.registerUnlock).toHaveBeenCalledExactlyOnceWith('governance_bypass');
  expect(screen.getByRole('dialog', { name: 'Fingerprint unlock' })).toBeVisible();
  return { view, resolveScan };
}

describe('FitnessPlayer cycling biometric bypass', () => {
  it('releases playback, the cycle stage, lock audio and active volume duck only after an authorized scan', async () => {
    const { view, resolveScan } = startCycleScan();
    expect(fixture.duck).toBe(0.1);
    // Real producer descriptors are transient; no new event must not lift the
    // active cue before the authorized bypass itself is granted.
    fixture.context = { ...fixture.context, governanceState: { ...CYCLE_LOCKED, audioDuck: null } };
    view.rerender(playerNode());
    expect(fixture.duck).toBe(0.1);
    // A second gesture during the same prompt never requests another scan.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Skip / Unlock' }));
    expect(fixture.identity.registerUnlock).toHaveBeenCalledTimes(1);
    await act(async () => resolveScan({ matched: true, userId: 'parent' }));
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'true'), { timeout: 1000 });
    expect(view.container.querySelector('.cycle-challenge-overlay')).toBeNull();
    expect(view.container.querySelector('.cycle-lock-screen')).toBeNull();
    expect(view.container.querySelector('audio[aria-label="Governance cue locked"]')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Fingerprint unlock' })).not.toBeInTheDocument();
    expect(fixture.duck).toBe(1);
  });

  it.each(['unrecognized', 'unauthorized'])('keeps the cycle lock after a %s scan and retains the denied prompt', async (reason) => {
    const { resolveScan } = startCycleScan();
    fixture.identity.unlockState = reason === 'unauthorized' ? 'unauthorized' : 'denied';
    await act(async () => resolveScan({ matched: false, reason }));
    expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'false');
    expect(screen.getByRole('dialog', { name: 'Cycle challenge locked' })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Fingerprint unlock' })).toBeVisible();
    expect(fixture.duck).toBe(0.1);
  });

  it('cancel closes the prompt while retaining cycle governance', async () => {
    const { resolveScan } = startCycleScan();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => resolveScan({ matched: false, reason: 'cancelled' }));
    expect(fixture.identity.clearUnlock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Fingerprint unlock' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Cycle challenge locked' })).toBeVisible();
    expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'false');
    expect(fixture.duck).toBe(0.1);
  });

  it('resets an authorized current-video bypass when the next item starts', async () => {
    const { resolveScan } = startCycleScan([KIDS_ITEM, NEXT_ITEM]);
    await act(async () => resolveScan({ matched: true, userId: 'parent' }));
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'true'), { timeout: 1000 });
    fireEvent.click(screen.getByRole('button', { name: 'Advance playback' }));
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-content-id', 'plex:673798'));
    expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'false');
    expect(screen.getByRole('dialog', { name: 'Cycle challenge locked' })).toBeVisible();
    expect(fixture.identity.registerUnlock).toHaveBeenCalledTimes(1);
  });

  it('does not grant a new item from a stale successful scan started for the prior item', async () => {
    const { resolveScan } = startCycleScan([KIDS_ITEM, NEXT_ITEM]);
    fireEvent.click(screen.getByRole('button', { name: 'Advance playback' }));
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-content-id', 'plex:673798'));
    await act(async () => resolveScan({ matched: true, userId: 'parent' }));
    expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'false');
    expect(screen.getByRole('dialog', { name: 'Cycle challenge locked' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Fingerprint unlock' })).not.toBeInTheDocument();
    expect(fixture.identity.clearUnlock).toHaveBeenCalledTimes(1);
  });
});


describe('FitnessPlayer real-engine recovery audio', () => {
  it('keeps an ordinary cycle event through null ticks, then cancels it once for sensor recovery', () => {
    const f = createCycleAudioEngine();
    fixture.context.governanceState = f.start();
    const view = renderPlayer();
    expect(fixture.duck).toBe(0.2);
    const next = f.tick(200);
    expect(next.audioDuck).toBeNull();
    fixture.context = { ...fixture.context, governanceState: next };
    view.rerender(playerNode());
    expect(fixture.duck).toBe(0.2);
    const active = f.engine.challengeState.activeChallenge;
    active.cycleState = 'maintain'; active._publishedCycleState = 'maintain'; active.cycleHealthMs = 1500;
    fixture.context = { ...fixture.context, governanceState: f.tick(2700, null) };
    view.rerender(playerNode());
    expect(fixture.duck).toBe(1);
    expect(fixture.cueAudio.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status', { name: 'Cadence sensor unavailable' })).toBeVisible();
    expect(view.container.querySelector('.cycle-lock-screen')).toBeNull();
    fixture.context = { ...fixture.context, governanceState: f.tick(200, null) };
    view.rerender(playerNode());
    expect(fixture.cueAudio.pause).toHaveBeenCalledTimes(1);
  });

  it('plays base HR warning during sensor recovery and retains its hard-lock audio authority', () => {
    const f = createCycleAudioEngine();
    fixture.context.governanceState = f.start();
    const view = renderPlayer();
    const active = f.engine.challengeState.activeChallenge;
    active.cycleState = 'maintain'; active._publishedCycleState = 'maintain'; active.cycleHealthMs = 1500;
    const warning = f.tick(2700, null, 'cool');
    expect(warning.status).toBe('warning');
    expect(warning.challenge.sensorUnavailable).toBe(true);
    fixture.context = { ...fixture.context, governanceState: warning };
    view.rerender(playerNode());
    expect(fixture.cueAudio.src).toBe('/media/warning.mp3');
    expect(fixture.duck).toBe(0.15);
    const locked = f.tick(2000, null, 'cool');
    expect(locked.status).toBe('locked');
    fixture.context = { ...fixture.context, governanceState: locked };
    view.rerender(playerNode());
    expect(fixture.duck).toBe(1);
    expect(view.container.querySelector('.governance-overlay')).not.toBeNull();
    expect(screen.getByRole('status', { name: 'Cadence sensor unavailable' })).toBeVisible();
  });
});
