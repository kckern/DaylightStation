// PianoVideoPlayer.policy.test.jsx — per-user policy hooks on the lecture player:
// engagementGateEnabled=false must keep the anti-AFK gate closed forever, and
// onAutoAdvance must fire exactly once from the media `ended` event.
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
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

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

const lecture = { plex: '243203', label: 'Lecture 3', userWatched: false, userPlayhead: 0 };

beforeEach(() => {
  fakeMedia = document.createElement('video');
});
afterEach(() => { vi.useRealTimers(); });

const gateQuery = () => screen.queryByText(/Still there\?/i);

describe('PianoVideoPlayer — per-user policy', () => {
  it('engagementGateEnabled=false keeps the gate closed on a sequential lecture', async () => {
    vi.useFakeTimers();
    render(
      <PianoVideoPlayer
        lecture={lecture}
        source="Course"
        onBack={vi.fn()}
        isSequential
        engagementTimeoutSeconds={90}
        engagementGateEnabled={false}
      />,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(gateQuery()).toBe(null);
  });

  it('the gate still opens by default (control)', async () => {
    vi.useFakeTimers();
    render(
      <PianoVideoPlayer
        lecture={lecture}
        source="Course"
        onBack={vi.fn()}
        isSequential
        engagementTimeoutSeconds={90}
      />,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(gateQuery()).not.toBe(null);
  });

  it('onAutoAdvance fires exactly once from the media ended event', async () => {
    const onAutoAdvance = vi.fn();
    render(
      <PianoVideoPlayer
        lecture={lecture}
        source="Course"
        onBack={vi.fn()}
        onAutoAdvance={onAutoAdvance}
      />,
    );
    await screen.findByTestId('player-stub');
    await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
    await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
    expect(onAutoAdvance).toHaveBeenCalledTimes(1);
  });

  it('ended without onAutoAdvance is a no-op (no crash)', async () => {
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} />);
    await screen.findByTestId('player-stub');
    await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
    expect(screen.getByTestId('player-stub')).toBeTruthy();
  });
});
