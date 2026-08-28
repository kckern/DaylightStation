// Behavior tests for the read-along playlist shell (jsdom).
//
// HONESTY NOTE: jsdom cannot see layout. Nothing here proves the stage has
// height or that verse text is visible — that geometry is covered by the
// Playwright fixture (tests/_infrastructure/harnesses/readalong-layout/) and
// by looking at the real tablet. These tests cover the shell's behavior:
// chapter chips, transport, progress plumbing, auto-resume, completion writes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ReadalongPlaylistPlayer from './ReadalongPlaylistPlayer.jsx';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * A media-element double with the two surfaces the seek clamp needs: a settable
 * `currentTime` and real listener registration. `seekTo` is what a scrub looks
 * like from the DOM's side — move the playhead, then fire `seeking` — which is
 * the only event `mediaGate` clamps on.
 */
const makeMediaEl = () => {
  const listeners = {};
  return {
    playbackRate: 1,
    currentTime: 0,
    paused: true,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    seekTo(seconds) {
      this.currentTime = seconds;
      (listeners.seeking || []).forEach((fn) => fn());
    },
  };
};

const h = vi.hoisted(() => ({
  seek: vi.fn(),
  toggle: vi.fn(),
  lastProps: null,
  media: null,
}));

vi.mock('./Player.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const MockPlayer = forwardRef((props, ref) => {
    h.lastProps = props;
    useImperativeHandle(ref, () => ({
      seek: h.seek,
      toggle: h.toggle,
      play: vi.fn(),
      pause: vi.fn(),
      getCurrentTime: () => 42,
      getDuration: () => 149,
      getMediaElement: () => h.media,
    }));
    return <div data-testid="mock-player" data-content-id={props.play?.contentId} />;
  });
  return { default: MockPlayer };
});

// `sampled` is part of the real surface (Logger.js) and `mediaGate` — which this
// shell injects its child logger into for the seek clamp — calls it. A double
// without it turns a clamp into a TypeError inside a DOM event handler.
vi.mock('../../lib/logging/Logger.js', () => {
  const noop = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
  noop.child = () => noop;
  return { getLogger: () => noop, default: () => noop };
});

const PARTS = [
  { id: 'p1', title: 'Psalms 49', contentId: 'readalong:scripture/ps-49' },
  { id: 'p2', title: 'Psalms 50', contentId: 'readalong:scripture/ps-50' },
  { id: 'p3', title: 'Psalms 51', contentId: 'readalong:scripture/ps-51' },
  { id: 'p4', title: 'Psalms 61', contentId: 'readalong:scripture/ps-61' },
];

const emitProgress = (payload) => act(() => { h.lastProps.onProgress(payload); });

// The component throttles progress writes off Date.now(), and the coverage
// accumulator judges whether a jump in media time is plausible for the wall
// time that passed. Both need a clock we drive, not a real one.
const CLOCK = { now: 1_700_000_000_000 };
let clockSpy = null;
const tick = (payload, wallMs = 500) => { CLOCK.now += wallMs; emitProgress(payload); };

/**
 * Play `ticks` samples at `rate`, 500ms of wall clock apart, starting from
 * media second `from`. Returns the media position reached.
 *
 * 21 ticks == 10.5s of wall == exactly one throttle window (THROTTLE_MS 10000),
 * with the write landing on the final tick — so a window's coverage is fully
 * flushed before the next window begins.
 */
const playAt = (rate, from, duration, ticks = 21, tickWall = 500) => {
  h.media.playbackRate = rate;
  let t = from;
  for (let i = 0; i < ticks; i++) {
    t = Math.round((t + (tickWall / 1000) * rate) * 1000) / 1000;
    tick({ currentTime: t, duration, paused: false }, tickWall);
  }
  return t;
};

const reportsFrom = (onProgress) => onProgress.mock.calls.map(([payload]) => payload);
const allRanges = (onProgress, partId = null) => reportsFrom(onProgress)
  .filter((r) => !partId || r.partId === partId)
  .flatMap((r) => r.playedRanges || []);
/** Union the ranges (they may overlap across reports after a rewind). */
const union = (ranges) => ranges.map(([s, e]) => [s, e]).sort((a, b) => a[0] - b[0]).reduce((out, [s, e]) => {
  const tail = out[out.length - 1];
  if (tail && s <= tail[1] + 1e-6) tail[1] = Math.max(tail[1], e);
  else out.push([s, e]);
  return out;
}, []);
const covers = (ranges, at) => union(ranges).some(([s, e]) => at >= s && at <= e);
const coveredSeconds = (ranges) => union(ranges).reduce((sum, [s, e]) => sum + (e - s), 0);

