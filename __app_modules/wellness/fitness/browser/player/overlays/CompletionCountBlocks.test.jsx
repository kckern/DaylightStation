import React from 'react';
import { render } from '@testing-library/react';
import CompletionCountBlocks from "./CompletionCountBlocks.jsx";

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

describe('CompletionCountBlocks holding riders', () => {
  it('draws riders mid-hold as holding blocks after the completed ones', () => {
    const { container } = render(
      <CompletionCountBlocks
        targetCount={3}
        actualCount={1}
        metUsers={['child-a']}
        holdingUsers={['child-b']}
        holdingBlockClassName="blk--holding"
        {...base}
      />
    );
    const blocks = container.querySelectorAll('.blk');
    expect(blocks[0].classList.contains('blk--done')).toBe(true);
    expect(blocks[1].classList.contains('blk--holding')).toBe(true);
    expect(blocks[1].classList.contains('blk--done')).toBe(false);
    expect(blocks[1].textContent).toBe('C');
    expect(blocks[2].classList.contains('blk--holding')).toBe(false);
  });
});
