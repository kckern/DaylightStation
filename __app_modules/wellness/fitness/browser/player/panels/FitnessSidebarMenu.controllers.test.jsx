import { act, render, screen, fireEvent } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/hardReload.js', () => ({ __esModule: true, default: vi.fn() }));
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => ({}), FITNESS_DEBUG: false }));
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({ __esModule: true, default: () => null }));
// Body-portalled like the real overlay, so its focus events reach the menu
// through the React tree but not through DOM contains().
vi.mock('./ControllersOverlay.jsx', () => ({
  __esModule: true,
  default: ({ open, onClose }) => (open ? createPortal(
    <div data-testid="controllers-overlay"><button onClick={onClose}>Close controllers</button></div>,
    document.body,
  ) : null),
}));
// The menu's own gamepad hook: record whether it is active.
const gamepad = { active: null };
vi.mock('../../lib/useGamepadKeys.js', () => ({
  useGamepadKeys: (active) => { gamepad.active = active; },
}));

import FitnessSidebarMenu from './FitnessSidebarMenu.jsx';

describe('FitnessSidebarMenu — Controllers', () => {
  beforeEach(() => { gamepad.active = null; });
  afterEach(() => { vi.useRealTimers(); });

  const renderMenu = (onClose = vi.fn()) => render(
    <FitnessSidebarMenu onClose={onClose} visibility={{}} onToggleVisibility={vi.fn()} onToggleMusic={vi.fn()} appMode="menu" />,
  );

  it('opens the controllers overlay from the Tools section', () => {
    renderMenu();
    expect(screen.queryByTestId('controllers-overlay')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Controllers' }));
    expect(screen.getByTestId('controllers-overlay')).toBeTruthy();
  });

  it('Escape inside the overlay does not also close the menu', () => {
    const onClose = vi.fn();
    renderMenu(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Controllers' }));
    fireEvent.keyDown(screen.getByTestId('controllers-overlay'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the menu's gamepad hook is off while the overlay is open", () => {
    renderMenu();
    expect(gamepad.active).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Controllers' }));
    expect(gamepad.active).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close controllers' }));
    expect(gamepad.active).toBe(true);
  });

  it('closing the overlay returns focus to the Controllers button', () => {
    renderMenu();
    const opener = screen.getByRole('button', { name: 'Controllers' });
    opener.focus();
    fireEvent.click(opener);
    screen.getByRole('button', { name: 'Close controllers' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Close controllers' }));
    expect(document.activeElement).toBe(opener);
  });

  it('after keyboard use inside the overlay, the menu still idles closed like after Feedback', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderMenu(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Controllers' }));
    const inside = screen.getByRole('button', { name: 'Close controllers' });
    fireEvent.keyDown(inside, { key: 'Tab' });
    inside.focus(); // keyboard focus in the portal must not count as focus in the menu
    act(() => vi.advanceTimersByTime(6000));
    expect(onClose).not.toHaveBeenCalled(); // held open while the overlay is up
    fireEvent.click(inside);
    act(() => vi.advanceTimersByTime(5001));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
