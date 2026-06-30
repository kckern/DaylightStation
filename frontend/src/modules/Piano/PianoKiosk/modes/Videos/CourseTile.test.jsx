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

  it('shows a sequential badge when the course is sequential', () => {
    render(<CourseTile item={item} onSelect={() => {}} progress={{ isSequential: true, total: 40, users: [] }} />);
    expect(screen.getByLabelText('Sequential course')).toBeTruthy();
  });

  it('shows no sequential badge for a non-sequential course', () => {
    const { container } = render(<CourseTile item={item} onSelect={() => {}} progress={{ isSequential: false, users: [] }} />);
    expect(container.querySelector('.piano-cover-badge')).toBeNull();
  });

  it('renders a progress overlay chip per qualifying user with completed/total', () => {
    const progress = {
      isSequential: true,
      total: 40,
      users: [
        { id: 'felix', name: 'Felix', completed: 12, total: 40 },
        { id: 'milo', name: 'Milo', completed: 8, total: 40 },
      ],
    };
    render(<CourseTile item={item} onSelect={() => {}} progress={progress} />);
    const overlay = document.querySelector('.piano-cover-progress');
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('12/40');
    expect(overlay.textContent).toContain('8/40');
  });

  it('renders no overlay when no users qualify', () => {
    const { container } = render(<CourseTile item={item} onSelect={() => {}} progress={{ isSequential: true, total: 40, users: [] }} />);
    expect(container.querySelector('.piano-cover-progress')).toBeNull();
  });
});
