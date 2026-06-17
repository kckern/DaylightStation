import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, cleanup } from '@testing-library/react';

vi.mock('../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: (p) => `/${p}`,
}));

import ArtPlacards, { ArtPlacard } from '../../../frontend/src/screen-framework/widgets/ArtPlacards.jsx';
import { VIEW_MODES } from '../../../frontend/src/screen-framework/widgets/artModes.js';

const GALLERY = VIEW_MODES[0];
const FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
const measure = (s) => String(s).length * 8;            // deterministic test measurer
const base = {
  mode: GALLERY, frame: FRAME, matMargin: 4, cropMaxPerSide: 8,
  stage: { w: 1280, h: 720 }, fontPx: 16, measure, animate: true,
};
const artFor = (title, artist) => ({
  mode: 'single',
  panels: [{ image: `${title}.jpg`, meta: { title, artist, width: 1600, height: 1000 } }],
});

const textEl = (c) => c.querySelector('.artmode__plaque-text');
const titleText = (c) => Array.from(c.querySelectorAll('.artmode__placard-title')).map((e) => e.textContent).join(' ');
const isHidden = (c) => textEl(c).className.includes('artmode__plaque-text--hidden');

describe('ArtPlacards (crossfade nameplate)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('renders a placard with engraved title + artist for the current art', () => {
    const { container } = render(<ArtPlacards {...base} art={artFor('Sunflowers', 'Van Gogh')} />);
    expect(titleText(container)).toContain('Sunflowers');
    expect(container.querySelector('.artmode__placard-artist').textContent).toContain('Van Gogh');
    expect(isHidden(container)).toBe(false);             // first appearance: no fade
  });

  it('choreographs fade-out → swap → fade-in when the art changes', async () => {
    const { container, rerender } = render(<ArtPlacards {...base} art={artFor('A', 'Anon')} />);
    expect(titleText(container)).toContain('A');

    // New art: engraving fades out immediately, old text still mounted.
    rerender(<ArtPlacards {...base} art={artFor('B', 'Anon')} />);
    expect(isHidden(container)).toBe(true);
    expect(titleText(container)).toContain('A');

    // After the fade-out the label swaps (resize happens behind the still-hidden text).
    await act(async () => { vi.advanceTimersByTime(280); });
    expect(titleText(container)).toContain('B');
    expect(isHidden(container)).toBe(true);

    // After the resize the new engraving fades back in.
    await act(async () => { vi.advanceTimersByTime(420); });
    expect(isHidden(container)).toBe(false);
    expect(titleText(container)).toContain('B');
  });

  it('swaps instantly (no fade) when animate is false', () => {
    const { container, rerender } = render(<ArtPlacards {...base} animate={false} art={artFor('A', 'Anon')} />);
    rerender(<ArtPlacards {...base} animate={false} art={artFor('B', 'Anon')} />);
    expect(isHidden(container)).toBe(false);
    expect(titleText(container)).toContain('B');
  });

  it('renders nothing in bare (no-placard) view modes', () => {
    const bare = VIEW_MODES.find((m) => !m.placard) ?? { ...GALLERY, placard: false };
    const { container } = render(<ArtPlacards {...base} mode={bare} art={artFor('A', 'Anon')} />);
    expect(container.querySelector('.artmode__placard')).toBeNull();
  });

  it('does not crash on the width FLIP without layout (jsdom offsetWidth 0)', () => {
    // jsdom reports offsetWidth 0; the FLIP must bail and leave the plate intact.
    const content = { lines: ['Title'], artist: 'Anon', centerXPct: 50, widthPct: 40 };
    expect(() => render(<ArtPlacard content={content} testid="artmode-placard" />)).not.toThrow();
  });
});
