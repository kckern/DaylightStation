import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useArcadeInput } from './useArcadeInput.js';

describe('useArcadeInput', () => {
  it('keyboard: false leaves the keyboard alone', () => {
    const onIntent = vi.fn();
    renderHook(() => useArcadeInput({ onIntent, keyboard: false, getGamepads: () => [] }));
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(onIntent).not.toHaveBeenCalled();
  });
  it('keyboard is on by default', () => {
    const onIntent = vi.fn();
    renderHook(() => useArcadeInput({ onIntent, getGamepads: () => [] }));
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(onIntent).toHaveBeenCalledWith('up');
  });
});
