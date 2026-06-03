import React from 'react';
import { render } from '@testing-library/react';
import CompletionCountBlocks from './CompletionCountBlocks.jsx';

const base = {
  containerClassName: 'c',
  blockClassName: 'blk',
  completeBlockClassName: 'blk--done',
  activeBlockClassName: 'blk--active'
};

describe('CompletionCountBlocks activeIndex', () => {
  it('marks the block at activeIndex with the active class', () => {
    const { container } = render(
      <CompletionCountBlocks targetCount={4} actualCount={1} activeIndex={1} {...base} />
    );
    const blocks = container.querySelectorAll('.blk');
    expect(blocks[1].classList.contains('blk--active')).toBe(true);
    expect(blocks[0].classList.contains('blk--active')).toBe(false);
  });

  it('does not mark any block active when activeIndex is omitted (HR behavior unchanged)', () => {
    const { container } = render(
      <CompletionCountBlocks targetCount={4} actualCount={2} {...base} />
    );
    expect(container.querySelectorAll('.blk--active')).toHaveLength(0);
  });

  it('a completed block is not also active', () => {
    const { container } = render(
      <CompletionCountBlocks targetCount={4} actualCount={2} activeIndex={0} {...base} />
    );
    const blocks = container.querySelectorAll('.blk');
    expect(blocks[0].classList.contains('blk--active')).toBe(false);
  });
});