beforeEach(() => {
  h.seek.mockClear();
  h.toggle.mockClear();
  h.lastProps = null;
  h.media = makeMediaEl();
  CLOCK.now = 1_700_000_000_000;
  clockSpy = vi.spyOn(Date, 'now').mockImplementation(() => CLOCK.now);
});

afterEach(() => {
  clockSpy?.mockRestore();
  clockSpy = null;
});

describe('ReadalongPlaylistPlayer', () => {
  it('renders one chip per chapter — the merged picker/progress rail — with the current chip inert', async () => {
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} />);
    await screen.findByTestId('mock-player');
    const chips = PARTS.map((p) => screen.getByRole('button', { name: `Play ${p.title}` }));
    expect(chips).toHaveLength(4);
    expect(chips[0]).toBeDisabled();
    expect(chips[1]).toBeEnabled();
    // The old triple representation is gone: no separate segment bars row.
    expect(document.querySelector('.readalong-playlist__segments')).toBeNull();
    expect(document.querySelector('.readalong-playlist__picker')).toBeNull();
    // Transport: Previous disabled on the first chapter.
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
  });

  it('reflects playback progress in the current chip fill and the play/pause control', async () => {
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} />);
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 30, duration: 120, paused: false });
    const fill = document.querySelector('.readalong-playlist__chapter.is-current .readalong-playlist__chapter-fill i');
    expect(fill.style.width).toBe('25%');
    expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();
    emitProgress({ currentTime: 31, duration: 120, paused: true });
    expect(screen.getByRole('button', { name: /^Play$/ })).toBeInTheDocument();
  });

  it('auto-resumes a part with a meaningful saved position, exactly once', async () => {
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS}
        progress={{ parts: { p1: { lastPositionSeconds: 60 } } }}
      />
    );
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 0, duration: 149, paused: false });
    expect(h.seek).toHaveBeenCalledWith(60);
    emitProgress({ currentTime: 0.5, duration: 149, paused: false });
    expect(h.seek).toHaveBeenCalledTimes(1);
  });

  it('does not auto-resume a position at the very start or end', async () => {
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS}
        progress={{ parts: { p1: { lastPositionSeconds: 145 } } }}
      />
    );
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 0, duration: 149, paused: false });
    expect(h.seek).not.toHaveBeenCalled();
  });

  it('chapter tap switches the mounted part and writes progress for the departed one', async () => {
    const onProgress = vi.fn();
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 30, duration: 120, paused: false });
    fireEvent.click(screen.getByRole('button', { name: 'Play Psalms 50' }));
    const player = await screen.findByTestId('mock-player');
    expect(player.dataset.contentId).toBe('readalong:scripture/ps-50');
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ partId: 'p1', positionSeconds: 30, completed: false })
    );
  });

  it('a finished final part writes completed:true and stays put', async () => {
    const onProgress = vi.fn();
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS.slice(0, 1)} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 120, duration: 120, paused: true });
    act(() => { h.lastProps.clear(); });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ partId: 'p1', completed: true })
    );
    expect(screen.getByRole('button', { name: /Play again/ })).toBeInTheDocument();
  });

  it('transport buttons drive the player controller', async () => {
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} />);
    await screen.findByTestId('mock-player');
    fireEvent.click(screen.getByRole('button', { name: /^Play$/ }));
    expect(h.toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Back 15s/ }));
    expect(h.seek).toHaveBeenCalledWith(27); // 42 - 15
    fireEvent.click(screen.getByRole('button', { name: /Ahead 15s/ }));
    expect(h.seek).toHaveBeenCalledWith(57); // 42 + 15
  });

  it('renders the empty state with a way back when there are no parts', () => {
    const onExit = vi.fn();
    render(<ReadalongPlaylistPlayer title="Psalms" parts={[]} onExit={onExit} />);
    expect(screen.getByText('No audio is available for this reading.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(onExit).toHaveBeenCalled();
  });
});

