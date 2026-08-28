// PianoVideoPlayer.resume.test.jsx
//
// Regression coverage for the completed-lecture "jumpscare" bug: opening an
// already-watched lecture used to mount the Player with NO resume directive,
// so the Player fell back to Plex's own (tail) viewOffset — video opened near
// the end, `ended` fired seconds later, and the player auto-exited. The fix
// makes PianoVideoPlayer pass OUR computed resumeSecondsFor(lecture) value
// explicitly (and suppress Plex's own resume), so a completed lecture always
// re-opens at 0 and an in-progress one resumes at the saved playhead — with
// no chance for the two sources to disagree.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';

// --- Piano context modules: stand in with fixed, minimal values (mirrors the
// mocking style in EngagementGate.test.jsx / PianoVideoChrome.test.jsx) ------
const midiState = { activeNotes: new Map(), pressNote: vi.fn(), releaseNote: vi.fn() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => midiState,
  usePianoMidiNotes: () => midiState,
}));
vi.mock('../../usePianoPlayback.js', () => ({
  usePianoPlayback: () => ({ setPlaying: vi.fn(), setVideoActive: vi.fn(), playing: false, videoActive: false }),
}));
vi.mock('../../usePianoMix.js', () => ({
  usePianoMix: () => ({ mediaLevel: 1, setMediaLevel: vi.fn() }),
}));
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({
  usePianoBreadcrumb: () => {},
}));
vi.mock('../../PianoUserContext.jsx', () => ({
  usePianoUser: () => ({ currentUser: 'user_1' }),
}));

const apiMock = vi.fn().mockResolvedValue({});
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// Stand in for the shared Player: exposes only what PianoVideoPlayer's wiring
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
  apiMock.mockClear();
  playPropSpy.mockClear();
  fakeMedia = document.createElement('video');
});

async function findPlayer() {
  return screen.findByTestId('player-stub');
}

describe('PianoVideoPlayer — resume directive', () => {
  it('a completed lecture opens the Player at 0, never the implicit Plex tail resume', async () => {
    const lecture = { plex: '243203', label: 'Lecture 3', userWatched: true, userPlayhead: 1700 };
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await findPlayer();

    expect(playPropSpy).toHaveBeenCalled();
    const play = playPropSpy.mock.calls.at(-1)[0];
    expect(play).toMatchObject({ contentId: 'plex:243203', seconds: 0, resume: false });
  });

  it('an in-progress lecture resumes the Player at OUR computed playhead, not an implicit Plex resume', async () => {
    const lecture = { plex: '243204', label: 'Lecture 4', userWatched: false, userPlayhead: 42 };
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await findPlayer();

    expect(playPropSpy).toHaveBeenCalled();
    const play = playPropSpy.mock.calls.at(-1)[0];
    expect(play).toMatchObject({ contentId: 'plex:243204', seconds: 42, resume: false });
  });

  // Cross-user leak regression: the item is user-scoped (this kiosk user's
  // request went through UserVideoProgressStore#enrich — userWatched is
  // present) but THIS user has never watched it, so there's no userPlayhead.
  // Device-level watchSeconds sits at the tail — e.g. another user on the
  // shared kiosk nearly finished the same lecture minutes ago. The active
  // user must start at 0, never inherit that position.
  it('a user with no per-user record opens at 0, ignoring a device-level tail position from another user', async () => {
    const lecture = {
      plex: '243205', label: 'Lecture 5', userWatched: false, userPercent: null,
      watchSeconds: 1790, watchProgress: 99, duration: 1800,
    };
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await findPlayer();

    expect(playPropSpy).toHaveBeenCalled();
    const play = playPropSpy.mock.calls.at(-1)[0];
    expect(play).toMatchObject({ contentId: 'plex:243205', seconds: 0, resume: false });
  });
});
