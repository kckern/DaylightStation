// WorkPlacard.correction.test.jsx — the painted-line check leaves a REFUSED
// line alone.
//
// The check steps a fitted size down by FONT_STEP_PX when the painted name
// reads a pixel or two wider than the fit measured (span joins). A line the fit
// refused (no size sets it whole, no short_title to stand in) comes back at the
// ceiling and stays ellipsized at every size, so stepping it walked 0.25px per
// re-render from 32.8px to the 24px floor — some 35 synchronous renders, again
// on every layout tick — for a line that was cut either way.
//
// Its own file because it mocks the fit: jsdom has no layout, so the refusal
// and the overflowing name are both stated rather than measured.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const REFUSED = Object.freeze({
  fontPx: 32.8,
  floorPx: 24,
  availPx: 300,
  rejected: [{ text: 'Christmas with Audra McDonald and Peter Graves · 2004', chars: 52, budget: 30, overflowPx: 140 }],
});

vi.mock('../../../../../../__capabilities/playback/browser/surround-fit.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fitPlate: vi.fn(() => ({ ...REFUSED, rejected: [...REFUSED.rejected] })) };
});

// eslint-disable-next-line import/first
import WorkPlacard from './WorkPlacard.jsx';

describe('WorkPlacard — the painted-line check', () => {
  const saved = {};
  beforeEach(() => {
    // Every element reads as overflowing: the name is "cut" as painted.
    for (const key of ['clientWidth', 'scrollWidth']) {
      saved[key] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    }
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 440 });
  });
  afterEach(() => {
    for (const [key, desc] of Object.entries(saved)) {
      if (desc) Object.defineProperty(HTMLElement.prototype, key, desc);
      else delete HTMLElement.prototype[key];
    }
  });

  it('does not step a refused line down toward the floor', () => {
    const { getByTestId } = render(
      <WorkPlacard data={{ piece: { title: 'Christmas with Audra McDonald and Peter Graves', year: 2004 } }} />,
    );
    const plate = getByTestId('surround-work-placard');
    expect(plate.style.getPropertyValue('--plate-size')).toBe(`${REFUSED.fontPx}px`);
  });
});
