import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { LoopMeter } from './LoopMeter.jsx';

afterEach(cleanup);

describe('LoopMeter', () => {
  it('renders one segment per bar, numbered 1..N', () => {
    render(<LoopMeter loopBars={4} positionRef={{ current: { normalized: 0 } }} isPlaying={false} />);
    const meter = screen.getByRole('img', { name: '4-bar loop' });
    expect(meter.querySelectorAll('.piano-loop-meter__bar')).toHaveLength(4);
    expect(meter.textContent).toBe('1234');
  });

  it('renders nothing when there is no loop (loopBars 0)', () => {
    const { container } = render(
      <LoopMeter loopBars={0} positionRef={{ current: { normalized: 0 } }} isPlaying />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('lights the segment the playhead is over while playing', async () => {
    // normalized 0.6 in an 8-bar loop → floor(0.6*8)=4 → the 5th segment (index 4).
    render(<LoopMeter loopBars={8} positionRef={{ current: { normalized: 0.6 } }} isPlaying />);
    await waitFor(() => {
      const bars = screen.getByRole('img').querySelectorAll('.piano-loop-meter__bar');
      expect(bars[4].className).toContain('is-active');
      expect(bars[0].className).not.toContain('is-active');
    });
  });

  it('lights no segment when stopped', () => {
    render(<LoopMeter loopBars={4} positionRef={{ current: { normalized: 0.6 } }} isPlaying={false} />);
    const active = screen.getByRole('img').querySelectorAll('.is-active');
    expect(active).toHaveLength(0);
  });
});
