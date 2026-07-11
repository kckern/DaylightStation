import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Skeleton, SkeletonPoster } from './Skeleton.jsx';

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
  it('SkeletonPoster renders `count` poster placeholders', () => {
    const { container } = render(<SkeletonPoster count={6} />);
    expect(container.querySelectorAll('.piano-skeleton--poster').length).toBe(6);
  });
});
