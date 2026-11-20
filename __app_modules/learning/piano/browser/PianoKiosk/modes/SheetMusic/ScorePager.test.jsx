import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScorePager from './ScorePager.jsx';

const page = (over = {}) => ({ index: 1, pages: 5, hasPrev: true, hasNext: true, ...over });

describe('ScorePager', () => {
  it('is absent for a piece that fits one page', () => {
    const { container } = render(<ScorePager page={page({ index: 0, pages: 1 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('turns by its two buttons and shows one pip per page', () => {
    const onPrev = vi.fn(); const onNext = vi.fn();
    render(<ScorePager page={page()} onPrev={onPrev} onNext={onNext} />);
    expect(screen.getByRole('list', { name: 'Page 2 of 5' }).children).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('disables the button that has nowhere to go', () => {
    render(<ScorePager page={page({ index: 4, hasNext: false })} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  // A long piece at a large size is dozens of pages: pips would crowd the buttons out.
  it('shows a long piece as a marker on a track instead of pips', () => {
    render(<ScorePager page={page({ index: 7, pages: 14 })} />);
    expect(screen.queryByRole('list')).toBeNull();
    const marker = screen.getByRole('img', { name: 'Page 8 of 14' }).firstChild;
    expect(marker.style.top).toBe('50%');
    expect(parseFloat(marker.style.height)).toBeCloseTo(100 / 14);
  });
});
