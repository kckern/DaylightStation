// frontend/src/modules/Player/hooks/segmentTransport.test.jsx
//
// The seam, end to end: a raw `keydown` on `window` — which is what EVERY input
// route (keyboard, office numpad, Shield remote, gamepad, WebSocket) finally
// becomes — moves the playhead inside a segmented piece instead of moving the
// queue. The pure decision is proved exhaustively in
// modules/Surround/segmentNav.test.js; this proves it is actually WIRED, and
// that the media element is seeked rather than replaced.

import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMediaKeyboardHandler } from '../../../lib/Player/useMediaKeyboardHandler.js';
import { __resetPlayerKeyboardOwnership } from '../../../lib/Player/playerKeyboardOwnership.js';

// The live Eroica payload (GET /api/v1/play/plex:663134): one media item, four
// segments, 21.35s of applause before the first note.
const EROICA_SEGMENTS = [
  { n: 1, contentId: 'plex:663134', part: 0, start: 21.35, end: 976, offset: 0, duration: 954.65 },
  { n: 2, contentId: 'plex:663134', part: 0, start: 976, end: 1925, offset: 954.65, duration: 949 },
  { n: 3, contentId: 'plex:663134', part: 0, start: 1925, end: 2278, offset: 1903.65, duration: 353 },
  { n: 4, contentId: 'plex:663134', part: 0, start: 2278, end: 2955, offset: 2256.65, duration: 677 },
];

const eroicaMeta = () => ({
  id: 'plex:663134',
  assetId: 'plex:663134',
  plex: '663134',
  title: 'Beethoven: 3. Sinfonie (»Eroica«)',
  surround: { id: 'beethoven-symphony-3', segments: EROICA_SEGMENTS },
});

function Harness({ config }) {
  useMediaKeyboardHandler(config);
  return null;
}

function setup({ meta, position }) {
  const el = { currentTime: position, duration: 3223, paused: false };
  const onEnd = vi.fn();
  const setCurrentTime = vi.fn();
  render(
    <Harness
      config={{
        getMediaEl: () => el,
        onEnd,
        setCurrentTime,
        meta,
        type: null,
        assetId: null,
        isVideo: false,
      }}
    />
  );
  const press = (key) => act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  return { el, onEnd, setCurrentTime, press };
}

describe('segment transport through a real keydown', () => {
  beforeEach(() => __resetPlayerKeyboardOwnership());

  it('next during the first movement seeks to the second — it does NOT end the symphony', () => {
    // 20:09:59, the press that started this. One-item queue: an advance here
    // ended the piece and the screen restarted it ten seconds later.
    const { el, onEnd, setCurrentTime, press } = setup({ meta: eroicaMeta(), position: 500 });
    press('Tab');
    expect(el.currentTime).toBe(976);
    expect(setCurrentTime).toHaveBeenCalledWith(976);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('next during the opening applause skips to the first movement', () => {
    const { el, onEnd, press } = setup({ meta: eroicaMeta(), position: 4 });
    press('Tab');
    expect(el.currentTime).toBe(21.35);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('next in the LAST movement still advances the queue', () => {
    const { el, onEnd, press } = setup({ meta: eroicaMeta(), position: 2900 });
    press('Tab');
    expect(el.currentTime).toBe(2900);
    expect(onEnd).toHaveBeenCalledWith(1);
  });

  it('previous well into a movement restarts that movement', () => {
    const { el, onEnd, press } = setup({ meta: eroicaMeta(), position: 1000 });
    press('Backspace');
    expect(el.currentTime).toBe(976);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('previous just inside a movement steps back to the one before', () => {
    const { el, onEnd, press } = setup({ meta: eroicaMeta(), position: 979 });
    press('Backspace');
    expect(el.currentTime).toBe(21.35);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('previous in the opening applause still walks the queue backwards', () => {
    const { el, onEnd, press } = setup({ meta: eroicaMeta(), position: 10 });
    press('Backspace');
    expect(el.currentTime).toBe(10);
    expect(onEnd).toHaveBeenCalledWith(-1);
  });

  describe('an item with no segments behaves exactly as today', () => {
    const plainMeta = { id: 'plex:1', assetId: 'plex:1', title: 'Something un-enriched' };

    it('next advances the queue', () => {
      const { onEnd, press } = setup({ meta: plainMeta, position: 500 });
      press('Tab');
      expect(onEnd).toHaveBeenCalledWith(1);
    });

    it('previous restarts the file when more than five seconds in', () => {
      const { el, onEnd, press } = setup({ meta: plainMeta, position: 27 });
      press('Backspace');
      expect(el.currentTime).toBe(0);
      expect(onEnd).not.toHaveBeenCalled();
    });

    it('previous walks the queue backwards inside the first five seconds', () => {
      const { el, onEnd, press } = setup({ meta: plainMeta, position: 3 });
      press('Backspace');
      expect(el.currentTime).toBe(3);
      expect(onEnd).toHaveBeenCalledWith(-1);
    });

    it('a null meta does not throw and still advances', () => {
      const { onEnd, press } = setup({ meta: null, position: 500 });
      press('Tab');
      expect(onEnd).toHaveBeenCalledWith(1);
    });
  });
});
