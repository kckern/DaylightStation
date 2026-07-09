import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PausedLoopOverlay from './PausedLoopOverlay.jsx';

describe('PausedLoopOverlay', () => {
  it('renders the loop cluster and fires skips without resuming', () => {
    const onSkip = vi.fn(); const onResume = vi.fn();
    render(<PausedLoopOverlay onSkip={onSkip} onResume={onResume} />);
    fireEvent.click(screen.getByLabelText('Back 30 seconds'));
    fireEvent.click(screen.getByLabelText('Back 15 seconds'));
    fireEvent.click(screen.getByLabelText('Forward 15 seconds'));
    fireEvent.click(screen.getByLabelText('Forward 30 seconds'));
    expect(onSkip.mock.calls.map((c) => c[0])).toEqual([-30, -15, 15, 30]);
    expect(onResume).not.toHaveBeenCalled();
  });

  it('resumes on the play button and on a backdrop tap', () => {
    const onResume = vi.fn();
    const { container } = render(<PausedLoopOverlay onSkip={vi.fn()} onResume={onResume} />);
    fireEvent.click(screen.getByLabelText('Resume'));
    fireEvent.click(container.querySelector('.piano-loop-overlay'));
    expect(onResume).toHaveBeenCalledTimes(2);
  });

  it('disables forward skips when forwardDisabled', () => {
    render(<PausedLoopOverlay onSkip={vi.fn()} onResume={vi.fn()} forwardDisabled />);
    expect(screen.getByLabelText('Forward 15 seconds').disabled).toBe(true);
    expect(screen.getByLabelText('Forward 30 seconds').disabled).toBe(true);
  });
});
