import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoopRoll, loopBars } from './LoopRoll.jsx';

describe('loopBars', () => {
  it('uses the declared barSpan when > 0', () => {
    expect(loopBars([{ ticks: 0, durationTicks: 4, midi: 60 }], 4, 2)).toBe(2);
  });
  it('derives bars from the latest note end when barSpan is missing', () => {
    // note ends at tick 32, ppq 4 → 32 / (4 beats * 4 ppq) = 2 bars
    expect(loopBars([{ ticks: 0, durationTicks: 32, midi: 60 }], 4, undefined)).toBe(2);
  });
  it('defaults to 1 bar with no usable input', () => {
    expect(loopBars([], 4, 0)).toBe(1);
    expect(loopBars(null, 0, undefined)).toBe(1);
  });
});

describe('LoopRoll', () => {
  const notes = [
    { ticks: 0, durationTicks: 4, midi: 60 },
    { ticks: 4, durationTicks: 4, midi: 64 },
  ];

  it('renders a block per note plus a playhead cursor', () => {
    const { container } = render(<LoopRoll notes={notes} ppq={4} barSpan={1} />);
    expect(container.querySelectorAll('.piano-loop-roll__note').length).toBe(2);
    expect(container.querySelector('.piano-loop-roll__cursor')).toBeTruthy();
  });

  it('renders nothing without notes', () => {
    const { container } = render(<LoopRoll notes={[]} ppq={4} />);
    expect(container.querySelector('.piano-loop-roll')).toBeNull();
  });

  it('keeps the cursor hidden while stopped', () => {
    const { container } = render(<LoopRoll notes={notes} ppq={4} isPlaying={false} />);
    expect(container.querySelector('.piano-loop-roll__cursor').style.opacity).toBe('0');
  });
});
