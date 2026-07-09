import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseCards from './CourseCards.jsx';

const season = { index: 1, courses: [
  { floor: 1, label: 'Pop Soloing with Chord Tone Targets', reference: false, lessons: [{ plex: '1', userWatched: true }] },
  { floor: 2, label: 'Pop Soloing with 3rds and 6ths', reference: false, lessons: [{ plex: '2', userWatched: false }] },
] };

describe('CourseCards', () => {
  it('fades the shared prefix and emphasizes the tail', () => {
    render(<CourseCards season={season} onSelect={() => {}} />);
    expect(screen.getAllByText('Pop Soloing with').length).toBe(2);
    expect(screen.getByText('Chord Tone Targets')).toBeTruthy();
    expect(screen.getByText('3rds and 6ths')).toBeTruthy();
  });
  it('marks the current course', () => {
    const { container } = render(<CourseCards season={season} currentFloor={2} onSelect={() => {}} />);
    const cards = container.querySelectorAll('.psc-card');
    expect(cards[1].className).toContain('is-current');
  });
  it('calls onSelect with the course', () => {
    const onSelect = vi.fn();
    render(<CourseCards season={season} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('3rds and 6ths').closest('button'));
    expect(onSelect).toHaveBeenCalledWith(season.courses[1]);
  });
});
