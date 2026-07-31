// SingalongPlayer.keycontrol.test.jsx — the key-change stepper is part of the
// karaoke transport chrome: it must render, receive the Player's resolved
// media element (that's the audio it transposes), and reset to the natural
// key when the song changes (remount via key={contentId}).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SingalongPlayer from './SingalongPlayer.jsx';

// --- Piano context modules: minimal stand-ins (mirrors SingalongPlayer.resume.test.jsx) ---
vi.mock('../../PianoPlaybackContext.jsx', () => ({
  usePianoPlayback: () => ({ setPlaying: vi.fn(), setVideoActive: vi.fn(), playing: false, videoActive: false }),
}));
vi.mock('../../PianoMixContext.jsx', () => ({
  usePianoMix: () => ({ mediaLevel: 1, setMediaLevel: vi.fn() }),
}));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({
  usePianoBreadcrumb: () => {},
}));
vi.mock('../../PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser: 'user_1' }),
}));

// The audio graph is useKeyShift's own tested concern — spy it out here.
const useKeyShiftSpy = vi.hoisted(() => vi.fn());
vi.mock('./useKeyShift.js', () => ({ default: useKeyShiftSpy }));

let fakeMedia = null;
vi.mock('../../../../Player/Player.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef((props, ref) => {
      useImperativeHandle(ref, () => ({
        getMediaElement: () => fakeMedia,
        getCurrentTime: () => fakeMedia?.currentTime || 0,
        getDuration: () => fakeMedia?.duration || 0,
        play: vi.fn(),
        pause: vi.fn(),
        toggle: vi.fn(),
        seek: vi.fn(),
      }), []);
      return <div data-testid="player-stub" />;
    }),
  };
});

beforeEach(() => {
  useKeyShiftSpy.mockClear();
  fakeMedia = document.createElement('video');
});

const keyValue = () => screen.getByRole('button', { name: 'Reset key' });

describe('SingalongPlayer — key control wiring', () => {
  it('renders the key control on the chrome and hands it the resolved media element', async () => {
    const lecture = { plex: '662039', label: 'Song 1' };
    render(<SingalongPlayer lecture={lecture} onBack={vi.fn()} />);
    await screen.findByTestId('player-stub');
    expect(screen.getByTestId('key-control')).toBeInTheDocument();
    // useResolvedMediaEl polls the player ref; once resolved, the hook must see
    // the actual element it is expected to transpose.
    await waitFor(() => expect(useKeyShiftSpy).toHaveBeenLastCalledWith(fakeMedia, 0));
  });

  it('resets to the natural key when the song changes', async () => {
    const { rerender } = render(
      <SingalongPlayer lecture={{ plex: '662039', label: 'Song 1' }} onBack={vi.fn()} />,
    );
    await screen.findByTestId('player-stub');
    fireEvent.click(screen.getByRole('button', { name: 'Raise key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Raise key' }));
    expect(keyValue().textContent).toBe('+2');

    rerender(<SingalongPlayer lecture={{ plex: '990001', label: 'Song 2' }} onBack={vi.fn()} />);
    expect(keyValue().textContent).toBe('Key');
  });
});
