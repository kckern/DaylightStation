import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  act, render, screen, fireEvent, waitFor,
} from '@testing-library/react';
import RecordingRung from './RecordingRung.jsx';

/**
 * OBSERVABILITY OF THE RECORDING RUNG (2026-09-23). A stuck sitting has to be
 * explainable from `school.language.capture.*` alone: which key or touch drove
 * each step and from which phase, how long each piece's span of the model was,
 * how much of each take was voice, what every playback was and how it ended,
 * and how long the learner sat on a review before acting.
 *
 * Behaviour is covered by SentenceLadderProgram.test.jsx; this file asserts
 * the log lines only.
 */

const { capture, captureError, rung, audio, audioError } = vi.hoisted(() => ({
  capture: vi.fn(), captureError: vi.fn(), rung: vi.fn(), audio: vi.fn(), audioError: vi.fn(),
}));
vi.mock('../languageLog.js', () => ({
  languageLog: {
    capture: (...a) => capture(...a),
    captureError: (...a) => captureError(...a),
    rung: (...a) => rung(...a),
    audio: (...a) => audio(...a),
    audioError: (...a) => audioError(...a),
  },
}));
const { joinTakeMock } = vi.hoisted(() => ({ joinTakeMock: vi.fn() }));
vi.mock('./joinTake.js', () => ({ joinTake: (...a) => joinTakeMock(...a) }));
vi.mock('./useModelPauses.js', () => ({ default: () => ({ current: [] }) }));
/** The band, reduced to the one thing these tests need: its level callback. */
const { band } = vi.hoisted(() => ({ band: { onLevel: null } }));
vi.mock('./VoiceBand.jsx', () => ({
  default: ({ onLevel }) => { band.onLevel = onLevel; return null; },
}));

const ENTRY = {
  seq: 16,
  rung: 'recording',
  text: { EN: 'English 16', KR: '한국어 16' },
  prompt: [{ role: 'target', language: 'KR' }],
};
const audioUrl = (seq, lang) => `/audio/${seq}/${lang}`;
const path = (url) => url.replace(/^https?:\/\/[^/]+/, '');
const pressKey = (key) => fireEvent.keyDown(document.body, { key });
/** The capture line named `detail`, the last one logged. */
const lastLine = (detail) => capture.mock.calls.filter(([d]) => d === detail).at(-1)?.[1];
const lines = (detail) => capture.mock.calls.filter(([d]) => d === detail).map(([, data]) => data);

let now;
let originalTime;
let originalDuration;
let originalSrc;
let heldModel;
let holdModel;
let played;

beforeEach(() => {
  capture.mockReset();
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  originalTime = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'currentTime');
  originalDuration = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'duration');
  Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
    configurable: true, get() { return this._t ?? 0; }, set(v) { this._t = v; },
  });
  // A new src starts at 0, as a real element does.
  originalSrc = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'src');
  Object.defineProperty(window.HTMLMediaElement.prototype, 'src', {
    configurable: true,
    get() { return this._src ?? this.getAttribute('src') ?? ''; },
    set(v) { this._src = v; this._t = 0; },
  });
  // The model is 5.4 s long; a take blob reports no length, as a fresh
  // MediaRecorder webm does.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
    configurable: true, get() { return path(this.src || '').startsWith('/audio/') ? 5.4 : NaN; },
  });
  heldModel = null;
  holdModel = true;
  played = [];
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn(function play() {
    const src = path(this.src);
    played.push({ src, atMs: Math.round((this._t ?? 0) * 1000) });
    if (holdModel && src === '/audio/16/KR') { heldModel = this; holdModel = false; return Promise.resolve(); }
    setTimeout(() => this.onended?.(), 0);
    return Promise.resolve();
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  });
  let n = 0;
  window.MediaRecorder = class {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      n += 1;
      this.ondataavailable?.({ data: new Blob([`take${n}`], { type: 'audio/webm' }) });
      this.onstop?.();
    }
  };
  window.URL.createObjectURL = vi.fn(() => `blob:take-${n}`);
  window.URL.revokeObjectURL = vi.fn();
  joinTakeMock.mockReset();
  joinTakeMock.mockImplementation(async () => new Blob(['joined'], { type: 'audio/wav' }));
});
afterEach(() => {
  Date.now.mockRestore?.();
  if (originalTime) Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', originalTime);
  else delete window.HTMLMediaElement.prototype.currentTime;
  if (originalDuration) Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', originalDuration);
  if (originalSrc) Object.defineProperty(window.HTMLMediaElement.prototype, 'src', originalSrc);
});

