import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as sass from 'sass';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock("./DispatchTargetPicker.jsx", () => ({
  DispatchTargetPicker: ({ source }) => <div data-testid="picker-stub" data-source={JSON.stringify(source)}>Picker</div>,
}));

import { CastButton } from "./CastButton.jsx";

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
  it('carries the same leaf Play action to the one-shot destination', () => {
    openCastPopover({ top: 570, bottom: 600, right: 1200 });
    expect(JSON.parse(screen.getByTestId('picker-stub').dataset.source)).toMatchObject({
      itemAction: { kind: 'playNow', item: { contentId: 'plex:arrival' }, clearRest: false },
    });
  });
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
    // The test roots stub CSS imports, so read the real stylesheet through Sass.
    // It sits beside this test (the Media app moved into __app_modules).
    const stylesheet = fileURLToPath(new URL('./Cast.scss', import.meta.url));
    expect(existsSync(stylesheet), 'real Cast.scss must exist beside this test').toBe(true);
    const css = sass.compile(stylesheet).css.replace(/\s+/g, ' ');

    expect(css).toMatch(/\.cast-button-popover-portal \.cast-picker \{[^}]*box-sizing: border-box;[^}]*max-height: var\(--cast-picker-max-height\);[^}]*overflow-y: auto/);
    expect(css).not.toMatch(/\.cast-button-popover-portal \.cast-picker-devices \{[^}]*min-height: 0/);
    expect(css).not.toMatch(/\.handoff-section \.cast-picker \{[^}]*max-height: var\(--cast-picker-max-height\)/);
  });
});
