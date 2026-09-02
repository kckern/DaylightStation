// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Skeleton from './Skeleton.jsx';

const el = (ui) => render(ui).container.firstChild;

describe('Skeleton', () => {
  it('is decorative, not content', () => {
    expect(el(<Skeleton />).getAttribute('aria-hidden')).toBe('true');
  });

  it('takes numeric height and width as pixels', () => {
    const node = el(<Skeleton height={20} width={140} />);
    expect(node.style.height).toBe('20px');
    expect(node.style.width).toBe('140px');
  });

  it('passes a string dimension through untouched', () => {
    const node = el(<Skeleton height="100%" width="40%" />);
    expect(node.style.height).toBe('100%');
    expect(node.style.width).toBe('40%');
  });

  it('maps Mantine radius names, so call sites need no edits', () => {
    expect(el(<Skeleton radius="sm" />).style.borderRadius).toBe('5px');
    expect(el(<Skeleton radius="md" />).style.borderRadius).toBe('9px');
    expect(el(<Skeleton radius={4} />).style.borderRadius).toBe('4px');
  });

  it('renders a circle as a square with a round radius', () => {
    const node = el(<Skeleton circle height={40} />);
    expect(node.style.borderRadius).toBe('50%');
    expect(node.style.width).toBe('40px');
  });

  it('animates by default and can be stilled', () => {
    expect(el(<Skeleton />).className).toContain('ds-skeleton--animate');
    expect(el(<Skeleton animate={false} />).className).not.toContain('ds-skeleton--animate');
  });

  it('keeps a caller style and className', () => {
    const node = el(<Skeleton className="mine" style={{ opacity: '0.5' }} />);
    expect(node.className).toContain('mine');
    expect(node.style.opacity).toBe('0.5');
  });
});
