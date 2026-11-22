import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import ShowcaseSlide from './ShowcaseSlide.jsx';

const showcase = (over = {}) => ({
  type: 'showcase', id: 'showcase:kid-a', learnerId: 'kid-a', learnerName: 'Robin',
  bullets: ['Finished two books', 'Worked on Math 2 four times'],
  images: ['/img/1.jpg', '/img/2.jpg', '/img/3.jpg'],
  source: 'plain',
  ...over,
});

const imagesOf = (n) => Array.from({ length: n }, (_, i) => `/img/${i}.jpg`);

describe('ShowcaseSlide', () => {
  afterEach(() => vi.useRealTimers());

  it('titles the slide with the child and lists the bullets', () => {
    render(<ShowcaseSlide item={showcase()} index={3} total={5} color="#c2367a" />);
    expect(screen.getByRole('heading').textContent).toBe("Robin's School Work This Week");
    expect(screen.getByText('Finished two books')).toBeInTheDocument();
    expect(screen.getByText('Worked on Math 2 four times')).toBeInTheDocument();
    expect(screen.getByText('4 / 5')).toBeInTheDocument();
  });

  it('carries the child hue for the band and markers', () => {
    const { container } = render(<ShowcaseSlide item={showcase()} index={0} total={1} color="#c2367a" />);
    expect(container.querySelector('.weekly-review-showcase').style.getPropertyValue('--kid')).toBe('#c2367a');
    expect(container.querySelector('.showcase-band')).not.toBeNull();
    expect(container.querySelectorAll('.showcase-bullet-marker')).toHaveLength(2);
  });

  it('pins every image as a tilted, staggered print', () => {
    const { container } = render(<ShowcaseSlide item={showcase()} index={0} total={1} />);
    const prints = container.querySelectorAll('.showcase-print');
    expect(prints).toHaveLength(3);
    expect([...container.querySelectorAll('img.work-print-img')].map(i => i.getAttribute('src')))
      .toEqual(['/img/1.jpg', '/img/2.jpg', '/img/3.jpg']);
    expect(prints[0].style.getPropertyValue('--tilt')).toBe('-3deg');
    expect(prints[1].style.getPropertyValue('--tilt')).toBe('2deg');
    expect(prints[2].style.animationDelay).toBe('160ms');
  });

  it.each([
    [1, 'showcase-collage--one'],
    [2, 'showcase-collage--two'],
    [3, 'showcase-collage--three'],
    [4, 'showcase-collage--four'],
    [5, 'showcase-collage--five'],
    [6, 'showcase-collage--six'],
  ])('lays out %i image(s) as %s', (n, cls) => {
    const { container } = render(<ShowcaseSlide item={showcase({ images: imagesOf(n) })} index={0} total={1} />);
    expect(container.querySelector('.showcase-collage').classList.contains(cls)).toBe(true);
  });

  it('shows at most six prints', () => {
    const { container } = render(<ShowcaseSlide item={showcase({ images: imagesOf(9) })} index={0} total={1} />);
    expect(container.querySelectorAll('.showcase-print')).toHaveLength(6);
  });

  it('has no collage when there are no images', () => {
    const { container } = render(<ShowcaseSlide item={showcase({ images: [] })} index={0} total={1} />);
    expect(container.querySelector('.showcase-collage')).toBeNull();
    expect(container.querySelector('.weekly-review-showcase--no-images')).not.toBeNull();
  });

  it('crossfades to new bullets in place, then drops the old list', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ShowcaseSlide item={showcase()} index={0} total={1} />);
    rerender(<ShowcaseSlide item={showcase({ bullets: ['Read every night'], source: 'ai' })} index={0} total={1} />);
    expect(container.querySelector('.showcase-bullet-layer--out').textContent).toContain('Finished two books');
    expect(container.querySelector('.showcase-bullet-layer--in').textContent).toContain('Read every night');
    act(() => { vi.advanceTimersByTime(250); });
    expect(container.querySelector('.showcase-bullet-layer--out')).toBeNull();
    expect(container.textContent).not.toContain('Finished two books');
    expect(container.textContent).toContain('Read every night');
  });

  it('drops a print whose image fails and reflows to the new count', () => {
    const { container } = render(<ShowcaseSlide item={showcase()} index={0} total={1} />);
    fireEvent.error(container.querySelector('img[src="/img/2.jpg"]'));
    expect([...container.querySelectorAll('img.work-print-img')].map(i => i.getAttribute('src')))
      .toEqual(['/img/1.jpg', '/img/3.jpg']);
    expect(container.querySelector('.work-print-card')).toBeNull(); // no blank glyph print
    expect(container.querySelector('.showcase-collage').classList.contains('showcase-collage--two')).toBe(true);
  });

  it('takes the no-images layout when every image fails', () => {
    const { container } = render(<ShowcaseSlide item={showcase({ images: ['/img/a.jpg', '/img/b.jpg'] })} index={0} total={1} />);
    fireEvent.error(container.querySelector('img[src="/img/a.jpg"]'));
    fireEvent.error(container.querySelector('img[src="/img/b.jpg"]'));
    expect(container.querySelector('.showcase-collage')).toBeNull();
    expect(container.querySelector('.weekly-review-showcase--no-images')).not.toBeNull();
    expect(screen.getByRole('heading').textContent).toBe("Robin's School Work This Week");
  });
});
