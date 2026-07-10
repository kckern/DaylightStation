import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SeasonList from './SeasonList.jsx';

const graded = { id: '701', index: 1, title: 'Pop Soloing', reference: false,
  lessons: [{ plex: '1', userWatched: true }], courses: [{ floor: 1, lessons: [{ plex: '1', userWatched: true }] }, { floor: 2, lessons: [{ plex: '2', userWatched: false }] }] };
const resources = { id: '700', index: 0, title: 'Practice Essentials', reference: true,
  lessons: [{ plex: '9' }], courses: [{ floor: 1, reference: true, lessons: [{ plex: '9' }] }] };

describe('SeasonList', () => {
  it('renders a graded season with ordinal + course count', () => {
    render(<SeasonList seasons={[graded]} onSelect={() => {}} />);
    expect(screen.getByText('Pop Soloing')).toBeTruthy();
    expect(screen.getByText(/2 courses/)).toBeTruthy();
    expect(screen.getByText('01')).toBeTruthy();
  });
  it('renders a reference season as always-on resources (no ordinal, no ring)', () => {
    const { container } = render(<SeasonList seasons={[resources]} onSelect={() => {}} />);
    expect(screen.getByText('Practice Essentials')).toBeTruthy();
    expect(screen.getByText(/open anytime/)).toBeTruthy();
    expect(container.querySelector('.psc-ring')).toBeNull();
  });
  it('calls onSelect with the season', () => {
    const onSelect = vi.fn();
    render(<SeasonList seasons={[graded]} onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Pop Soloing'));
    expect(onSelect).toHaveBeenCalledWith(graded);
  });
  it('renders a repertoire season as a song-library row without a ring', () => {
    const seasons = [{ id: 'r1', index: 8, title: 'Song Library', reference: false, piano: { lane: 'repertoire' }, lessons: new Array(5).fill({}), courses: [] }];
    render(<SeasonList seasons={seasons} onSelect={() => {}} />);
    expect(screen.getByText('Song Library')).toBeInTheDocument();
    expect(screen.getByText(/browse by song/i)).toBeInTheDocument();
    expect(document.querySelector('.psc-ring')).toBeNull();
  });
});
