import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable playback state so each test can toggle videoActive.
const playback = vi.hoisted(() => ({ playing: false, videoActive: false }));

vi.mock('./PianoPlaybackContext.jsx', () => ({ usePianoPlayback: () => playback }));
vi.mock('./PianoAvatar.jsx', () => ({ default: () => null }));
vi.mock('@/modules/Fitness/player/overlays/LockIcon.jsx', () => ({ default: () => <span data-testid="lock-icon" /> }));

import PianoUserChip from './PianoUserChip.jsx';
import PianoUserContext from './PianoUserContext.jsx';

const setCurrentUser = vi.fn();
const ctxValue = {
  users: [{ id: 'user_3', name: 'User_3' }, { id: 'dad', name: 'Dad' }],
  currentProfile: { id: 'dad', name: 'Dad' },
  currentUser: 'dad',
  setCurrentUser,
};

const renderChip = () =>
  render(
    <PianoUserContext.Provider value={ctxValue}>
      <PianoUserChip />
    </PianoUserContext.Provider>,
  );

describe('PianoUserChip', () => {
  beforeEach(() => {
    playback.videoActive = false;
    setCurrentUser.mockClear();
  });

  it('opens the roster picker and switches user when no video is active', () => {
    renderChip();
    fireEvent.click(screen.getByLabelText('Switch player'));
    expect(screen.getByText("Who's playing?")).toBeTruthy();
    fireEvent.click(screen.getByText('User_3'));
    expect(setCurrentUser).toHaveBeenCalledWith('user_3');
  });

  // The chip renders the SAME WhoIsPlayingPrompt as the idle-gap re-prompt, but
  // as a manual switch: it marks the current player and never auto-dismisses.
  it('marks the current player and does not time out', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderChip();
      fireEvent.click(screen.getByLabelText('Switch player'));
      const pressed = [...container.querySelectorAll('.piano-usercard')]
        .map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
      expect(pressed).toEqual([['User_3', 'false'], ['Dad', 'true']]);
      vi.advanceTimersByTime(120000);
      expect(screen.getByText("Who's playing?")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks switching while a video lecture is open', () => {
    playback.videoActive = true;
    renderChip();
    const chip = screen.getByLabelText('Player locked during lesson');
    expect(chip.disabled).toBe(true);
    expect(screen.getByTestId('lock-icon')).toBeTruthy();
    // Clicking the locked chip must NOT open the picker.
    fireEvent.click(chip);
    expect(screen.queryByText("Who's playing?")).toBeNull();
    expect(setCurrentUser).not.toHaveBeenCalled();
  });
});
