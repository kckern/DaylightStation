import React, { useRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useDismissable } from './useDismissable.js';

function Host({ open, onDismiss }) {
  const ref = useRef(null);
  useDismissable(ref, { open, onDismiss });
  return (
    <div data-testid="outside">
      <div ref={ref} data-testid="target">content</div>
    </div>
  );
}

describe('useDismissable', () => {
  it('calls onDismiss on Escape when open', () => {
    const onDismiss = vi.fn();
    render(<Host open onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss on Escape when closed', () => {
    const onDismiss = vi.fn();
    render(<Host open={false} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('calls onDismiss on pointerdown outside the ref', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Host open onDismiss={onDismiss} />);
    fireEvent.pointerDown(getByTestId('outside'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss on pointerdown inside the ref', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Host open onDismiss={onDismiss} />);
    fireEvent.pointerDown(getByTestId('target'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('removes listeners when open flips false', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Host open onDismiss={onDismiss} />);
    rerender(<Host open={false} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