// Coverage evidence. "The player said it ended" proves nothing here — a child
// who yanks the network five seconds in reaches the same clear() callback as
// one who listened to the whole chapter. What separates them is which seconds
// of audio actually went past, and how fast.
describe('ReadalongPlaylistPlayer — played coverage', () => {
  it('banks only the honest window: a fast window reports rate>1, the slow one that follows carries only its own seconds', async () => {
    const onProgress = vi.fn();
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');

    // Window one: 2x. 21 ticks x 500ms of wall = 10.5s of wall, 21s of media.
    const afterFast = playAt(2, 0, 200);
    const fastReport = reportsFrom(onProgress).at(-1);
    // The wire name is `maxRate`, and that is not cosmetic — see the
    // cross-boundary test at the bottom of this file.
    expect(fastReport.maxRate).toBe(2);
    expect(coveredSeconds(fastReport.playedRanges)).toBeGreaterThan(15);

    // Window two: back to 1x for one more window.
    playAt(1, afterFast, 200);
    const slowReport = reportsFrom(onProgress).at(-1);
    expect(slowReport).not.toBe(fastReport);
    expect(slowReport.maxRate).toBe(1);
    // THE POINT: the slow sample must not drag the fast window's seconds along
    // with it. Nothing below 21s may appear in it.
    expect(slowReport.playedRanges.length).toBeGreaterThan(0);
    for (const [start] of slowReport.playedRanges) expect(start).toBeGreaterThanOrEqual(afterFast - 1e-6);
    expect(covers(slowReport.playedRanges, 10)).toBe(false);
    expect(covers(slowReport.playedRanges, afterFast + 5)).toBe(true);
    // …and it is a delta, not the cumulative played range.
    expect(coveredSeconds(slowReport.playedRanges)).toBeLessThan(11);
  });

  it('reports contiguous deltas that merge into what was actually played', async () => {
    const onProgress = vi.fn();
    const { unmount } = render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');

    const end = playAt(1, 0, 200, 42); // two throttle windows of ordinary playback
    unmount();                         // flushes the tail of the window in progress
    const merged = union(allRanges(onProgress));
    expect(merged).toHaveLength(1);
    const [[start, stop]] = merged;
    expect(start).toBeLessThanOrEqual(1); // first sample only seeds the cursor
    expect(stop).toBeCloseTo(end, 3);
    // No report repeats the whole cumulative range.
    for (const report of reportsFrom(onProgress)) {
      expect(coveredSeconds(report.playedRanges)).toBeLessThan(11);
    }
  });

  it('a seek breaks the interval — the skipped region is never reported as played', async () => {
    const onProgress = vi.fn();
    const { unmount } = render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');

    playAt(1, 0, 200, 20);                                  // 0 -> 10
    tick({ currentTime: 90, duration: 200, paused: false }); // scrub 10 -> 90
    playAt(1, 90, 200, 10);                                 // 90 -> 95
    unmount();

    const ranges = allRanges(onProgress);
    expect(covers(ranges, 5)).toBe(true);
    expect(covers(ranges, 92)).toBe(true);
    expect(covers(ranges, 50)).toBe(false);
    expect(covers(ranges, 20)).toBe(false);
    // No single reported interval bridges the jump.
    for (const [start, stop] of ranges) expect(start > 10.5 || stop < 89).toBe(true);
    // ~10s before the scrub plus ~5s after it — never the 80s that were skipped.
    expect(coveredSeconds(ranges)).toBeLessThan(20);
  });

  it('coverage buffered before a media-element remount is still reported afterwards', async () => {
    const onProgress = vi.fn();
    const { unmount } = render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');

    playAt(1, 0, 200, 10); // 0 -> 5, still buffered: no throttle window has closed
    // The resilience path swaps the media element under us. Everything kept on
    // the old element is gone; the shell's accumulator must not be.
    h.media = makeMediaEl();
    tick({ currentTime: 5, duration: 200, paused: false });
    playAt(1, 5, 200, 8); // 5 -> 9 on the fresh element
    unmount();

    const ranges = allRanges(onProgress);
    expect(covers(ranges, 2)).toBe(true); // pre-remount seconds survived
    expect(covers(ranges, 7)).toBe(true); // post-remount seconds landed too
  });

  it('a part change flushes the outgoing chapter’s ranges under the outgoing partId', async () => {
    const onProgress = vi.fn();
    const { unmount } = render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');

    playAt(1, 0, 200, 20); // p1: 0 -> 10
    fireEvent.click(screen.getByRole('button', { name: 'Play Psalms 50' }));
    await screen.findByTestId('mock-player');

    const handoff = reportsFrom(onProgress).filter((r) => r.partId === 'p1').at(-1);
    expect(handoff.completed).toBe(false);
    expect(covers(allRanges(onProgress, 'p1'), 5)).toBe(true);

    playAt(1, 100, 300, 20); // p2: 100 -> 110
    unmount();

    const p2 = allRanges(onProgress, 'p2');
    expect(p2.length).toBeGreaterThan(0);
    for (const [start] of p2) expect(start).toBeGreaterThanOrEqual(100);
    // The outgoing chapter never picks up the incoming one's seconds, or vice versa.
    for (const [, stop] of allRanges(onProgress, 'p1')) expect(stop).toBeLessThanOrEqual(11);
    expect(covers(p2, 5)).toBe(false);
  });

  it('keeps every existing progress field intact alongside the new ones', async () => {
    const onProgress = vi.fn();
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS.slice(0, 1)} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');

    emitProgress({ currentTime: 30, duration: 120, paused: false });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      partId: 'p1', positionSeconds: 30, durationSeconds: 120,
    }));
    act(() => { h.lastProps.clear(); });
    const done = reportsFrom(onProgress).find((r) => r.completed === true);
    expect(done).toMatchObject({ partId: 'p1', completed: true });
    for (const report of reportsFrom(onProgress)) {
      expect(Array.isArray(report.playedRanges)).toBe(true);
      expect(typeof report.maxRate).toBe('number');
    }
  });

  it('re-listening to already-heard audio cannot inflate coverage past the real duration', async () => {
    const onProgress = vi.fn();
    const { unmount } = render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');

    playAt(1, 0, 30, 20);                                  // 0 -> 10
    tick({ currentTime: 5, duration: 30, paused: false }); // rewind
    playAt(1, 5, 30, 12);                                  // 5 -> 11 again
    unmount();

    const ranges = allRanges(onProgress);
    for (const [start, stop] of ranges) {
      expect(start).toBeGreaterThanOrEqual(0);
      expect(stop).toBeLessThanOrEqual(30);
    }
    // 0→11 was heard; 5→10 was heard twice. The raw intervals add up to more
    // than that, but what the server unions cannot exceed the span really played.
    const rawSeconds = ranges.reduce((sum, [start, stop]) => sum + (stop - start), 0);
    expect(rawSeconds).toBeGreaterThan(14);
    expect(coveredSeconds(ranges)).toBeLessThanOrEqual(11);
    expect(coveredSeconds(ranges)).toBeGreaterThan(10);
    // Within a single report the ranges are already merged and ordered.
    for (const report of reportsFrom(onProgress)) {
      const own = report.playedRanges || [];
      for (let i = 1; i < own.length; i += 1) expect(own[i][0]).toBeGreaterThan(own[i - 1][1]);
    }
  });
});

