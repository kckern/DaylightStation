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

  // ── prefab "Examples" group (Task 9.1) ──────────────────────────────────────
  const examples = [
    { id: 'sunset-drive', title: 'Sunset Drive', author: 'curated', sectionCount: 2 },
    { id: 'slow-bloom', title: 'Slow Bloom', author: 'curated', sectionCount: 2 },
  ];

  it('renders an Examples group of prefab songs alongside saved songs', () => {
    render(<SongPicker songs={songs} examples={examples} onLoad={() => {}} onLoadExample={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Examples')).toBeTruthy();
    expect(screen.getByText('Sunset Drive')).toBeTruthy();
    expect(screen.getByText('Slow Bloom')).toBeTruthy();
  });

  it('shows Examples even when no songs are saved', () => {
    render(<SongPicker songs={[]} examples={examples} onLoad={() => {}} onLoadExample={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/No saved songs yet/i)).toBeTruthy(); // saved list empty
    expect(screen.getByText('Examples')).toBeTruthy();            // but examples present
    expect(screen.getByText('Sunset Drive')).toBeTruthy();
  });

  it('loads a prefab song via onLoadExample on pick', () => {
    const onLoadExample = vi.fn();
    const onLoad = vi.fn();
    render(<SongPicker songs={songs} examples={examples} onLoad={onLoad} onLoadExample={onLoadExample} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Sunset Drive'));
    expect(onLoadExample).toHaveBeenCalledWith('sunset-drive');
    expect(onLoad).not.toHaveBeenCalled(); // examples route to onLoadExample, not onLoad
  });

  it('never offers a Delete affordance on examples (read-only)', () => {
    render(<SongPicker songs={[]} examples={examples} onLoad={() => {}} onLoadExample={() => {}} onClose={() => {}} onRemove={() => {}} />);
    expect(screen.queryByLabelText('delete Sunset Drive')).toBeNull();
  });

  it('omits the Examples group when there are none', () => {
    render(<SongPicker songs={songs} examples={[]} onLoad={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('Examples')).toBeNull();
  });
});
