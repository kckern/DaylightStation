// PianoVideoPlayer.credit.test.jsx — the end of an enforced lesson waits for the
// server's credit answer: a warm-up swaps in on drill-owed; credit ends as today.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
const api = vi.hoisted(() => ({ fn: null }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...a) => api.fn(...a) }));
vi.mock('./LessonDrill.jsx', () => ({ default: (props) => <div data-testid="lesson-drill">drill {props.drill.reps}</div> }));

let fakeMedia = null;
vi.mock('../../../../../../../__capabilities/playback/browser/player/Player.jsx', async () => {
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

const lecture = { plex: '243203', label: 'Lecture 3', userWatched: false, userPlayhead: 0, expectation: { enforced: true, preschool: false } };

beforeEach(() => {
  fakeMedia = document.createElement('video');
  Object.defineProperty(fakeMedia, 'duration', { value: 600, configurable: true });
  Object.defineProperty(fakeMedia, 'currentTime', { value: 600, writable: true, configurable: true });
});
afterEach(() => { vi.useRealTimers(); });

async function endWith(credit, extra = {}) {
  api.fn = vi.fn().mockResolvedValue({ userProgress: { credit } });
  const onBack = vi.fn();
  const onAutoAdvance = vi.fn();
  render(<PianoVideoPlayer lecture={{ ...lecture, ...extra }} source="Course" onBack={onBack} onAutoAdvance={extra.noAdvance ? null : onAutoAdvance} />);
  await screen.findByTestId('player-stub');
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
  await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { onBack, onAutoAdvance };
}

describe('PianoVideoPlayer — credit at the end of a lesson', () => {
  it('drill-owed swaps the warm-up in place of the video', async () => {
    const { onBack, onAutoAdvance } = await endWith({ outcome: 'drill-owed', score: 3, drill: { reps: 4, sets: 2, roots: ['C', 'G'], spec: { kind: 'exercise' } } });
    expect(await screen.findByTestId('lesson-drill')).toBeTruthy();
    expect(screen.queryByTestId('player-stub')).toBe(null);
    expect(onBack).not.toHaveBeenCalled();
    expect(onAutoAdvance).not.toHaveBeenCalled();
    const body = api.fn.mock.calls.at(-1)[1];
    expect(body.practice).toMatchObject({ sittingId: expect.any(String) });
  });

  it('credited ends as today (auto-advance)', async () => {
    const { onAutoAdvance } = await endWith({ outcome: 'credited', score: 8 });
    expect(onAutoAdvance).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('lesson-drill')).toBe(null);
  });

  it('credited with no auto-advance goes back to the course', async () => {
    const { onBack } = await endWith({ outcome: 'credited', score: 8 }, { noAdvance: true });
    expect(onBack).toHaveBeenCalled();
  });

  it('a lesson already counted is not held at its end', async () => {
    api.fn = vi.fn().mockResolvedValue({});
    const onAutoAdvance = vi.fn();
    render(<PianoVideoPlayer lecture={{ ...lecture, userWatched: true }} source="Course" onBack={vi.fn()} onAutoAdvance={onAutoAdvance} />);
    await screen.findByTestId('player-stub');
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
    expect(onAutoAdvance).toHaveBeenCalledTimes(1);
  });
  it('a stalled end-of-lesson post never wedges the lesson: it proceeds after the deadline (review I2)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] , shouldAdvanceTime: true });
    api.fn = vi.fn(() => new Promise(() => {}));
    const onAutoAdvance = vi.fn();
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} onAutoAdvance={onAutoAdvance} />);
    await screen.findByTestId('player-stub');
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
    expect(onAutoAdvance).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(11000); });
    expect(onAutoAdvance).toHaveBeenCalledTimes(1);
  });

  it('played seconds start at the first frame, not at mount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    api.fn = vi.fn().mockResolvedValue({ userProgress: { credit: { outcome: 'credited' } } });
    render(<PianoVideoPlayer lecture={lecture} source="Course" onBack={vi.fn()} onAutoAdvance={vi.fn()} />);
    await screen.findByTestId('player-stub');
    // Autoplay blocked / a slow start: 10 s on the page, no frame yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await act(async () => { fakeMedia.dispatchEvent(new Event('playing')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    await act(async () => { fakeMedia.dispatchEvent(new Event('pause')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await act(async () => { fakeMedia.dispatchEvent(new Event('ended')); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const posts = api.fn.mock.calls.filter((c) => c[0] === 'api/v1/play/log');
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.at(-1)[1].practice.playedSec).toBe(3);
  });
});
