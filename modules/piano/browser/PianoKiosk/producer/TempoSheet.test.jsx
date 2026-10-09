import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TempoSheet } from './TempoSheet.jsx';

const base = () => ({ bpm: 100, onBpm: vi.fn(), onClose: vi.fn() });

describe('TempoSheet', () => {
  it('fine steppers emit ±1', () => {
    const p = base();
    render(<TempoSheet {...p} />);
    fireEvent.click(screen.getByLabelText('tempo down'));
    expect(p.onBpm).toHaveBeenLastCalledWith(99);
    fireEvent.click(screen.getByLabelText('tempo up'));
    expect(p.onBpm).toHaveBeenLastCalledWith(101);
  });

  it('preset chips set the bpm and mark the active one', () => {
    const p = { ...base(), bpm: 120 };
    render(<TempoSheet {...p} />);
    expect(screen.getByRole('button', { name: '120' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '90' }));
    expect(p.onBpm).toHaveBeenLastCalledWith(90);
  });

  it('tap tempo averages intervals into a bpm', () => {
    const p = base();
    const times = [0, 500, 1000, 1500];
    let i = 0;
    render(<TempoSheet {...p} now={() => times[Math.min(i++, times.length - 1)]} />);
    const tap = screen.getByLabelText('tap tempo');
    fireEvent.click(tap); // first tap — no emit
    expect(p.onBpm).not.toHaveBeenCalled();
    fireEvent.click(tap);
    fireEvent.click(tap);
    fireEvent.click(tap);
    expect(p.onBpm).toHaveBeenLastCalledWith(120); // 500ms → 120bpm
  });

  it('Done and the scrim both close', () => {
    const p = base();
    const { rerender } = render(<TempoSheet {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    rerender(<TempoSheet {...p} />);
    fireEvent.click(screen.getByRole('presentation'));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
