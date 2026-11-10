import { createContext, useContext } from 'react';

const NOOP = Object.freeze({ open() { return false; }, close() {}, isOpen: false, available: false });

/** Provided by SurroundHost: lets a descendant open the surround on demand. */
export const SurroundOverrideContext = createContext(NOOP);

/** @returns {{ open: (data: object) => boolean|void, close: () => void, isOpen: boolean, available?: boolean }} `open` returns false when refused; `available` is false with no host or when the surround is off. */
export function useSurroundOverride() {
  return useContext(SurroundOverrideContext) ?? NOOP;
}
