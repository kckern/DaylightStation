// PianoVideoPlayer.remount.test.jsx
//
// Regression coverage for the 2026-08-16 remount storm. `handlePlayerClear`
// depended on the polled media element, so every element swap rebuilt the
// memoized player element and handed the shared Player a brand-new `play`
// object. The Player keys its media identity on that object, so each new
// object remounted the video and opened another Plex transcode session —
// which produced another element swap. 495 Plex sessions in 4 minutes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';

const midiState = { activeNotes: new Map(), pressNote: vi.fn(), releaseNote: vi.fn() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => midiState,
  usePianoMidiNotes: () => midiState,
}));
vi.mock('../../PianoPlaybackContext.jsx', () => ({
  usePianoPlayback: () => ({ setPlaying: vi.fn(), setVideoActive: vi.fn(), playing: false, videoActive: false }),
}));
vi.mock('../../PianoMixContext.jsx', () => ({
  usePianoMix: () => ({ mediaLevel: 1, setMediaLevel: vi.fn() }),
}));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'user_1' }) }));

const apiMock = vi.fn().mockResolvedValue({});
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// Player stub: records the `play` prop object identity on every render and
// hands back whatever element the test currently declares as the media el.
let fakeMedia = null;
const playPropSpy = vi.fn();
vi.mock('../../../../Player/Player.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(({ play }, ref) => {
      playPropSpy(play);
      useImperativeHandle(ref, () => ({
        getMediaElement: () => fakeMedia,
        getCurrentTime: () => 0,
        getDuration: () => 0,
        play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), seek: vi.fn(),
      }), []);
      return <div data-testid="player-stub" />;
    }),
  };
});

beforeEach(() => {
  playPropSpy.mockClear();
  fakeMedia = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PianoVideoPlayer — play prop identity', () => {
  it('hands the Player ONE `play` object across repeated media-element swaps', async () => {
    const lecture = { plex: '694719', label: 'Introduction to Singing', userPlayhead: 0 };
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await screen.findByTestId('player-stub');

    // useResolvedMediaEl polls every 100ms; three swaps = what three remounts
    // would produce in production.
    const swapped = [];
    for (let i = 0; i < 3; i += 1) {
      fakeMedia = document.createElement('video');
      vi.spyOn(fakeMedia, 'addEventListener');
      swapped.push(fakeMedia);
      await act(async () => { vi.advanceTimersByTime(150); });
    }

    // The component binds its media listeners on each resolved element, so this
    // proves the swap actually reached it. Without the check, a stub that stops
    // delivering an element would leave one render and pass for the wrong reason.
    expect(swapped.at(-1).addEventListener).toHaveBeenCalled();

    const identities = new Set(playPropSpy.mock.calls.map((c) => c[0]));
    expect(identities.size).toBe(1);
  });

  it('a new onBack identity rebuilds the element but must NOT mint a new play object', async () => {
    const lecture = { plex: '694719', label: 'Introduction to Singing', userPlayhead: 0 };
    const { rerender } = render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await screen.findByTestId('player-stub');

    // Parent recreated its callback — routine, and the case Videos.jsx warns about.
    rerender(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await act(async () => { vi.advanceTimersByTime(150); });

    expect(playPropSpy.mock.calls.length).toBeGreaterThan(1);        // the element DID rebuild
    expect(new Set(playPropSpy.mock.calls.map((c) => c[0])).size).toBe(1); // ...with the same play object
  });

  it('still carries the right content and resume directive', async () => {
    const lecture = { plex: '694719', label: 'Introduction to Singing', userPlayhead: 42 };
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await screen.findByTestId('player-stub');

    const play = playPropSpy.mock.calls.at(-1)[0];
    expect(play).toMatchObject({ contentId: 'plex:694719', seconds: 42, resume: false });
  });
});
