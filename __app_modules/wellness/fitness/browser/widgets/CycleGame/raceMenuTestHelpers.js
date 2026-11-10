// Test helpers: stopping a race through the race menu. Not a test file.
import { vi } from 'vitest';
import { fireEvent, act } from '@testing-library/react';
import { RACE_MENU_GUARD_MS } from "./RaceMenu.jsx";

/**
 * Open the race menu, wait out the accidental-tap guard, tap one item
 * ('discard' | 'end'). The guard is a timer, so a test on real timers gets fake
 * ones for just these three steps (timers it had already started stay real).
 */
export function chooseFromRaceMenu(view, item) {
  const hadFakeTimers = vi.isFakeTimers();
  if (!hadFakeTimers) vi.useFakeTimers();
  try {
    act(() => { fireEvent.click(view.getByTestId('race-menu-open')); });
    act(() => { vi.advanceTimersByTime(RACE_MENU_GUARD_MS); });
    act(() => { fireEvent.click(view.getByTestId(`race-menu-${item}`)); });
  } finally {
    if (!hadFakeTimers) vi.useRealTimers();
  }
}

export const discardRace = (view) => chooseFromRaceMenu(view, 'discard');
export const endRaceHere = (view) => chooseFromRaceMenu(view, 'end');
