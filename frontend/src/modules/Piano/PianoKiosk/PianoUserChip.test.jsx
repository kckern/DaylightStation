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
  users: [{ id: 'milo', name: 'Milo' }, { id: 'dad', name: 'Dad' }],
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
    expect(screen.getByText("Who’s playing?")).toBeTruthy();
    fireEvent.click(screen.getByText('Milo'));
    expect(setCurrentUser).toHaveBeenCalledWith('milo');
  });

  it('locks switching while a video lecture is open', () => {
    playback.videoActive = true;
    renderChip();
    const chip = screen.getByLabelText('Player locked during lesson');
    expect(chip.disabled).toBe(true);
    expect(screen.getByTestId('lock-icon')).toBeTruthy();
    // Clicking the locked chip must NOT open the picker.
    fireEvent.click(chip);
    expect(screen.queryByText("Who’s playing?")).toBeNull();
    expect(setCurrentUser).not.toHaveBeenCalled();
  });
});
