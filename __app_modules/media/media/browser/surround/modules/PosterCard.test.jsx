// __app_modules/media/media/browser/surround/modules/PosterCard.test.jsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import PosterCard, { POSTER_FACT_INTERVAL_MS } from './PosterCard.jsx';
import { SURROUND_BUILTIN_MODULES } from '../builtins.js';
import { getSurroundRegistry } from '../../../../../../__capabilities/playback/browser/surround-registry.mjs';

const DATA = {
  contentId: 'plex:1001',
  piece: { title: 'A Winter Concert', year: 2008, performance: 'Guest Singer · Guest Narrator, narrator' },
  facts: ['First fact.', 'Second fact.'],
};

afterEach(() => { vi.useRealTimers(); });

describe('PosterCard', () => {
  it('shows the poster for the item playing', () => {
    const { container } = render(<PosterCard data={DATA} />);
    expect(container.querySelector('img').getAttribute('src')).toBe('/api/v1/display/plex:1001');
  });

  it('shows title, year and the performance line', () => {
    const { getByText } = render(<PosterCard data={DATA} />);
    getByText('A Winter Concert');
    getByText('2008');
    getByText('Guest Singer · Guest Narrator, narrator');
  });

  it('rotates facts on an interval', () => {
    vi.useFakeTimers();
    const { getByText, queryByText } = render(<PosterCard data={DATA} />);
    getByText('First fact.');
    act(() => { vi.advanceTimersByTime(POSTER_FACT_INTERVAL_MS); });
    getByText('Second fact.');
    expect(queryByText('First fact.')).toBeNull();
  });

  it('hides a poster that fails to load and keeps the text', () => {
    const { container, getByText } = render(<PosterCard data={DATA} />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    getByText('A Winter Concert');
  });

  it('renders nothing without data', () => {
    const { container } = render(<PosterCard data={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('is registered under poster-card, for the right rail', () => {
    expect(SURROUND_BUILTIN_MODULES).toContain('poster-card');
    expect(getSurroundRegistry().has('poster-card')).toBe(true);
    expect(getSurroundRegistry().getMeta('poster-card').regions).toContain('right');
  });
});
