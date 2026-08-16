// previewFrame.test.js — the arithmetic that makes the admin preview honest.
//
// The Player is sized entirely in rem against an unmodified 16px root, so
// apparent type size is a pure function of how many CSS px wide its box is.
// The preview therefore has to lay out at the target screen's EXACT resolution
// and zoom that box down to fit, rather than pick a convenient 1920x1080.
import { describe, it, expect } from 'vitest';
import { PREVIEW_WIDTH, previewFrameVars } from './previewFrame.js';

describe('previewFrameVars', () => {
  it('lays out at the screen resolution and zooms to the preview width', () => {
    expect(previewFrameVars({ width: 1280, height: 720 })).toEqual({
      '--preview-width': '960px',
      '--preview-screen-width': '1280px',
      '--preview-screen-height': '720px',
      '--preview-scale': '0.75',
      '--preview-box-height': '540px',
    });
  });

  it('renders a screen already at the preview width 1:1 — no zoom at all', () => {
    const vars = previewFrameVars({ width: 960, height: 540 });
    expect(vars['--preview-scale']).toBe('1');
    expect(vars['--preview-screen-width']).toBe('960px');
    expect(vars['--preview-box-height']).toBe('540px');
  });

  it('keeps a non-16:9 screen at its own aspect instead of forcing 16:9', () => {
    // portal is 1280x800 (16:10). A forced 540px-tall box would crop or letterbox.
    expect(previewFrameVars({ width: 1280, height: 800 })['--preview-box-height']).toBe('600px');
  });

  it('returns null for a screen with no usable resolution', () => {
    expect(previewFrameVars(null)).toBeNull();
    expect(previewFrameVars({})).toBeNull();
    expect(previewFrameVars({ width: 0, height: 540 })).toBeNull();
    expect(previewFrameVars({ width: '1280', height: 'wide' })).toBeNull();
  });

  it('exports the preview surface width the SCSS is written against', () => {
    expect(PREVIEW_WIDTH).toBe(960);
  });
});
