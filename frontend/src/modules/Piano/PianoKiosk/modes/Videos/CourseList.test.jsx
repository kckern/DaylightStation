import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseList from './CourseList.jsx';

const courses = [
  { floor: 1, label: 'Pop Soloing', lessons: [{ plex: '1', userWatched: true }, { plex: '2', userWatched: false }] },
  { floor: 2, label: 'Slip Notes', lessons: [{ plex: '3', userWatched: false }] },
];

describe('CourseList', () => {
  it('renders each course label with watched/total', () => {
    render(<CourseList courses={courses} poster="/p.jpg" onSelect={() => {}} />);
    expect(screen.getByText('Pop Soloing')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();
  });

  it('calls onSelect with the course when tapped', () => {
    const onSelect = vi.fn();
    render(<CourseList courses={courses} poster="/p.jpg" onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Slip Notes'));
    expect(onSelect).toHaveBeenCalledWith(courses[1]);
  });
});
