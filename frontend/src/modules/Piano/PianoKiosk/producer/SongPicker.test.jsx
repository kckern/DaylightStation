/**
 * SongPicker — saved-song front door tests (Task 8.2).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SongPicker } from './SongPicker.jsx';

const songs = [
  { id: 'aaa', title: 'First Tune', author: 'kc', created: '2026-07-01T00:00:00Z', sectionCount: 3 },
  { id: 'bbb', author: 'household', created: '2026-07-02T00:00:00Z', sectionCount: 1 },
];

describe('SongPicker', () => {
  it('lists saved songs with titles and an Untitled fallback', () => {
    render(<SongPicker songs={songs} onLoad={() => {}} onClose={() => {}} />);
    expect(screen.getByText('First Tune')).toBeTruthy();
    expect(screen.getByText('Untitled')).toBeTruthy();
  });

  it('loads a song on tap', () => {
    const onLoad = vi.fn();
    render(<SongPicker songs={songs} onLoad={onLoad} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('First Tune'));
    expect(onLoad).toHaveBeenCalledWith('aaa');
  });

  it('shows an honest empty state when nothing is saved', () => {
    render(<SongPicker songs={[]} onLoad={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/No saved songs yet/i)).toBeTruthy();
  });

  it('renders the resume affordance and applies it', () => {
    const onResume = vi.fn();
    render(<SongPicker songs={songs} onLoad={() => {}} onClose={() => {}} hasResume onResume={onResume} onDismissResume={() => {}} />);
    fireEvent.click(screen.getByText('Resume'));
    expect(onResume).toHaveBeenCalled();
  });

  it('does not show the resume affordance without a snapshot', () => {
    render(<SongPicker songs={songs} onLoad={() => {}} onClose={() => {}} hasResume={false} />);
    expect(screen.queryByText('Resume')).toBeNull();
  });

  it('deletes a song with a 2-tap confirm', () => {
    const onRemove = vi.fn();
    render(<SongPicker songs={songs} onLoad={() => {}} onClose={() => {}} onRemove={onRemove} />);
    const del = screen.getByLabelText('delete First Tune');
    fireEvent.click(del); // arms
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Sure?')); // confirms
    expect(onRemove).toHaveBeenCalledWith('aaa');
  });

  it('closes', () => {
    const onClose = vi.fn();
    render(<SongPicker songs={songs} onLoad={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('close songs'));
    expect(onClose).toHaveBeenCalled();
  });
});
