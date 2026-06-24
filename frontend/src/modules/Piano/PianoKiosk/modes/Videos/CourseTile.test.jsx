import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseTile from './CourseTile.jsx';

const item = { id: 'plex:1', title: 'Bach', thumbnail: '/api/v1/display/plex/1' };

describe('CourseTile', () => {
  it('renders the cover lazily and un-blurs once it loads', () => {
    render(<CourseTile item={item} onSelect={() => {}} />);
    const img = screen.getByAltText('Bach');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toContain('is-loading');
    fireEvent.load(img);
    expect(img.className).not.toContain('is-loading');
  });

  it('calls onSelect with the item when tapped', () => {
    const onSelect = vi.fn();
    render(<CourseTile item={item} onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('Bach'));
    expect(onSelect).toHaveBeenCalledWith(item);
  });
});
