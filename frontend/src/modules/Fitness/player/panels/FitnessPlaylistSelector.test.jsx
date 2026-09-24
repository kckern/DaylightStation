import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FitnessPlaylistSelector, { formatPlaylistLength, formatPlaylistMeta } from './FitnessPlaylistSelector.jsx';

const playlists = [
  { id: '672596', name: 'Fitness', thumb: '/api/v1/content/plex/672596/image', trackCount: 42, durationSeconds: 10200 },
  { id: '697722', name: 'Jock Jams', trackCount: 68, durationSeconds: 14605 },
  { id: '697723', name: 'Sports Anthems' },
  { id: '697724', name: 'Workout Rock' },
  { id: '697725', name: '80s/90s Pump' },
  { id: '697726', name: 'Trance / EDM' },
  { id: '697727', name: 'Kids Workout' },
  { id: '622869', name: 'Dance Party' },
];

const renderPicker = (props = {}) => {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <FitnessPlaylistSelector
      playlists={playlists}
      selectedPlaylistId="672596"
      isOpen
      onSelect={onSelect}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSelect, onClose };
};

describe('FitnessPlaylistSelector', () => {
  it('shows every playlist plus No Music on one page, with no paging controls', () => {
    renderPicker();
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options).toHaveLength(9);
    expect(options[0]).toHaveTextContent('No Music');
    expect(screen.queryByText('More')).toBeNull();
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
  });

  it('marks the current playlist', () => {
    renderPicker();
    const selected = screen.getByRole('option', { selected: true });
    expect(selected).toHaveTextContent('Fitness');
  });

  it('shows track count and length when the backend supplied them', () => {
    renderPicker();
    expect(screen.getByRole('option', { name: /Jock Jams/ })).toHaveTextContent('68 tracks · 4h 3m');
    expect(screen.getByRole('option', { name: /Sports Anthems/ }).textContent).toBe('🎵Sports Anthems');
  });

  it('selects a different playlist and closes', () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.click(screen.getByRole('option', { name: /Jock Jams/ }));
    expect(onSelect).toHaveBeenCalledWith('697722');
    expect(onClose).toHaveBeenCalled();
  });

  it('selects No Music as a null id', () => {
    const { onSelect } = renderPicker();
    fireEvent.click(screen.getByRole('option', { name: /No Music/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('closes without re-selecting when the current playlist is tapped', () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.click(screen.getByRole('option', { name: /Fitness/ }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('dismisses on Escape and on the close button without selecting', () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderPicker({ isOpen: false });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('falls back to the placeholder when a cover fails to load', () => {
    renderPicker();
    const tile = screen.getByRole('option', { name: /Fitness/ });
    fireEvent.error(tile.querySelector('img'));
    expect(tile.querySelector('img')).toBeNull();
    expect(tile).toHaveTextContent('🎵');
  });
});

describe('playlist meta formatting', () => {
  it('formats lengths', () => {
    expect(formatPlaylistLength(14605)).toBe('4h 3m');
    expect(formatPlaylistLength(7200)).toBe('2h');
    expect(formatPlaylistLength(2700)).toBe('45m');
    expect(formatPlaylistLength(10)).toBe('1m');
    expect(formatPlaylistLength(null)).toBeNull();
    expect(formatPlaylistLength(0)).toBeNull();
  });

  it('joins what is known and omits what is not', () => {
    expect(formatPlaylistMeta({ trackCount: 1, durationSeconds: 200 })).toBe('1 track · 3m');
    expect(formatPlaylistMeta({ trackCount: 68 })).toBe('68 tracks');
    expect(formatPlaylistMeta({})).toBeNull();
  });
});
