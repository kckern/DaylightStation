import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as sass from 'sass';
import { existsSync } from 'node:fs';
import path from 'node:path';

vi.mock('./DispatchTargetPicker.jsx', () => ({
  DispatchTargetPicker: () => <div data-testid="picker-stub">Picker</div>,
}));

import { CastButton } from './CastButton.jsx';

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

function setViewport({ width = 1280, height = 900 }) {
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: width },
    innerHeight: { configurable: true, value: height },
  });
}

function openCastPopover(rect) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  render(<CastButton contentId="plex:arrival" title="Arrival" />);
  fireEvent.click(screen.getByTestId('cast-button-plex:arrival'));
  return screen.getByTestId('cast-button-popover-plex:arrival');
}

afterEach(() => {
  vi.restoreAllMocks();
  setViewport({ width: originalInnerWidth, height: originalInnerHeight });
});

describe('CastButton viewport-bounded picker', () => {
  it('caps a below-trigger picker to the remaining viewport height', () => {
    setViewport({ height: 900 });
    const popover = openCastPopover({ top: 570, bottom: 600, right: 1200 });

    expect(popover.style.top).toBe('606px');
    expect(popover.style.bottom).toBe('');
    expect(popover.style.getPropertyValue('--cast-picker-max-height')).toBe('286px');
  });

  it('opens upward near the viewport bottom, retaining a bounded picker', () => {
    setViewport({ height: 900 });
    const popover = openCastPopover({ top: 850, bottom: 880, right: 1200 });

    expect(popover.style.top).toBe('');
    expect(popover.style.bottom).toBe('56px');
    expect(popover.style.getPropertyValue('--cast-picker-max-height')).toBe('836px');
  });

  it('scrolls the whole bounded portal so fixed controls cannot collapse the device list', () => {
    // Both supported test roots stub CSS imports. Read the real stylesheet
    // through Sass from either repository root or frontend project root.
    const candidates = ['frontend/src/modules/Media/cast/Cast.scss', 'src/modules/Media/cast/Cast.scss']
      .map((relative) => path.resolve(relative));
    const stylesheet = candidates.find((candidate) => existsSync(candidate));
    expect(stylesheet, 'real Cast.scss must exist under the supported test root').toBeTruthy();
    const css = sass.compile(stylesheet).css.replace(/\s+/g, ' ');

    expect(css).toMatch(/\.cast-button-popover-portal \.cast-picker \{[^}]*box-sizing: border-box;[^}]*max-height: var\(--cast-picker-max-height\);[^}]*overflow-y: auto/);
    expect(css).not.toMatch(/\.cast-button-popover-portal \.cast-picker-devices \{[^}]*min-height: 0/);
    expect(css).not.toMatch(/\.handoff-section \.cast-picker \{[^}]*max-height: var\(--cast-picker-max-height\)/);
  });
});
