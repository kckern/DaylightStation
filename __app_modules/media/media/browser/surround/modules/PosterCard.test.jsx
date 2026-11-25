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
  composer: { name: 'The Choir', logo: 'choir/logo.svg' },
  assetBase: 'library/christmas',
};

afterEach(() => { vi.useRealTimers(); });

describe('PosterCard', () => {
  it('shows the poster for the item playing', () => {
    const { container } = render(<PosterCard data={DATA} />);
    expect(container.querySelector('img.poster-card__poster').getAttribute('src')).toBe('/api/v1/display/plex:1001');
  });

  it('leaves title, year and performers to the poster and the placard', () => {
    const { queryByText } = render(<PosterCard data={DATA} />);
    expect(queryByText('A Winter Concert')).toBeNull();
    expect(queryByText('2008')).toBeNull();
    expect(queryByText('Guest Singer · Guest Narrator, narrator')).toBeNull();
  });

  it('shows the ensemble\'s logo from the payload\'s asset tree', () => {
    const { container } = render(<PosterCard data={DATA} />);
    const logo = container.querySelector('img.poster-card__logo');
    expect(logo.getAttribute('src')).toMatch(/\/api\/v1\/static\/img\/library\/christmas\/choir\/logo\.svg$/);
    expect(logo.getAttribute('alt')).toBe('The Choir');
  });

  it('has no logo slot when the payload names none', () => {
    const { container } = render(<PosterCard data={{ ...DATA, composer: { name: 'X' } }} />);
    expect(container.querySelector('.poster-card__logo')).toBeNull();
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
    fireEvent.error(container.querySelector('img.poster-card__poster'));
    expect(container.querySelector('img.poster-card__poster')).toBeNull();
    getByText('First fact.');
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
