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

  it('stops sibling document Escape handlers from firing when open', () => {
    const onDismiss = vi.fn();
    const sibling = vi.fn();
    document.addEventListener('keydown', sibling); // bubble-phase sibling on document
    try {
      render(<Host open onDismiss={onDismiss} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(sibling).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', sibling);
    }
  });
});

function Harness({ onDismiss, ignore }) {
  const ref = useRef(null);
  useDismissable(ref, { open: true, onDismiss, ignore });
  return <div ref={ref} data-testid="inside">overlay</div>;
}

describe('useDismissable ignore selector', () => {
  it('does not dismiss for pointerdown inside an ignored container', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <>
        <Harness onDismiss={onDismiss} ignore=".media-app-portal" />
        <div className="media-app-portal"><button data-testid="in-portal">x</button></div>
      </>
    );
    fireEvent.pointerDown(getByTestId('in-portal'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('still dismisses for pointerdown elsewhere', () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} ignore=".media-app-portal" />);
    fireEvent.pointerDown(document.body);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('dismiss behavior unchanged when no ignore selector given', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <>
        <Harness onDismiss={onDismiss} />
        <div className="media-app-portal"><button data-testid="in-portal">x</button></div>
      </>
    );
    fireEvent.pointerDown(getByTestId('in-portal'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
