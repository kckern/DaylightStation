import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeySheet, shortestKeyDelta } from './KeySheet.jsx';

describe('shortestKeyDelta', () => {
  it('takes the shortest signed path (−6..+5)', () => {
    expect(shortestKeyDelta(0, 0)).toBe(0);
    expect(shortestKeyDelta(0, 2)).toBe(2);   // C→D up
    expect(shortestKeyDelta(0, 10)).toBe(-2); // C→Bb down (not +10)
    expect(shortestKeyDelta(0, 7)).toBe(-5);  // C→G down (not +7)
    expect(shortestKeyDelta(9, 11)).toBe(2);  // A→B
  });
});

describe('KeySheet', () => {
  it('renders all twelve keys and marks the current tonic', () => {
    render(<KeySheet keyPc={2} onKeyNudge={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /^key / })).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'key D' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('nudges by the shortest delta to the tapped key, then closes', () => {
    const onKeyNudge = vi.fn();
    const onClose = vi.fn();
    render(<KeySheet keyPc={0} onKeyNudge={onKeyNudge} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'key G' })); // C→G = -5 (down, shortest)
    expect(onKeyNudge).toHaveBeenCalledWith(-5);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tapping the current key closes without a nudge', () => {
    const onKeyNudge = vi.fn();
    const onClose = vi.fn();
    render(<KeySheet keyPc={7} onKeyNudge={onKeyNudge} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'key G' }));
    expect(onKeyNudge).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
