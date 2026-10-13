import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Skeleton, SkeletonGrid, SkeletonPoster, SkeletonList, SkeletonStage } from './Skeleton.jsx';

describe('Skeleton', () => {
  it('renders a shimmer block with the base class', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('.piano-skeleton');
    expect(el).toBeTruthy();
    expect(el.classList.contains('is-shimmer')).toBe(true);
  });
  it('drops the shimmer when animate={false} (reduced-motion callers)', () => {
    const { container } = render(<Skeleton animate={false} />);
    expect(container.querySelector('.piano-skeleton').classList.contains('is-shimmer')).toBe(false);
  });
  it('SkeletonPoster renders `count` poster (2:3) placeholders', () => {
    const { container } = render(<SkeletonPoster count={6} />);
    expect(container.querySelectorAll('.piano-skeleton--poster').length).toBe(6);
  });
  it('SkeletonGrid renders `count` square tiles when aspect="square"', () => {
    const { container } = render(<SkeletonGrid count={4} aspect="square" />);
    expect(container.querySelectorAll('.piano-skeleton--square').length).toBe(4);
    expect(container.querySelectorAll('.piano-skeleton--poster').length).toBe(0);
  });
  it('SkeletonList renders `rows` row placeholders', () => {
    const { container } = render(<SkeletonList rows={5} />);
    expect(container.querySelectorAll('.piano-skeleton-row').length).toBe(5);
  });
  it('SkeletonStage renders a single stage block', () => {
    const { container } = render(<SkeletonStage />);
    expect(container.querySelectorAll('.piano-skeleton--stage').length).toBe(1);
  });
  it('all composed skeletons are aria-hidden (decorative)', () => {
    const { container } = render(<SkeletonList rows={2} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
