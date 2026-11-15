import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { pressDown } from './pressDown.js';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('acts on primary mouse-down and keyboard click, never again on mouse release', () => {
  const action = vi.fn(); render(<button {...pressDown(action)}>Go</button>);
  const button = screen.getByRole('button');
  fireEvent.mouseDown(button, { button: 0 }); expect(action).toHaveBeenCalledTimes(1);
  fireEvent.click(button, { detail: 1 }); expect(action).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(button, { button: 2 }); expect(action).toHaveBeenCalledTimes(1);
  fireEvent.click(button, { detail: 0 }); expect(action).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(button, { key: 'Enter' }); expect(action).toHaveBeenCalledTimes(3);
  fireEvent.keyDown(button, { key: 'Enter', repeat: true }); expect(action).toHaveBeenCalledTimes(3);
});
it('acts at touch-down and suppresses the synthesized mouse-down and click', () => {
  vi.useFakeTimers();
  const action = vi.fn(); render(<button {...pressDown(action)}>Go</button>);
  const button = screen.getByRole('button');
  const down = new Event('pointerdown', { bubbles: true });
  Object.defineProperties(down, { pointerType: { value: 'touch' }, isPrimary: { value: true } });
  fireEvent(button, down); expect(action).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5000); // Even a long held touch must not double-act on release.
  fireEvent.mouseDown(button, { button: 0 }); fireEvent.click(button, { detail: 1 });
  expect(action).toHaveBeenCalledTimes(1);
});
