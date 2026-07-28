import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StuckPrompt from './StuckPrompt.jsx';

describe('StuckPrompt', () => {
  it('renders nothing when not open', () => {
    const { container } = render(<StuckPrompt open={false} onPick={() => {}} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers one hand at a time and reports the pick', () => {
    const onPick = vi.fn();
    render(<StuckPrompt open onPick={onPick} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /right hand/i }));
    expect(onPick).toHaveBeenCalledWith('rh');
  });

  it('can be dismissed', () => {
    const onDismiss = vi.fn();
    render(<StuckPrompt open onPick={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /keep both/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
