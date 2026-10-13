import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

const fixture = vi.hoisted(() => ({ context: null, identity: null }));
vi.mock('../context/FitnessContext.jsx', () => ({ useFitness: () => fixture.context }));
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
vi.mock('./FitnessPlayerOverlay.jsx', () => ({ default: () => null }));
vi.mock('../widgets/FitnessChart/index.jsx', () => ({ default: () => null }));
vi.mock('./SessionCameraCapture.jsx', () => ({ default: () => null }));
vi.mock('../hooks/fitness/usePlayerFrameCapture.js', () => ({ default: () => {} }));
vi.mock('../hooks/fitness/useRenderProfiler.js', () => ({ useRenderProfiler: () => {} }));
vi.mock('../hooks/fitness/useContentMode.js', () => ({ default: () => ({ resolved: true, captureDisabled: false, studyUx: false }) }));
vi.mock('../components/useMediaAmplifier.js', () => ({ useMediaAmplifier: () => ({ boostLevel: 1, setBoost: vi.fn() }) }));
vi.mock('../nav/useFitnessVolumeControls.js', () => ({ useFitnessVolumeControls: () => ({ videoVolume: { volume: 1, volumeRef: { current: 1 } } }) }));
vi.mock('./hooks/useGovernanceAudioDuck.js', () => ({ useGovernanceAudioDuck: () => {} }));
vi.mock('./hooks/audioCuePlayer.js', () => ({ installCueAudioUnlock: () => () => {} }));

import FitnessPlayer from './FitnessPlayer.jsx';
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

function renderPlayer(items = [KIDS_ITEM]) {
  return render(<FitnessPlayer playQueue={items} setPlayQueue={vi.fn()} />);
}

beforeEach(() => {
  fixture.identity = { registerUnlock: vi.fn(() => new Promise(() => {})), clearUnlock: vi.fn(), unlockState: 'scanning', phase: 'normal' };
  fixture.context = {
    fitnessConfiguration: { playback_unlock: RULES, locks: { kids_playback: ['parent'], governance_bypass: ['parent'] } },
    governanceState: PENDING, participantRoster: [], voiceMemos: [],
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
    view.rerender(<FitnessPlayer playQueue={[KIDS_ITEM]} setPlayQueue={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-autoplay', 'true'), { timeout: 1000 });
    expectNoLiveScan();
  });

  it('uses the new item governance verdict when advancing the queue without requesting a content scan', async () => {
    fixture.context.governanceState = UNLOCKED;
    const view = renderPlayer([KIDS_ITEM, NEXT_ITEM]);
    await waitFor(() => expect(screen.getByTestId('playback')).toHaveAttribute('data-content-id', 'plex:673797'));
    expectNoLiveScan();
    fixture.context = { ...fixture.context, governanceState: PENDING };
    view.rerender(<FitnessPlayer playQueue={[KIDS_ITEM, NEXT_ITEM]} setPlayQueue={vi.fn()} />);
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