// A REQUIRED companion is the one a worksheet's gate row depends on, so the
// two cheap ways to shorten it — raise the rate, drag the scrubber — have to
// stop in front of the child rather than only in the server's arithmetic. The
// server already refuses both (a sample above 1x has its ranges dropped, and
// skipped seconds were never in a `playedRanges` delta to begin with); the
// clamp exists so a child does not spend a chapter walking into a wall they
// cannot see. An OPTIONAL companion keeps every affordance it had.
describe('ReadalongPlaylistPlayer — a required companion cannot be skipped past', () => {
  const seededProgress = { parts: { p1: { lastPositionSeconds: 50, durationSeconds: 200 } } };

  it('pins the playback rate to 1, so no window it reports can be dropped as fast', async () => {
    const onProgress = vi.fn();
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS} participation="required" onProgress={onProgress}
      />
    );
    await screen.findByTestId('mock-player');

    playAt(2, 0, 200); // the child (or a restored session rate) asks for 2x
    expect(h.media.playbackRate).toBe(1);
    for (const report of reportsFrom(onProgress)) expect(report.maxRate).toBe(1);
  });

  it('leaves an optional companion’s rate exactly as it was', async () => {
    const onProgress = vi.fn();
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} onProgress={onProgress} />);
    await screen.findByTestId('mock-player');

    playAt(2, 0, 200);
    expect(h.media.playbackRate).toBe(2);
    expect(reportsFrom(onProgress).at(-1).maxRate).toBe(2);
  });

  it('“Ahead 15s” stops at the furthest point actually reached', async () => {
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS} participation="required" progress={seededProgress}
      />
    );
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 40, duration: 200, paused: false });
    h.seek.mockClear();

    // The controller reports the playhead at 42; 42 + 15 is past the 50s
    // high-water mark, so the jump lands ON the mark, not beyond it.
    fireEvent.click(screen.getByRole('button', { name: /Ahead 15s/ }));
    expect(h.seek).toHaveBeenCalledWith(50);
  });

  it('“Ahead 15s” inside already-heard audio is not clamped at all', async () => {
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS} participation="required"
        progress={{ parts: { p1: { lastPositionSeconds: 120, durationSeconds: 200 } } }}
      />
    );
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 40, duration: 200, paused: false });
    h.seek.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Ahead 15s/ }));
    expect(h.seek).toHaveBeenCalledWith(57); // 42 + 15, well inside the mark
  });

  it('“Ahead 15s” is unbounded for an optional companion — the regression that matters', async () => {
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} progress={seededProgress} />);
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 40, duration: 200, paused: false });
    h.seek.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Ahead 15s/ }));
    expect(h.seek).toHaveBeenCalledWith(57);
  });

  it('a scrub past the high-water mark is snapped back to it', async () => {
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS} participation="required" progress={seededProgress}
      />
    );
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 40, duration: 200, paused: false });

    act(() => { h.media.seekTo(190); });
    expect(h.media.currentTime).toBe(50);
  });

  it('the same scrub on an optional companion goes exactly where it was aimed', async () => {
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} progress={seededProgress} />);
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 40, duration: 200, paused: false });

    act(() => { h.media.seekTo(190); });
    expect(h.media.currentTime).toBe(190);
  });

  it('rewinding, and re-listening, stay free', async () => {
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS} participation="required" progress={seededProgress}
      />
    );
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 40, duration: 200, paused: false });
    h.seek.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Back 15s/ }));
    expect(h.seek).toHaveBeenCalledWith(27); // 42 - 15, untouched
    act(() => { h.media.seekTo(3); });
    expect(h.media.currentTime).toBe(3);
  });

  it('the mark advances with playback, so ordinary listening is never clamped', async () => {
    render(<ReadalongPlaylistPlayer title="Psalms" parts={PARTS} participation="required" />);
    await screen.findByTestId('mock-player');

    playAt(1, 0, 200, 40); // 0 -> 20 at normal speed
    act(() => { h.media.seekTo(19); });
    expect(h.media.currentTime).toBe(19);
  });

  it('a chapter already finished is seekable end to end', async () => {
    render(
      <ReadalongPlaylistPlayer
        title="Psalms" parts={PARTS} participation="required"
        progress={{ parts: { p1: { lastPositionSeconds: 12, durationSeconds: 200, completedAt: '2026-08-27T00:00:00Z' } } }}
      />
    );
    await screen.findByTestId('mock-player');
    emitProgress({ currentTime: 12, duration: 200, paused: false });

    act(() => { h.media.seekTo(190); });
    expect(h.media.currentTime).toBe(190);
  });
});

