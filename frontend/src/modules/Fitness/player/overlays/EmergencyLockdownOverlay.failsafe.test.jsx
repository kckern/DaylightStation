import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';

// DaylightAPI is the only server seam. Under the ?emergency=triggering URL seam
// the hook skips its mount GET, so DaylightAPI is called ONLY if the ceremony
// commits — which makes "did it commit?" a clean assertion.
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({ locked: false }),
  DaylightMediaPath: (p) => p,
  DaylightImagePath: (p) => p,
}));
vi.mock('@/services/WebSocketService.js', () => ({
  wsService: { subscribe: vi.fn(() => () => {}) },
}));
vi.mock('@/modules/Fitness/player/hooks/audioCuePlayer.js', () => ({
  getCueAudioElement: () => null,
  primeCueAudio: vi.fn(),
}));
vi.mock('@/context/FitnessContext.jsx', () => ({
  __esModule: true,
  useFitness: () => ({ fitnessConfiguration: {}, userCollections: { all: [] } }),
}));
vi.mock('@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js', () => ({
  __esModule: true, playCueOnce: ({ onDone } = {}) => { onDone?.(); return true; },
}));

import { DaylightAPI } from '@/lib/api.mjs';
import EmergencyLockdownOverlay from './EmergencyLockdownOverlay.jsx';
import { IdentityProvider } from '@/modules/Fitness/identity/IdentityProvider';

const COMMIT_ENDPOINT = 'api/v1/fitness/emergency/commit';
const ORIGINAL_SEARCH = window.location.search;
function setSearch(s) { window.history.replaceState({}, '', `${window.location.pathname}${s}`); }

function renderTriggering() {
  setSearch('?emergency=triggering');
  return render(<IdentityProvider><EmergencyLockdownOverlay audioPath="x.mp3" /></IdentityProvider>);
}

describe('EmergencyLockdownOverlay — fail-safe ceremony', () => {
  beforeEach(() => { vi.useFakeTimers(); DaylightAPI.mockClear(); setSearch(''); });
  afterEach(() => { cleanup(); vi.useRealTimers(); setSearch(ORIGINAL_SEARCH); });

  it('auto-cancels to normal when the idle window elapses without a confirm — never commits', () => {
    const { container } = renderTriggering();
    expect(container.querySelector('.emergency-overlay--triggering')).not.toBeNull();

    // Let the whole idle window elapse with no interaction.
    act(() => { vi.advanceTimersByTime(15000); });

    // Fail-safe: the ceremony is gone AND nothing was committed to the server.
    expect(container.querySelector('.emergency-overlay--triggering')).toBeNull();
    expect(DaylightAPI).not.toHaveBeenCalledWith(COMMIT_ENDPOINT, expect.anything(), 'POST');
  });

  it('commits only after a deliberate press-and-hold on the confirm control', () => {
    const { container } = renderTriggering();
    const confirm = container.querySelector('.emergency-confirm');
    expect(confirm).not.toBeNull();

    act(() => { fireEvent.pointerDown(confirm); });
    // A hold shorter than the confirm threshold must NOT commit.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(DaylightAPI).not.toHaveBeenCalledWith(COMMIT_ENDPOINT, expect.anything(), 'POST');

    // Holding past the threshold commits.
    act(() => { vi.advanceTimersByTime(4000); });
    expect(DaylightAPI).toHaveBeenCalledWith(COMMIT_ENDPOINT, {}, 'POST');
  });

  it('releasing the hold before the threshold cancels the commit', () => {
    const { container } = renderTriggering();
    const confirm = container.querySelector('.emergency-confirm');

    act(() => { fireEvent.pointerDown(confirm); });
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { fireEvent.pointerUp(confirm); });
    // Advance well past where the threshold would have fired had the hold continued.
    act(() => { vi.advanceTimersByTime(5000); });

    expect(DaylightAPI).not.toHaveBeenCalledWith(COMMIT_ENDPOINT, expect.anything(), 'POST');
  });
});
