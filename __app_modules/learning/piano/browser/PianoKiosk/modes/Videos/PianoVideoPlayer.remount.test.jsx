// PianoVideoPlayer.remount.test.jsx
//
// Regression coverage for the 2026-08-16 remount storm. `handlePlayerClear`
// depended on the polled media element, so every element swap rebuilt the
// memoized player element and handed the shared Player a brand-new `play`
// object. The Player keys its media identity on that object, so each new
// object remounted the video and opened another Plex transcode session —
// which produced another element swap. 495 Plex sessions in 4 minutes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import PianoVideoPlayer from './PianoVideoPlayer.jsx';

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
vi.mock('../../PianoBreadcrumbContext.jsx', () => ({ usePianoBreadcrumb: () => {} }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'user_1' }) }));

const apiMock = vi.fn().mockResolvedValue({});
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

// Player stub: records the `play` prop object identity on every render and
// hands back whatever element the test currently declares as the media el.
let fakeMedia = null;
const seekSpy = vi.fn();
const timingSpies = [];
const playPropSpy = vi.fn();
vi.mock('../../../../../../../__capabilities/playback/browser/player/Player.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(({ play }, ref) => {
      playPropSpy(play);
      useImperativeHandle(ref, () => ({
        getMediaElement: () => fakeMedia,
        getCurrentTime: () => fakeMedia?.currentTime || 0,
        getDuration: () => 0,
        play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), seek: (target) => { seekSpy(target); fakeMedia.currentTime = target; },
      }), []);
      return <div data-testid="player-stub" />;
    }),
  };
});

beforeEach(() => {
  playPropSpy.mockClear();
  seekSpy.mockClear();
  fakeMedia = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  for (const spy of timingSpies.splice(0)) spy.mockRestore();
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


it('old media callbacks cannot seek the next video', async () => {
  const lecture = { plex: 'fixture-a', label: 'Lesson A', userPlayhead: 0 };
  fakeMedia = document.createElement('video');
  Object.defineProperty(fakeMedia, 'duration', { value: 600 });
  const oldMedia = fakeMedia;
  vi.spyOn(oldMedia, 'addEventListener');
  const { rerender, unmount } = render(<PianoVideoPlayer lecture={lecture} onBack={vi.fn()} />);
  await screen.findByTestId('player-stub');
  await act(async () => { vi.advanceTimersByTime(150); });
  fireEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
  const oldCallbacks = oldMedia.addEventListener.mock.calls.filter(([event]) => event === 'seeked').map(([, callback]) => callback);
  expect(oldCallbacks.length).toBeGreaterThan(0);
  fakeMedia = document.createElement('video');
  Object.defineProperty(fakeMedia, 'duration', { value: 600 });
  // Swap before the 100ms resolver poll: the stale callback must check the live controller too.
  seekSpy.mockClear();
  for (const callback of oldCallbacks) callback();
  expect(seekSpy).not.toHaveBeenCalled();
  rerender(<PianoVideoPlayer lecture={{ ...lecture, plex: 'fixture-b' }} onBack={vi.fn()} />);
  await act(async () => { vi.advanceTimersByTime(150); });
  const newVideoSeek = seekSpy;
  for (const callback of oldCallbacks) callback();
  await act(async () => { vi.advanceTimersByTime(5100); });
  expect(newVideoSeek).not.toHaveBeenCalled();
  unmount();
  for (const callback of oldCallbacks) callback();
  expect(newVideoSeek).not.toHaveBeenCalled();
});


it('timeout and unmount discard queued targets and release the relative-skip cursor', async () => {
  fakeMedia = document.createElement('video');
  Object.defineProperty(fakeMedia, 'duration', { value: 600 });
  const { unmount } = render(<PianoVideoPlayer lecture={{ plex: 'fixture', label: 'Fixture' }} onBack={vi.fn()} />);
  await screen.findByTestId('player-stub');
  await act(async () => { vi.advanceTimersByTime(150); });
  fireEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
  fireEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
  expect(seekSpy.mock.calls.map(([target]) => target)).toEqual([30]);
  await act(async () => { vi.advanceTimersByTime(5100); });
  await act(async () => { fakeMedia.dispatchEvent(new Event('seeked')); });
  expect(seekSpy).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
  expect(seekSpy).toHaveBeenLastCalledWith(15);
  fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
  unmount();
  await act(async () => { vi.advanceTimersByTime(5100); });
  await act(async () => { fakeMedia.dispatchEvent(new Event('seeked')); });
  expect(seekSpy.mock.calls.map(([target]) => target)).toEqual([30,15]);
});


it('expires the queued cursor before a relative skip even when its timer has not run', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  timingSpies.push(clock);
  fakeMedia = document.createElement('video');
  Object.defineProperty(fakeMedia, 'duration', { value: 600 });
  render(<PianoVideoPlayer lecture={{ plex: 'delayed-timer', label: 'Fixture' }} onBack={vi.fn()} />);
  await screen.findByTestId('player-stub');
  await act(async () => { vi.advanceTimersByTime(150); });
  fireEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
  fireEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
  expect(seekSpy.mock.calls.map(([target]) => target)).toEqual([30]);
  // Advance both clocks without executing the queued five-second timeout.
  clock.mockReturnValue(6100);
  vi.setSystemTime(Date.now() + 5100);
  fireEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
  expect(seekSpy.mock.calls.map(([target]) => target)).toEqual([30,60]);
});

it('a cancelled timeout cannot clear a newer active relative-skip cursor', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  timingSpies.push(clock);
  fakeMedia = document.createElement('video');
  Object.defineProperty(fakeMedia, 'duration', { value: 600 });
  const timers = vi.spyOn(globalThis, 'setTimeout');
  timingSpies.push(timers);
  render(<PianoVideoPlayer lecture={{ plex: 'cancelled-timer', label: 'Fixture' }} onBack={vi.fn()} />);
  await screen.findByTestId('player-stub');
  await act(async () => { vi.advanceTimersByTime(150); });
  fireEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
  const oldTimeout = timers.mock.calls.find(([, delay]) => delay === 5000)[0];
  fireEvent.click(screen.getByRole('button', { name: 'Forward 30 seconds' }));
  await act(async () => { fakeMedia.dispatchEvent(new Event('seeked')); });
  expect(seekSpy.mock.calls.map(([target]) => target)).toEqual([30,60]);
  fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
  oldTimeout(); // already cancelled on completion; simulate a queued callback.
  fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
  await act(async () => { fakeMedia.dispatchEvent(new Event('seeked')); });
  expect(seekSpy.mock.calls.map(([target]) => target)).toEqual([30,60,30]);
});
