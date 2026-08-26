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

  it('wraps the cover and its overlays in one poster box (overlays anchor to the poster, not the grid cell)', () => {
    // The one-page course wall letterboxes a fixed 2:3 poster inside a
    // variable-shaped cell; badge/progress must sit on the POSTER's corners,
    // so they live inside the same positioned box as the <img>.
    const progress = {
      isSequential: true,
      total: 40,
      users: [{ id: 'user_2', name: 'User_2', completed: 12, total: 40, lastPlayedAt: new Date().toISOString() }],
    };
    const { container } = render(<CourseTile item={item} onSelect={() => {}} progress={progress} />);
    const box = container.querySelector('.piano-cover-box');
    expect(box).toBeTruthy();
    expect(box.querySelector('img.piano-cover')).toBeTruthy();
    expect(box.querySelector('.piano-cover-badge')).toBeTruthy();
    expect(box.querySelector('.piano-cover-progress')).toBeTruthy();
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

  it('renders a progress-ring chip per qualifying user with a percent (full counts in the tooltip)', () => {
    const progress = {
      isSequential: true,
      total: 40,
      users: [
        { id: 'user_2', name: 'User_2', completed: 12, total: 40, lastPlayedAt: new Date().toISOString() },
        { id: 'user_3', name: 'User_3', completed: 8, total: 40, lastPlayedAt: new Date().toISOString() },
      ],
    };
    render(<CourseTile item={item} onSelect={() => {}} progress={progress} />);
    const overlay = document.querySelector('.piano-cover-progress');
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('30%');
    expect(overlay.textContent).toContain('20%');
    expect(overlay.textContent).not.toContain('12/40'); // denominator lives in the tooltip only
    expect(screen.getByTitle('User_2: 12/40')).toBeTruthy();
    const rings = overlay.querySelectorAll('.piano-cover-progress__ring-fill');
    expect(rings).toHaveLength(2);
    expect(rings[0].getAttribute('stroke-dasharray')).toBe('30 100');
  });

  it('dims a chip whose player has been idle beyond the fresh window', () => {
    const old = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
    const progress = {
      isSequential: true,
      total: 344,
      users: [
        { id: 'learner2', name: 'learner2', completed: 32, total: 344, lastPlayedAt: old },
        { id: 'learner1', name: 'learner1', completed: 3, total: 344, lastPlayedAt: new Date().toISOString() },
      ],
    };
    render(<CourseTile item={item} onSelect={() => {}} progress={progress} />);
    const chips = document.querySelectorAll('.piano-cover-progress__chip');
    expect(chips[0].className).toContain('is-stale');
    expect(chips[0].getAttribute('title')).toContain('(resting)');
    expect(chips[1].className).not.toContain('is-stale');
  });

  it('floors the percent at 1% once anything is completed', () => {
    const progress = {
      isSequential: true,
      total: 344,
      users: [{ id: 'learner1', name: 'learner1', completed: 3, total: 344, lastPlayedAt: new Date().toISOString() }],
    };
    render(<CourseTile item={item} onSelect={() => {}} progress={progress} />);
    expect(document.querySelector('.piano-cover-progress').textContent).toContain('1%');
  });

  it('renders no overlay when no users qualify', () => {
    const { container } = render(<CourseTile item={item} onSelect={() => {}} progress={{ isSequential: true, total: 40, users: [] }} />);
    expect(container.querySelector('.piano-cover-progress')).toBeNull();
  });
});
