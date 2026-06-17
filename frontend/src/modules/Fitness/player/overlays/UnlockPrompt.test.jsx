import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import UnlockPrompt from './UnlockPrompt.jsx';

describe('UnlockPrompt', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <UnlockPrompt open={false} state="scanning" lockLabel="Dance Party" onCancel={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the scanning prompt text and the lockLabel', () => {
    render(
      <UnlockPrompt open state="scanning" lockLabel="Dance Party" onCancel={() => {}} />
    );
    expect(screen.getByText('Place finger to unlock')).toBeTruthy();
    expect(screen.getByText('Dance Party')).toBeTruthy();
  });

  it('calls onCancel when the Cancel button is activated', () => {
    const onCancel = vi.fn();
    render(
      <UnlockPrompt open state="scanning" lockLabel="Dance Party" onCancel={onCancel} />
    );
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = vi.fn();
    render(
      <UnlockPrompt open state="scanning" lockLabel="Dance Party" onCancel={onCancel} />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the denied state', () => {
    render(
      <UnlockPrompt open state="denied" lockLabel="Dance Party" onCancel={() => {}} />
    );
    expect(screen.getByText('Not recognized')).toBeTruthy();
    // In the denied state the cancel button reads "Close"
    expect(screen.getByRole('button')).toHaveTextContent('Close');
  });

  it('shows the granted state', () => {
    render(
      <UnlockPrompt open state="granted" lockLabel="Dance Party" onCancel={() => {}} />
    );
    expect(screen.getByText('Unlocked')).toBeTruthy();
  });

  describe('auto-dismiss timeout', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('calls onCancel after timeoutMs while scanning', () => {
      const onCancel = vi.fn();
      render(
        <UnlockPrompt open state="scanning" lockLabel="Dance Party" onCancel={onCancel} timeoutMs={500} />
      );
      expect(onCancel).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(500); });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onCancel via timeout when state is granted', () => {
      const onCancel = vi.fn();
      render(
        <UnlockPrompt open state="granted" lockLabel="Dance Party" onCancel={onCancel} timeoutMs={500} />
      );
      act(() => { vi.advanceTimersByTime(5000); });
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
