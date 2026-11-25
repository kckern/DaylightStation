// __app_modules/media/media/browser/surround/modules/ClipBand.test.jsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ClipBand, { formatClock, clipNumber } from './ClipBand.jsx';
import { SURROUND_BUILTIN_MODULES } from '../builtins.js';
import { getSurroundRegistry } from '../../../../../../__capabilities/playback/browser/surround-registry.mjs';

const SEGMENTS = [
  { n: 1, name: 'Opening Carol', kind: 'song', start: 30, end: 330 },
  { n: 2, name: 'Introduction', kind: 'introduction', start: 360, end: 420 },
  { n: 3, name: 'Second Carol', kind: 'song', start: 425, end: 700 },
  { n: 4, name: 'Reading', kind: 'narration', start: 710, end: 900 },
  { n: 5, name: 'Last Carol', kind: 'song', start: 905, end: 1200 },
];

const makeData = (clip = {}) => ({
  contentId: 'plex:1001',
  piece: { title: 'A Winter Concert', year: 2008 },
  segments: SEGMENTS,
  clip: {
    segment: { start: 425, end: 700 },
    index: 3,
    total: 40,
    next: { title: 'Snow Song', subtitle: 'Snow Concert (2011)' },
    ...clip,
  },
});

describe('formatClock', () => {
  it('formats seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(3601)).toBe('60:01');
    expect(formatClock(NaN)).toBe('0:00');
  });
});

describe('clipNumber', () => {
  it('numbers the clip among the concert\'s pieces, skipping introductions', () => {
    expect(clipNumber(SEGMENTS, 425)).toEqual({ k: 2, n: 4 });
    expect(clipNumber(SEGMENTS, 30)).toEqual({ k: 1, n: 4 });
  });

  it('picks the piece whose start is nearest the clip start', () => {
    expect(clipNumber(SEGMENTS, 428)).toEqual({ k: 2, n: 4 });
    expect(clipNumber(SEGMENTS, 899)).toEqual({ k: 4, n: 4 });
  });

  it('is null without a rail', () => {
    expect(clipNumber([], 10)).toBeNull();
    expect(clipNumber(undefined, 10)).toBeNull();
  });
});

describe('ClipBand', () => {
  it('renders the three zones: from, progress, up next', () => {
    const { container, getByText } = render(<ClipBand data={makeData()} position={500} />);
    expect(container.querySelector('.clip-band__from')).not.toBeNull();
    expect(container.querySelector('.clip-band__progress')).not.toBeNull();
    expect(container.querySelector('.clip-band__next')).not.toBeNull();
    getByText('A Winter Concert');
    getByText('2008');
    getByText('No. 2 of 4');
    getByText('Snow Song');
    getByText('Snow Concert (2011)');
  });

  it('draws one tick per piece with the playing one lit', () => {
    const { container } = render(<ClipBand data={makeData()} position={500} />);
    const ticks = [...container.querySelectorAll('.clip-band__tick')];
    expect(ticks).toHaveLength(4);
    expect(ticks.map((t) => t.classList.contains('clip-band__tick--lit'))).toEqual([false, true, false, false]);
  });

  it('shows elapsed and remaining within the clip only', () => {
    const { container } = render(<ClipBand data={makeData()} position={500} />);
    expect(container.querySelector('.clip-band__elapsed').textContent).toBe('1:15');
    expect(container.querySelector('.clip-band__remaining').textContent).toBe('-3:20');
    const fill = container.querySelector('.clip-band__fill');
    expect(fill.style.width).toBe(`${(75 / 275) * 100}%`);
  });

  it('clamps progress before the window opens', () => {
    const { container } = render(<ClipBand data={makeData()} position={100} />);
    expect(container.querySelector('.clip-band__elapsed').textContent).toBe('0:00');
    expect(container.querySelector('.clip-band__remaining').textContent).toBe('-4:35');
    expect(container.querySelector('.clip-band__fill').style.width).toBe('0%');
  });

  it('clamps progress after the window closes', () => {
    const { container } = render(<ClipBand data={makeData()} position={900} />);
    expect(container.querySelector('.clip-band__elapsed').textContent).toBe('4:35');
    expect(container.querySelector('.clip-band__remaining').textContent).toBe('-0:00');
    expect(container.querySelector('.clip-band__fill').style.width).toBe('100%');
  });

  it('hides up next at the end of the queue', () => {
    const { container } = render(<ClipBand data={makeData({ next: null })} position={500} />);
    expect(container.querySelector('.clip-band__next')).toBeNull();
    expect(container.querySelector('.clip-band__progress')).not.toBeNull();
  });

  it('omits the piece number when the payload has no rail', () => {
    const { container, queryByText } = render(<ClipBand data={{ ...makeData(), segments: [] }} position={500} />);
    expect(queryByText(/^No\./)).toBeNull();
    expect(container.querySelector('.clip-band__ticks')).toBeNull();
  });

  it('renders nothing without a clip', () => {
    const { container } = render(<ClipBand data={{ ...makeData(), clip: undefined }} position={500} />);
    expect(container.firstChild).toBeNull();
    const none = render(<ClipBand data={null} position={0} />);
    expect(none.container.firstChild).toBeNull();
  });

  it('is registered under clip-band, for the bottom region', () => {
    expect(SURROUND_BUILTIN_MODULES).toContain('clip-band');
    expect(getSurroundRegistry().has('clip-band')).toBe(true);
    expect(getSurroundRegistry().getMeta('clip-band').regions).toEqual(['bottom']);
  });
});
