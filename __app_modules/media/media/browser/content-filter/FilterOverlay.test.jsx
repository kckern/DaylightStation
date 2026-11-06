import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FilterOverlay } from "./FilterOverlay.jsx";

const rect = { x: 0.4, y: 0.5, w: 0.2, h: 0.1 };

describe('FilterOverlay', () => {
  it('renders nothing when there is nothing active', () => {
    const { container } = render(<FilterOverlay activeOverlays={[]} activeCard={null} />);
    expect(container.querySelector('.filter-overlay')).toBeNull();
  });

  it('positions a censor-bar from the normalized rect and themes its color', () => {
    const { container } = render(
      <FilterOverlay activeOverlays={[{ effect: 'censor-bar', cue: { id: 'c', rect } }]} theme={{ barColor: '#123456' }} />
    );
    const el = container.querySelector('[data-filter-effect="censor-bar"]');
    expect(el).toBeTruthy();
    expect(el.style.left).toBe('40%');
    expect(el.style.top).toBe('50%');
    expect(el.style.width).toBe('20%');
    expect(el.style.height).toBe('10%');
    expect(el.style.backgroundColor).toBe('#123456');
  });

  it('renders a regional blur with a backdrop blur filter', () => {
    const { container } = render(
      <FilterOverlay activeOverlays={[{ effect: 'blur', cue: { id: 'b', rect } }]} />
    );
    const el = container.querySelector('[data-filter-effect="blur"]');
    expect(el.style.left).toBe('40%');
    expect(el.style.backdropFilter || el.style['backdrop-filter']).toContain('blur');
  });

  it('covers the whole frame for full-blur (no rect)', () => {
    const { container } = render(
      <FilterOverlay activeOverlays={[{ effect: 'full-blur', cue: { id: 'f' } }]} />
    );
    const el = container.querySelector('[data-filter-effect="full-blur"]');
    expect(el.style.inset).toBe('0');
  });

  it('renders a title-card overlay with its text', () => {
    const { getByText } = render(
      <FilterOverlay activeOverlays={[{ effect: 'title-card', cue: { id: 't', text: 'Content warning: violence' } }]} />
    );
    expect(getByText('Content warning: violence')).toBeTruthy();
  });

  it('renders an art-backed card (backdrop + logo) when art is provided', () => {
    const { container, getByText } = render(
      <FilterOverlay activeCard={{ text: 'Biff forces Lorraine into his car.' }} art={{ background: '/p/art', logo: '/p/logo' }} />
    );
    const card = container.querySelector('.filter-card-art');
    expect(card).toBeTruthy();
    expect(card.style.backgroundImage).toContain('/p/art');
    expect(container.querySelector('img').getAttribute('src')).toBe('/p/logo');
    expect(getByText('Biff forces Lorraine into his car.')).toBeTruthy();
  });

  it('falls back to poster-left layout when no logo is available', () => {
    const { container, getByText } = render(
      <FilterOverlay activeCard={{ text: 'Biff forces Lorraine into his car.' }} art={{ background: '/p/art', poster: '/p/poster' }} />
    );
    expect(container.querySelector('[data-card-layout="poster-left"]')).toBeTruthy();
    expect(container.querySelector('img').getAttribute('src')).toBe('/p/poster'); // poster, no logo
    expect(getByText('Biff forces Lorraine into his car.')).toBeTruthy();
  });

  it('renders the activeCard (skip plot explainer) text with the theme font', () => {
    const { getByText, container } = render(
      <FilterOverlay activeOverlays={[]} activeCard={{ text: 'Skipped a fight scene.' }} theme={{ font: 'Roboto Condensed' }} />
    );
    const card = getByText('Skipped a fight scene.');
    expect(card).toBeTruthy();
    expect(container.querySelector('.filter-card').style.fontFamily).toContain('Roboto Condensed');
  });
  it('renders the badge layer even when no effect is active', () => {
    const { container } = render(<FilterOverlay activeOverlays={[]} badge={{ state: 'certified', fireCount: 0 }} />);
    expect(container.querySelector('.filter-overlay')).toBeTruthy();
    expect(container.querySelector('[data-filter-badge="certified"]')).toBeTruthy();
  });

  it('renders the bumper when given one', () => {
    const { getByText } = render(<FilterOverlay bumper={{ summary: '1 word muted' }} />);
    expect(getByText('Edited for content')).toBeTruthy();
  });

  it('the bumper yields to a skip-card; the badge stays', () => {
    const { container, queryByText } = render(
      <FilterOverlay activeCard={{ text: 'Skipping ahead' }} bumper={{ summary: '' }} badge={{ state: 'provisional', fireCount: 0 }} />
    );
    expect(queryByText('Edited for content')).toBeNull();
    expect(queryByText('Skipping ahead')).toBeTruthy();
    expect(container.querySelector('[data-filter-badge="provisional"]')).toBeTruthy();
  });
});

describe('FilterOverlay blackout', () => {
  it('covers the frame in opaque black with the card text, then fades the text', async () => {
    const { vi } = await import('vitest');
    const { act } = await import('@testing-library/react');
    vi.useFakeTimers();
    try {
      const cue = { id: 'sc-va1#0', text: 'He gets away.', cardSec: 4.5, firstPiece: true };
      const { container } = render(<FilterOverlay activeOverlays={[{ effect: 'blackout', cue }]} />);
      const el = container.querySelector('[data-filter-effect="blackout"]');
      expect(el.style.backgroundColor).toMatch(/^(#000|rgb\(0, 0, 0\))$/);
      const text = container.querySelector('[data-blackout-text]');
      expect(text.textContent).toBe('He gets away.');
      expect(text.style.opacity).toBe('0.9');
      act(() => { vi.advanceTimersByTime(4600); });
      expect(container.querySelector('[data-blackout-text]').style.opacity).toBe('0');
    } finally { vi.useRealTimers(); }
  });

  it('shows no text on a later piece of the same scene', () => {
    const cue = { id: 'sc-va1#1', text: 'Scene hidden.', firstPiece: false };
    const { container } = render(<FilterOverlay activeOverlays={[{ effect: 'blackout', cue }]} />);
    expect(container.querySelector('[data-blackout-text]')).toBeNull();
  });
});
