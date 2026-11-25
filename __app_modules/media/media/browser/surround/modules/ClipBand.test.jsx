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
    title: 'Second Carol',
    work: 'plex:1001',
    index: 3,
    total: 40,
    next: { title: 'Snow Song', subtitle: 'Snow Concert (2011)', work: 'plex:2002', workTitle: 'Snow Concert', workYear: 2011 },
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
  it('renders the three zones: now, progress, up next', () => {
    const { container } = render(<ClipBand data={makeData()} position={500} />);
    expect(container.querySelector('.clip-band__now')).not.toBeNull();
    expect(container.querySelector('.clip-band__progress')).not.toBeNull();
    expect(container.querySelector('.clip-band__next')).not.toBeNull();
  });

  it('headlines the piece now playing (the clip\'s own name), not the concert', () => {
    const { container, queryByText } = render(<ClipBand data={makeData()} position={500} />);
    expect(container.querySelector('.clip-band__title').textContent).toBe('Second Carol');
    // The placard and the poster rail carry the concert; the band does not repeat it.
    expect(queryByText('A Winter Concert')).toBeNull();
    expect(queryByText(/^No\./)).toBeNull();
  });

  it('marks this piece in a compact grid of the concert\'s pieces', () => {
    const { container } = render(<ClipBand data={makeData()} position={500} />);
    const cells = [...container.querySelectorAll('.clip-band__cell')];
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.classList.contains('clip-band__cell--now'))).toEqual([false, true, false, false]);
    expect(container.querySelector('.clip-band__grid').getAttribute('aria-label')).toBe('Piece 2 of 4');
  });

  it('partitions up next when the next clip is from another concert, with its poster', () => {
    const { container } = render(<ClipBand data={makeData()} position={500} />);
    const next = container.querySelector('.clip-band__next');
    expect(next.classList.contains('clip-band__next--elsewhere')).toBe(true);
    expect(next.querySelector('.clip-band__next-label').textContent).toBe('Next, from');
    expect(next.querySelector('.clip-band__next-work').textContent).toBe('Snow Concert (2011)');
    expect(next.querySelector('.clip-band__next-title').textContent).toBe('Snow Song');
    expect(next.querySelector('img.clip-band__next-poster').getAttribute('src')).toBe('/api/v1/display/plex:2002');
  });

  it('keeps up next simple when the next clip is from the same concert', () => {
    const data = makeData({ next: { title: 'Last Carol', subtitle: 'A Winter Concert (2008)', work: 'plex:1001', workTitle: 'A Winter Concert', workYear: 2008 } });
    const { container } = render(<ClipBand data={data} position={500} />);
    const next = container.querySelector('.clip-band__next');
    expect(next.classList.contains('clip-band__next--elsewhere')).toBe(false);
    expect(next.querySelector('.clip-band__next-label').textContent).toBe('Up next');
    expect(next.querySelector('.clip-band__next-title').textContent).toBe('Last Carol');
    expect(next.querySelector('img')).toBeNull();
    expect(next.querySelector('.clip-band__next-work')).toBeNull();
  });

  it('falls back to the queue subtitle for the other concert\'s name', () => {
    const data = makeData({ next: { title: 'Snow Song', subtitle: 'Snow Concert (2011)', work: 'plex:2002', workTitle: null, workYear: null } });
    const { container } = render(<ClipBand data={data} position={500} />);
    expect(container.querySelector('.clip-band__next-work').textContent).toBe('Snow Concert (2011)');
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

  it('omits the piece grid when the payload has no rail', () => {
    const { container } = render(<ClipBand data={{ ...makeData(), segments: [] }} position={500} />);
    expect(container.querySelector('.clip-band__grid')).toBeNull();
    expect(container.querySelector('.clip-band__title').textContent).toBe('Second Carol');
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
