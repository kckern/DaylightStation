import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VideoCourseTile from './VideoCourseTile.jsx';

describe('VideoCourseTile', () => {
  it('renders the title', () => {
    render(<VideoCourseTile item={{ id: 'v1', title: 'Big History', poster: '/poster.jpg' }} onOpen={() => {}} />);
    expect(screen.getByText('Big History')).toBeTruthy();
  });

  it('calls onOpen with the item when clicked', () => {
    const onOpen = vi.fn();
    const item = { id: 'v1', title: 'Big History', poster: '/poster.jpg' };
    render(<VideoCourseTile item={item} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(item);
  });
});
