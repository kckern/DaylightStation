// ContentScroller manual scroll nudge (jsdom).
//
// HONESTY NOTE: jsdom has no layout engine — every offsetHeight is 0, so the
// step measured from a rendered line falls back to the 32px default and that is
// what these assertions pin. The arithmetic and the key routing are real; that
// the text visibly moves on screen is proven in a browser, not here.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, act } from '@testing-library/react';
import ContentScroller from './ContentScroller.jsx';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve({})) }));

beforeAll(() => {
  // jsdom media elements implement neither play nor pause.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true, writable: true, value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true, writable: true, value: vi.fn(),
  });
});

const renderScroller = (props = {}) => render(
  <ContentScroller
    type="singalong"
    title="Hymn 1"
    assetId="singalong:hymn/1"
    mainMediaUrl="/media/hymn1.mp3"
    contentData={{ data: [['Line one', 'Line two']] }}
    parseContent={() => (
      <div className="singalong-text">
        <div className="stanza"><p className="line">Line one</p><p className="line">Line two</p></div>
      </div>
    )}
    {...props}
  />
);

const press = (key) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});

const transformOf = (container) => container.querySelector('.scrolled-content').style.transform;

// jsdom reports 0 for every box, so the time-derived offset is pinned at 0 and the
// nudge is the only thing that can move the transform — exactly what we want to
// isolate. jsdom media also never leaves `paused`, so these presses double as
// proof that a caller's arrow override survives the paused branch in
// useMediaKeyboardHandler, which otherwise no-ops both arrows for the pause overlay.
describe('ContentScroller manual scroll nudge', () => {
  it('moves the text by one line per press without touching the audio clock', () => {
    const { container } = renderScroller({ manualScrollNudge: true });
    const audio = container.querySelector('audio');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 120 });
    audio.currentTime = 42;

    expect(transformOf(container)).toBe('translateY(-0px)');

    press('ArrowUp');
    expect(transformOf(container)).toBe('translateY(-32px)');

    press('ArrowUp');
    expect(transformOf(container)).toBe('translateY(-64px)');

    press('ArrowDown');
    expect(transformOf(container)).toBe('translateY(-32px)');

    // The whole point: the text moved, the media did not.
    expect(audio.currentTime).toBe(42);
  });

  it('never pushes the text above the top, and does not bank dead presses there', () => {
    const { container } = renderScroller({ manualScrollNudge: true });

    press('ArrowDown');
    press('ArrowDown');
    expect(transformOf(container)).toBe('translateY(-0px)');

    // The two presses that could not move the text must not have accumulated:
    // one press back the other way responds immediately.
    press('ArrowUp');
    expect(transformOf(container)).toBe('translateY(-32px)');
  });

  it('leaves the arrows on shader cycling when the renderer did not opt in', () => {
    const { container } = renderScroller();
    const audio = container.querySelector('audio');
    const scroller = container.querySelector('.content-scroller');
    expect(scroller.className).toContain('regular');

    // Shader cycling is the PLAYING binding — while paused the arrows belong to
    // the pause overlay — so report playback before pressing.
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    act(() => { audio.dispatchEvent(new Event('play')); });

    press('ArrowUp');

    expect(transformOf(container)).toBe('translateY(-0px)');
    expect(scroller.className).not.toContain('regular');
    expect(scroller.className).toContain('minimal');
  });
});