const renderRung = (props = {}) => render(
  <RecordingRung entry={ENTRY} audioUrl={audioUrl} cueUrl="/cue/record" onComplete={vi.fn()} saving={false} {...props} />,
);

/** Start, let the model play to `atMs`, cut with →. Leaves the mic open on piece 0. */
async function cutAt(atMs) {
  await screen.findByRole('button', { name: 'Listen, then record' });
  pressKey(' ');
  await waitFor(() => expect(heldModel).not.toBeNull());
  heldModel._t = atMs / 1000;
  now += atMs;
  pressKey('ArrowRight');
  await screen.findByRole('button', { name: 'Stop' });
}

/** Levels for `ms` of a take: `voiced` ms of voice then silence to the end. */
function speak({ silentFirst = 0, voiced = 0, silentAfter = 0 }) {
  const step = 100;
  act(() => {
    band.onLevel?.(0);
    for (let t = 0; t < silentFirst; t += step) { now += step; band.onLevel?.(0); }
    for (let t = 0; t < voiced; t += step) { now += step; band.onLevel?.(0.3); }
    for (let t = 0; t < silentAfter; t += step) { now += step; band.onLevel?.(0); }
  });
}

describe('recording rung — capture log', () => {
  it('a cut says where every piece of the sentence now lies, and what drove it', async () => {
    renderRung();
    await cutAt(3611);
    expect(lastLine('cut')).toMatchObject({
      seq: 16,
      piece: 0,
      cutMs: 3611,
      sentenceMs: 5400,
      pieceSpans: [{ from: 0, to: 3611 }, { from: 3611, to: 5400 }],
      via: 'key:ArrowRight',
      phase: 'prompting',
    });
    // The sentence it cut into is a playback that was stopped, not one that ended.
    expect(lastLine('playback')).toMatchObject({ seq: 16, what: 'sentence', outcome: 'stopped', ms: 3611 });
  });

  it('a piece take carries its span, its voice/silence split and the key that stopped it', async () => {
    renderRung();
    await cutAt(3611);
    expect(lastLine('start')).toMatchObject({ seq: 16, piece: 0, via: 'auto' });
    speak({ voiced: 800, silentAfter: 300 });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Next part' });
    expect(lastLine('piece-stop')).toMatchObject({
      seq: 16,
      piece: 0,
      fromMs: 0,
      toMs: 3611,
      spanMs: 3611,
      durationMs: 1100,
      voicedMs: 800,
      silentMs: 300,
      endSilentMs: 300,
      via: 'key:Space',
      phase: 'recording',
    });
    expect(lastLine('playback')).toMatchObject({ what: 'take', piece: 0, outcome: 'ended' });
  });

  it('logs the time sat on a review before acting, and which key acted', async () => {
    renderRung();
    await cutAt(3611);
    speak({ voiced: 1200 });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Next part' });
    now += 19_000;
    pressKey(' ');
    await waitFor(() => expect(lastLine('review-idle')).toBeTruthy());
    expect(lastLine('review-idle')).toMatchObject({ seq: 16, piece: 0, ms: 19_000, via: 'key:Space' });
    expect(lastLine('piece-next')).toMatchObject({ seq: 16, piece: 1, via: 'key:Space', phase: 'review' });
    // Piece 1's span is the rest of the sentence, and it is a playback of its own.
    await screen.findByRole('button', { name: 'Stop' });
    expect(lastLine('playback')).toMatchObject({ what: 'span', piece: 1, outcome: 'ended' });
  });

  it('redo, restart and keep each say how they were driven — key or touch — and from which phase', async () => {
    renderRung();
    await cutAt(3611);
    speak({ voiced: 1200 });
    pressKey(' ');
    fireEvent.click(await screen.findByRole('button', { name: 'Redo this part' }));
    expect(lastLine('piece-redo')).toMatchObject({ seq: 16, piece: 0, via: 'touch', phase: 'review' });
    await screen.findByRole('button', { name: 'Stop' });
    speak({ voiced: 1200 });
    pressKey('Tab');
    // Tab at a live mic is "hear it again" (2026-09-23): the take stops and is kept.
    expect(lastLine('hear')).toMatchObject({ seq: 16, piece: 0, via: 'key:Tab', phase: 'recording' });
    await screen.findByRole('button', { name: 'Next part' });
    expect(lastLine('piece-stop')).toMatchObject({ via: 'key:Tab', phase: 'recording' });
    pressKey('Backspace');
    expect(lastLine('piece-redo')).toMatchObject({ via: 'key:Backspace', phase: 'review' });
  });

  it('the join and the keep carry the key that finished them; the joined take sums its pieces', async () => {
    const onComplete = vi.fn();
    renderRung({ onComplete });
    await cutAt(3611);
    speak({ voiced: 1000, silentAfter: 200 });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Next part' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Stop' });
    speak({ silentFirst: 300, voiced: 1500, silentAfter: 400 });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(lastLine('piece-stop')).toMatchObject({
      piece: 1, via: 'touch', fromMs: 3611, toMs: 5400, spanMs: 1789, voicedMs: 1500, silentMs: 700, endSilentMs: 400,
    });
    await screen.findByRole('button', { name: 'Finish' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Keep it' });
    expect(lastLine('stitched')).toMatchObject({
      seq: 16, pieces: 2, via: 'key:Space', phase: 'review', voicedMs: 2500, silentMs: 900,
    });
    pressKey(' ');
    expect(lastLine('keep')).toMatchObject({ seq: 16, via: 'key:Space', phase: 'review', joined: true });
    expect(onComplete).toHaveBeenCalled();
  });

  it('a one-go take: stop via touch, voiced/silent on the stop line, compare as its own playback', async () => {
    renderRung();
    await screen.findByRole('button', { name: 'Listen, then record' });
    fireEvent.click(screen.getByRole('button', { name: 'Listen, then record' }));
    await waitFor(() => expect(heldModel).not.toBeNull());
    now += 5400;
    await act(async () => { heldModel.onended?.(); });
    await screen.findByRole('button', { name: 'Stop' });
    expect(lastLine('playback')).toMatchObject({ what: 'sentence', outcome: 'ended', ms: 5400 });
    speak({ voiced: 2000, silentAfter: 500 });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(lastLine('stop')).toMatchObject({
      seq: 16, via: 'touch', phase: 'recording', voicedMs: 2000, silentMs: 500, endSilentMs: 500,
    });
    await screen.findByRole('button', { name: 'Keep it' });
    pressKey('Tab');
    expect(lastLine('compare')).toMatchObject({ via: 'key:Tab', phase: 'review' });
    await waitFor(() => expect(lastLine('playback')).toMatchObject({ what: 'compare', outcome: 'ended' }));
  });

  it('says when the silent warning comes on and when it clears — once each, not per frame', async () => {
    renderRung();
    await screen.findByRole('button', { name: 'Listen, then record' });
    pressKey(' ');
    await waitFor(() => expect(heldModel).not.toBeNull());
    await act(async () => { heldModel.onended?.(); });
    await screen.findByRole('button', { name: 'Stop' });
    speak({ silentFirst: 3000 });
    expect(lines('silent-warning')).toEqual([expect.objectContaining({ seq: 16, afterMs: 2000 })]);
    expect(screen.getByText(/Nothing’s coming through/)).toBeTruthy();
    act(() => { now += 100; band.onLevel(0.3); });
    expect(lines('silent-cleared')).toEqual([expect.objectContaining({ seq: 16, afterMs: 3100 })]);
  });

  it('a take playback cut short by a key is "stopped", with how much of it was heard', async () => {
    window.HTMLMediaElement.prototype.play = vi.fn(function play() {
      const src = path(this.src);
      if (src.startsWith('blob:')) return Promise.resolve(); // the take hangs
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    });
    renderRung();
    await screen.findByRole('button', { name: 'Listen, then record' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Stop' });
    speak({ voiced: 1500 });
    pressKey(' ');
    await screen.findByRole('status', { name: 'Playing your recording' });
    now += 700;
    pressKey(' ');
    expect(lastLine('playback')).toMatchObject({ what: 'take', outcome: 'stopped', ms: 700 });
  });
});

/**
 * THE CHUNKED FLOW (owner ruling 2026-09-23): Space pauses to chunk; Tab never
 * destroys; ← starts over; Backspace redoes the chunk; Enter is done; silence
 * after speech stops the mic.
 */
describe('recording rung — chunks', () => {
  /** Space, model to `atMs`, Space again: a chunk ends there. Mic open for piece 0. */
  async function pauseAt(atMs, key = ' ') {
    await screen.findByRole('button', { name: 'Listen, then record' });
    pressKey(' ');
    await waitFor(() => expect(heldModel).not.toBeNull());
    heldModel._t = atMs / 1000;
    now += atMs;
    pressKey(key);
    await screen.findByRole('button', { name: 'Stop' });
  }
  const say = async (voiced = 1200) => {
    speak({ voiced });
    pressKey(' ');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
  };
  const spanPlays = (fromMs) => played.filter((p) => p.src === '/audio/16/KR' && p.atMs === fromMs);

  it('Space while the sentence plays pauses it there and makes a chunk', async () => {
    renderRung();
    await pauseAt(3611);
    expect(lastLine('cut')).toMatchObject({ piece: 0, cutMs: 3611, via: 'key:Space', phase: 'prompting' });
    expect(played.map((p) => p.src)).toContain('/cue/record');
  });

  it('→ still cuts, as an alias', async () => {
    renderRung();
    await pauseAt(2000, 'ArrowRight');
    expect(lastLine('cut')).toMatchObject({ cutMs: 2000, via: 'key:ArrowRight' });
  });

  it('Space in review goes on with the sentence from where it paused', async () => {
    renderRung();
    await pauseAt(3611);
    await say();
    await screen.findByRole('button', { name: 'Next part' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Stop' });
    expect(spanPlays(3611)).toHaveLength(1);
  });

  it('Tab while recording keeps the take — it stops, and plays the span then the take', async () => {
    renderRung();
    await pauseAt(3611);
    speak({ voiced: 1200 });
    pressKey('Tab');
    await screen.findByRole('button', { name: 'Next part' });
    expect(lines('replay-restart')).toHaveLength(0);
    expect(lastLine('piece-stop')).toMatchObject({ piece: 0, via: 'key:Tab', phase: 'recording' });
    await waitFor(() => expect(lastLine('playback')).toMatchObject({ what: 'compare', piece: 0 }));
    expect(played.some((p) => p.src.startsWith('blob:'))).toBe(true);
  });

  it('Tab in any phase never throws a take away', async () => {
    renderRung();
    await pauseAt(3611);
    await say();
    await screen.findByRole('button', { name: 'Next part' });
    pressKey('Tab');                                    // review: compare
    pressKey(' ');                                      // on to piece 1
    await screen.findByRole('button', { name: 'Stop' });
    speak({ voiced: 1200 });
    pressKey('Tab');                                    // recording: stop + keep
    await screen.findByRole('button', { name: 'Finish' });
    expect(lines('piece-stop')).toHaveLength(2);
    expect(lines('replay-restart')).toHaveLength(0);
    pressKey(' ');
    await waitFor(() => expect(joinTakeMock).toHaveBeenCalled());
    expect(joinTakeMock.mock.calls[0][0]).toHaveLength(2);
  });

  it('Backspace redoes only the chunk in hand', async () => {
    renderRung();
    await pauseAt(3611);
    await say();
    await screen.findByRole('button', { name: 'Next part' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Stop' });
    await say();
    await screen.findByRole('button', { name: 'Finish' });
    pressKey('Backspace');
    await screen.findByRole('button', { name: 'Stop' });
    expect(lastLine('piece-redo')).toMatchObject({ piece: 1, via: 'key:Backspace' });
    expect(spanPlays(3611)).toHaveLength(2);
    expect(spanPlays(0).length).toBe(1);
  });

  it('← clears every chunk and plays the sentence from the top', async () => {
    renderRung();
    await pauseAt(3611);
    await say();
    await screen.findByRole('button', { name: 'Next part' });
    pressKey('ArrowLeft');
    expect(lastLine('restart')).toMatchObject({ pieces: 1, via: 'key:ArrowLeft', phase: 'review' });
    await waitFor(() => expect(spanPlays(0)).toHaveLength(2));
    // One segment again: the whole sentence, nothing recorded.
    expect(screen.getAllByRole('button', { name: /^Part / })).toHaveLength(1);
  });

  it('Enter joins what has been said, even mid-sentence', async () => {
    renderRung();
    await pauseAt(3611);
    await say(1500);
    await screen.findByRole('button', { name: 'Next part' });
    pressKey('Enter');
    await waitFor(() => expect(joinTakeMock).toHaveBeenCalled());
    expect(joinTakeMock.mock.calls[0][0]).toHaveLength(1);
    await screen.findByRole('button', { name: 'Keep it' });
    expect(lastLine('stitched')).toMatchObject({ pieces: 1, partial: true, via: 'key:Enter' });
  });

  it('silence stops the mic by itself — but only once speech was heard', async () => {
    renderRung();
    await pauseAt(3611);
    speak({ silentFirst: 5000 });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(lines('auto-stop')).toHaveLength(0);
    speak({ voiced: 800, silentAfter: 3000 });
    await screen.findByRole('button', { name: 'Next part' });
    expect(lastLine('auto-stop')).toMatchObject({ piece: 0, via: 'auto', phase: 'recording' });
    expect(lastLine('piece-stop')).toMatchObject({ via: 'auto', endSilentMs: 3000 });
  });

  it('tapping a segment redoes that chunk', async () => {
    renderRung();
    await pauseAt(3611);
    await say();
    await screen.findByRole('button', { name: 'Next part' });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Stop' });
    await say();
    await screen.findByRole('button', { name: 'Finish' });
    const segments = screen.getAllByRole('button', { name: /^Part / });
    expect(segments).toHaveLength(2);
    fireEvent.click(segments[0]);
    await screen.findByRole('button', { name: 'Stop' });
    expect(lastLine('piece-redo')).toMatchObject({ piece: 0, via: 'touch' });
    expect(spanPlays(0).length).toBe(2);
    // Chunk 1 still has its take: after the redo, Space joins rather than re-asking for it.
    await say();
    await screen.findByRole('button', { name: 'Finish' });
  });

  // The owner's seq-16 sitting, replayed: a cut, two short second pieces and
  // their redos, then Tab pressed three times in 5s "to hear it again", then a
  // long silent tail. It used to wipe the take three times and run 16.5s.
  it('the seq-16 sitting no longer loops', async () => {
    renderRung();
    await pauseAt(3611);
    await say(1200);
    await screen.findByRole('button', { name: 'Next part' });
    pressKey(' ');                                      // piece 1
    await screen.findByRole('button', { name: 'Stop' });
    await say(1300);
    await screen.findByRole('button', { name: 'Finish' });
    pressKey('Backspace');
    await screen.findByRole('button', { name: 'Stop' });
    await say(1700);
    await screen.findByRole('button', { name: 'Finish' });
    pressKey('Backspace');
    await screen.findByRole('button', { name: 'Stop' });
    // Tab ×3 in 5s: the first stops and keeps the take, the others compare.
    speak({ voiced: 1500 });
    pressKey('Tab');
    await screen.findByRole('button', { name: 'Finish' });
    now += 1500; pressKey('Tab');
    now += 1500; pressKey('Tab');
    expect(lines('replay-restart')).toHaveLength(0);
    expect(lines('piece-stop')).toHaveLength(4);
    // Redo once more and trail off: the mic stops itself after 3s of silence.
    pressKey('Backspace');
    await screen.findByRole('button', { name: 'Stop' });
    speak({ voiced: 2100, silentAfter: 3000 });
    await screen.findByRole('button', { name: 'Finish' });
    expect(lastLine('piece-stop').durationMs).toBeLessThan(6000);
    pressKey(' ');
    await screen.findByRole('button', { name: 'Keep it' });
    expect(lastLine('stitched')).toMatchObject({ pieces: 2 });
    expect(lastLine('stitched').partial).toBeFalsy();
  });
});

describe('recording rung — review fixes (2026-09-23)', () => {
  it('a tapped tile hands focus back to the stage, so the next Space is the rung\'s', async () => {
    renderRung();
    const hearIt = await screen.findByRole('button', { name: 'Hear it again' });
    hearIt.focus();
    fireEvent.click(hearIt);
    expect(document.activeElement).not.toBe(hearIt);
    // Space from wherever focus now is: the forward action (play), not a re-click.
    fireEvent.keyDown(document.activeElement, { key: ' ' });
    await waitFor(() => expect(heldModel).not.toBeNull());
  });

  it('a blocked take playback releases its master-volume binding', async () => {
    const vol = await import('../../../../../lib/volume/bindMediaToMaster.js');
    const unbind = vi.fn();
    const spy = vi.spyOn(vol, 'bindMediaToMaster').mockImplementation(() => unbind);
    window.HTMLMediaElement.prototype.play = vi.fn(function play() {
      if (path(this.src).startsWith('blob:')) return Promise.reject(new Error('NotAllowedError'));
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    });
    try {
      renderRung();
      await screen.findByRole('button', { name: 'Listen, then record' });
      pressKey(' ');
      await screen.findByRole('button', { name: 'Stop' });
      speak({ voiced: 1500 });
      const before = unbind.mock.calls.length;
      pressKey(' ');
      await screen.findByRole('button', { name: 'Keep it' });
      expect(unbind.mock.calls.length).toBeGreaterThan(before);
      expect(lastLine('playback')).toMatchObject({ what: 'take', outcome: 'blocked' });
    } finally {
      spy.mockRestore();
    }
  });

  it('in chunk mode Shift+Tab plays the WHOLE sentence, and destroys nothing', async () => {
    renderRung({ showShortcuts: true });
    await screen.findByRole('button', { name: 'Listen, then record' });
    pressKey(' ');
    await waitFor(() => expect(heldModel).not.toBeNull());
    heldModel._t = 3.611; now += 3611;
    pressKey(' ');
    await screen.findByRole('button', { name: 'Stop' });
    speak({ voiced: 1200 });
    pressKey(' ');
    await screen.findByRole('button', { name: 'Next part' });
    expect(screen.getByText('Shift+Tab: whole sentence')).toBeTruthy();
    const before = played.length;
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
    await waitFor(() => expect(played.slice(before)).toEqual([{ src: '/audio/16/KR', atMs: 0 }]));
    expect(screen.getByRole('button', { name: 'Next part' })).toBeTruthy();
    expect(lines('piece-stop')).toHaveLength(1);
  });
});
