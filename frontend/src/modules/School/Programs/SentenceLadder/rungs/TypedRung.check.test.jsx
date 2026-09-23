import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  act, render, screen, fireEvent,
} from '@testing-library/react';
import TypedRung from './TypedRung.jsx';
import HangulTypingProvider from '../../../ime/HangulTypingProvider.jsx';

/**
 * CHECK YOUR WORK (owner ruling 2026-09-23): every submitted interpretation
 * reveals the answer beside the learner's own — typed or spoken, right or
 * wrong — and Show the answer remains the give-up. The two are logged apart:
 * `interpretation.checked` vs `interpretation.gave-up`.
 */

const { interpretation, rung } = vi.hoisted(() => ({ interpretation: vi.fn(), rung: vi.fn() }));
vi.mock('../languageLog.js', () => ({
  languageLog: {
    interpretation: (...a) => interpretation(...a),
    rung: (...a) => rung(...a),
    capture: vi.fn(),
    captureError: vi.fn(),
    audio: vi.fn(),
    audioError: vi.fn(),
  },
}));

const onComplete = vi.fn();
const onTranscribe = vi.fn();
const ENTRY = {
  seq: 7,
  rung: 'interpretation',
  done: false,
  text: { EN: 'It is cold today', KR: '오늘 추워요' },
  prompt: [{ role: 'target', language: 'KR' }],
  response: { role: 'source', modality: 'text', language: 'EN' },
};

const renderRung = () => render(
  <HangulTypingProvider>
    <TypedRung
      entry={ENTRY}
      audioUrl={(seq, lang) => `/audio/${seq}/${lang}`}
      onComplete={onComplete}
      onTranscribe={onTranscribe}
      saving={false}
      idleReplayMs={0}
      minSpeakMs={0}
    />
  </HangulTypingProvider>,
);
const field = () => screen.getByLabelText('Type what it means');
const type = async (text) => { await act(async () => { fireEvent.change(field(), { target: { value: text } }); }); };
const enter = async (el = field()) => { await act(async () => { fireEvent.keyDown(el, { key: 'Enter' }); }); };
const line = (name) => screen.getByTestId(`check-${name}`).textContent;
const lastCall = (detail) => interpretation.mock.calls.filter(([d]) => d === detail).at(-1)?.[1];

beforeEach(() => {
  onComplete.mockReset();
  interpretation.mockReset();
  onTranscribe.mockReset().mockResolvedValue({ ok: true, transcript: 'it is cold today', empty: false });
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  });
  window.MediaRecorder = class {
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
      this.onstop?.();
    }
  };
});

describe('interpretation — check your work', () => {
  it('a typed answer, right, is shown beside the answer before anything is saved', async () => {
    renderRung();
    await type('It is cold today');
    await enter();
    expect(screen.getByText('Check your work')).toBeTruthy();
    expect(line('given')).toBe('It is cold today');
    expect(line('answer')).toBe('It is cold today');
    expect(screen.getByText('You typed')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(lastCall('checked')).toMatchObject({ seq: 7, via: 'key:Enter', inputMode: 'typed' });
  });

  it('a typed answer, wrong, is shown just the same — and kept as the child wrote it', async () => {
    renderRung();
    await type('it was hot');
    await enter();
    expect(line('given')).toBe('it was hot');
    expect(line('answer')).toBe('It is cold today');
    // The field is gone: the answer on screen can never be typed back in as theirs.
    expect(screen.queryByLabelText('Type what it means')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onComplete).toHaveBeenCalledWith({
      seq: 7, rung: 'interpretation', given: 'it was hot', method: 'typed',
    });
  });

  it('lights up the parts that match', async () => {
    renderRung();
    await type('it is warm today');
    await enter();
    const marks = [...document.querySelectorAll('[data-testid="check-given"] mark')].map((m) => m.textContent);
    expect(marks.join('')).toContain('today');
    expect(marks.join('')).not.toContain('warm');
  });

  it('a spoken answer is checked the same way, and says so', async () => {
    renderRung();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Say the answer' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop speaking' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit' })); });
    expect(screen.getByText('You said')).toBeTruthy();
    expect(line('given')).toBe('it is cold today');
    expect(lastCall('checked')).toMatchObject({ seq: 7, via: 'touch', inputMode: 'voice' });
  });

  it('Space continues from the panel, and Tab plays the sentence again without continuing', async () => {
    renderRung();
    await type('it is cold');
    await enter();
    const plays = window.HTMLMediaElement.prototype.play.mock.calls.length;
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(window.HTMLMediaElement.prototype.play.mock.calls.length).toBeGreaterThan(plays);
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('an empty field checks nothing', async () => {
    renderRung();
    await enter();
    expect(screen.queryByText('Check your work')).toBeNull();
    expect(interpretation).not.toHaveBeenCalled();
  });

  it('Show the answer is the give-up: shown, logged as gave-up, never as checked', async () => {
    renderRung();
    await type('half an ans');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show answer' })); });
    expect(screen.queryByText('Check your work')).toBeNull();
    expect(screen.getByText(/Shown, not answered/)).toBeTruthy();
    expect(lastCall('gave-up')).toMatchObject({ seq: 7, via: 'touch' });
    expect(lastCall('checked')).toBeUndefined();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    expect(onComplete).toHaveBeenCalledWith({ seq: 7, rung: 'interpretation', revealed: true });
  });
});
