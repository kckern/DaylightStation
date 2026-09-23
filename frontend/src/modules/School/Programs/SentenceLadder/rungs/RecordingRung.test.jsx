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
let heldModel;
let holdModel;

beforeEach(() => {
  capture.mockReset();
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  originalTime = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'currentTime');
  originalDuration = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'duration');
  Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
    configurable: true, get() { return this._t ?? 0; }, set(v) { this._t = v; },
  });
  // The model is 5.4 s long; a take blob reports no length, as a fresh
  // MediaRecorder webm does.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
    configurable: true, get() { return path(this.src || '').startsWith('/audio/') ? 5.4 : NaN; },
  });
  heldModel = null;
  holdModel = true;
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn(function play() {
    const src = path(this.src);
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
    pressKey('Tab');
    expect(lastLine('replay-restart')).toMatchObject({ seq: 16, piece: 0, via: 'key:Tab', phase: 'recording' });
    await screen.findByRole('button', { name: 'Stop' });
    speak({ voiced: 1200 });
    pressKey('Enter');
    await screen.findByRole('button', { name: 'Next part' });
    expect(lastLine('piece-stop')).toMatchObject({ via: 'key:Enter' });
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
