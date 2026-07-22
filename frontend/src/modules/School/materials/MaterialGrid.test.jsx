import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MaterialGrid from './MaterialGrid.jsx';

const withPoster = { id: 'plex:1', title: 'Bill Nye', poster: '/api/v1/display/plex/1', unitCount: 12, durationMs: 45 * 60000 };
const noPoster = { id: 'plex:2', title: 'Cosmos', poster: null, unitCount: null, durationMs: null };

describe('MaterialGrid', () => {
  it('renders a poster <img> with the poster path used verbatim as src', () => {
    render(<MaterialGrid materials={[withPoster]} onSelect={() => {}} />);
    const img = screen.getByRole('img', { name: 'Bill Nye' });
    expect(img).toHaveAttribute('src', '/api/v1/display/plex/1');
  });

  it('renders a text placeholder instead of an <img> when poster is null', () => {
    render(<MaterialGrid materials={[noPoster]} onSelect={() => {}} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getAllByText('Cosmos').length).toBeGreaterThan(0);
  });

  it('renders "N parts · ~M min" meta, null-safely omitting missing pieces', () => {
    render(<MaterialGrid materials={[withPoster, noPoster]} onSelect={() => {}} />);
    expect(screen.getByText('12 parts · ~45 min')).toBeInTheDocument();
    // noPoster has neither unitCount nor durationMs -> no meta line at all
    expect(screen.queryByText(/parts|min/)).toBe(screen.getByText('12 parts · ~45 min'));
  });

  it('renders only unitCount when durationMs is missing, and only duration when unitCount is missing', () => {
    render(<MaterialGrid materials={[
      { id: 'a', title: 'A', poster: null, unitCount: 5, durationMs: null },
      { id: 'b', title: 'B', poster: null, unitCount: null, durationMs: 20 * 60000 },
    ]} onSelect={() => {}} />);
    expect(screen.getByText('5 parts')).toBeInTheDocument();
    expect(screen.getByText('~20 min')).toBeInTheDocument();
  });

  it('tapping a tile calls onSelect with that material', () => {
    const onSelect = vi.fn();
    render(<MaterialGrid materials={[withPoster, noPoster]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Bill Nye'));
    expect(onSelect).toHaveBeenCalledWith(withPoster);
  });

  it('renders an empty state with no materials', () => {
    render(<MaterialGrid materials={[]} onSelect={() => {}} />);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