/**
 * The progress payload crosses a boundary NOTHING type-checks: this component
 * builds it, `SchoolApp` forwards it verbatim, and `RecordLessonCompanionProgress`
 * destructures a NAMED ALLOWLIST out of it. A field the allowlist does not name is
 * silently dropped — no error, no warning.
 *
 * That is why this test exists rather than a comment. During development this
 * component sent `rate` while the server named `maxRate`: the ranges arrived, the
 * rate did not, and the server read a missing rate as normal speed and banked
 * fast-forwarded audio. The anti-fast-forward guarantee was dead and every test
 * on both sides still passed, because each side was correct on its own.
 *
 * Source-text assertions are the only thing that can see both sides at once. The
 * same reasoning, and the same technique, as `lib/Player/gate/gateIds.test.js`.
 */
describe('the progress wire contract', () => {
  const USE_CASE = path.resolve(
    HERE, '../../../../backend/src/3_applications/school/usecases/RecordLessonCompanionProgress.mjs',
  );

  /** Comment-stripped, so a prose mention never satisfies a code assertion. */
  const codeOf = (file) => readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

  it('sends exactly the coverage fields the server allowlists', () => {
    const server = codeOf(USE_CASE);
    const client = codeOf(path.resolve(HERE, 'ReadalongPlaylistPlayer.jsx'));

    for (const field of ['playedRanges', 'maxRate']) {
      expect(server, `server must allowlist ${field}`).toContain(field);
      expect(client, `client must send ${field}`).toContain(field);
    }
    // The name that was wrong once. `rate:` as an emitted property would mean
    // the client is back to a name the allowlist drops.
    expect(client).not.toMatch(/^\s*rate,\s*$/m);
  });
});
