import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useMediaKeyboardHandler } from './useMediaKeyboardHandler.js';

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
    press('ArrowDown'); press('ArrowDown'); press('ArrowRight'); press('Enter');
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
});
