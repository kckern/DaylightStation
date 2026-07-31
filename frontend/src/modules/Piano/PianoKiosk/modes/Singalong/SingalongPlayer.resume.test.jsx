// SingalongPlayer.resume.test.jsx
//
// Regression coverage for the karaoke/play-along resume bug: these are fresh
// tracks and must ALWAYS start at 0:00 — never resume a stored playhead. The
// bug had two layers: (1) SingalongPlayer's own `startFresh` prop defaulted to
// `false`, a latent trap for any caller that forgets to pass it explicitly;
// (2) the backend's bare `/:source` route (which karaoke's bare compound ids
// like `plex:662039` hit) never forwarded `?resume=false` into
// PlayResponseService, so even a caller that DID pass `resume:false` still
// got a stream URL rewritten with a Plex `offset=` from the stored playhead.
// This file pins layer (1): an un-prop'd SingalongPlayer must build
// `play={{ ..., seconds: 0, resume: false }}` by default, not by caller favor.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SingalongPlayer from './SingalongPlayer.jsx';

// --- Piano context modules: minimal stand-ins (mirrors PianoVideoPlayer.resume.test.jsx) ---
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

// Stand in for the shared Player: exposes only what SingalongPlayer's wiring
// needs (getMediaElement backed by a real <video>), and surfaces the `play`
// prop it was mounted with so the test can assert the resume directive.
let fakeMedia = null;
const playPropSpy = vi.fn();
vi.mock('../../../../Player/Player.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(({ play }, ref) => {
      playPropSpy(play);
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
  playPropSpy.mockClear();
  fakeMedia = document.createElement('video');
});

async function findPlayer() {
  return screen.findByTestId('player-stub');
}

describe('SingalongPlayer — resume directive', () => {
  it('defaults to startFresh (no prop passed): builds play with seconds:0, resume:false', async () => {
    // A caller that forgets to pass startFresh — the exact shape of the latent
    // trap this fix removes. Even with a stored userPlayhead on the lecture,
    // the default must still start fresh.
    const lecture = { plex: '662039', label: 'Song 1', userPlayhead: 90 };
    render(<SingalongPlayer lecture={lecture} source="Karaoke" onBack={vi.fn()} />);
    await findPlayer();

    expect(playPropSpy).toHaveBeenCalled();
    const play = playPropSpy.mock.calls.at(-1)[0];
    expect(play).toMatchObject({ contentId: 'plex:662039', shader: 'focused', seconds: 0, resume: false });
  });

  it('an explicit startFresh={false} caller (e.g. a real lecture) is unaffected', async () => {
    const lecture = { plex: '662040', label: 'Lecture', userPlayhead: 42 };
    render(<SingalongPlayer lecture={lecture} source="Course" onBack={vi.fn()} startFresh={false} />);
    await findPlayer();

    expect(playPropSpy).toHaveBeenCalled();
    const play = playPropSpy.mock.calls.at(-1)[0];
    expect(play).toMatchObject({ contentId: 'plex:662040', shader: 'focused' });
    expect(play.resume).toBeUndefined();
    expect(play.seconds).toBeUndefined();
  });
});
