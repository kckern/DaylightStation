import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render } from '@testing-library/react';
import { useMediaKeyboardHandler } from './useMediaKeyboardHandler.js';
import { SURROUND_NAV_STATE_EVENT } from '../../modules/Surround/navMode.js';

function Harness(props) { useMediaKeyboardHandler(props); return null; }

const NAV_SURROUND = {
  id: 'playhouse-rail',
  segments: [],
  definition: { regions: { right: [{ module: 'segment-map', orientation: 'column', groups: 'header' }] } },
};
const PLAIN_SURROUND = {
  id: 'concert-hall',
  segments: [],
  definition: { regions: { right: [{ module: 'composer-card' }] } },
};

const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

// Stands in for the rail's own reply (`SegmentMap.jsx`'s `onNav` listener),
// which is what actually flips `navActive` in the running app. These specs
// exercise the Player's HALF of that contract in isolation, so they raise the
// reply by hand rather than mounting the rail.
const railReplies = (active) => act(() => {
  document.dispatchEvent(new CustomEvent(SURROUND_NAV_STATE_EVENT, { detail: { active } }));
});

describe('useMediaKeyboardHandler — nav mode', () => {
  let events;
  const record = (e) => events.push(e.detail.action);
  beforeEach(() => { events = []; document.addEventListener('surround-nav', record); });
  afterEach(() => { document.removeEventListener('surround-nav', record); });

  const base = { mediaRef: { current: null }, getMediaEl: () => null, queuePosition: 0 };

  it('ArrowDown enters nav mode on a work whose surround declares a nav rail', () => {
    render(<Harness {...base} meta={{ surround: NAV_SURROUND }} />);
    press('ArrowDown');
    expect(events).toEqual(['enter']);
  });

  it('subsequent keys advance the selection, and OK selects', () => {
    render(<Harness {...base} meta={{ surround: NAV_SURROUND }} />);
    press('ArrowDown');
    expect(events).toEqual(['enter']);
    // The rail's reply to `enter`: nav mode is now active. Only once the
    // Player has been TOLD does it hand the other three keys to the rail —
    // this is Critical 1, guarded directly by the assertions below.
    railReplies(true);
    press('ArrowDown'); press('ArrowRight'); press('Enter');
    expect(events).toEqual(['enter', 'down', 'right', 'select']);
  });

  it('does NOT intercept on a work with no nav rail — shaders keep ArrowDown', () => {
    render(<Harness {...base} meta={{ surround: PLAIN_SURROUND }} />);
    press('ArrowDown');
    expect(events).toEqual([]);
  });

  it('does NOT intercept when there is no surround at all', () => {
    render(<Harness {...base} meta={{}} />);
    press('ArrowDown');
    expect(events).toEqual([]);
  });

  // Critical 1: borrowed keys must be ABSENT — not merely no-ops — while nav
  // mode is idle, so they fall through to their ordinary bindings. A work with
  // a nav rail sits on screen for its ENTIRE runtime; if `Enter` is bound to a
  // no-op handler whenever nav mode is idle (the resting state), play/pause is
  // dead for the whole film, not just briefly.
  it('a normal key reaches its ordinary handler while nav mode is idle, not the rail', () => {
    const toggle = vi.fn();
    render(<Harness {...base} meta={{ surround: NAV_SURROUND }} controller={{ toggle }} />);
    press('Enter');
    expect(events).toEqual([]);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  // Critical 2: the rail's `up`-past-the-top exit has to reach the Player, or
  // the Player is left holding four keys the viewer can no longer use — and
  // the very next `ArrowDown` must re-ENTER, not send a stale `down` into a
  // reducer that already returned to null.
  it('after the rail reports an exit, the next ArrowDown re-enters rather than advancing', () => {
    render(<Harness {...base} meta={{ surround: NAV_SURROUND }} />);
    press('ArrowDown');
    expect(events).toEqual(['enter']);
    railReplies(true);
    // Simulates `up` walking off the first row: the rail's reducer returns
    // null and reports the exit on the same event the Player listens for.
    railReplies(false);
    press('ArrowDown');
    expect(events).toEqual(['enter', 'enter']);
  });
});
