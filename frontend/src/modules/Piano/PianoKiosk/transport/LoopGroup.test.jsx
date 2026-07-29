// LoopGroup.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LoopGroup from './LoopGroup.jsx';

const noop = { onMarkIn: vi.fn(), onMarkOut: vi.fn(), onToggle: vi.fn(), onClear: vi.fn() };

describe('LoopGroup', () => {
  it('renders the four buttons and fires the mark handlers', () => {
    const onMarkIn = vi.fn(); const onMarkOut = vi.fn();
    render(<LoopGroup {...noop} onMarkIn={onMarkIn} onMarkOut={onMarkOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark loop start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark loop end' }));
    expect(onMarkIn).toHaveBeenCalled();
    expect(onMarkOut).toHaveBeenCalled();
  });

  it('toggle and clear gate on canToggle/canClear', () => {
    render(<LoopGroup {...noop} canToggle={false} canClear={false} />);
    expect(screen.getByRole('button', { name: 'Toggle loop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear loop' })).toBeDisabled();
  });

  it('shows measure labels and the arming highlight', () => {
    render(<LoopGroup {...noop} inSet outSet inLabel="m5" outLabel="m8" armingOut canToggle canClear loopOn />);
    expect(screen.getByText('m5')).toBeInTheDocument();
    expect(screen.getByText('m8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark loop end' }).className).toMatch(/is-arming/);
    expect(screen.getByRole('button', { name: 'Toggle loop' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('disabled locks the whole group', () => {
    render(<LoopGroup {...noop} inSet outSet canToggle canClear disabled />);
    ['Mark loop start', 'Mark loop end', 'Toggle loop', 'Clear loop']
      .forEach((n) => expect(screen.getByRole('button', { name: n })).toBeDisabled());
  });
});
