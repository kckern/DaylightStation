import { createContext, useContext } from 'react';

const NOOP = Object.freeze({ open() {}, close() {}, isOpen: false });

/** Provided by SurroundHost: lets a descendant open the surround on demand. */
export const SurroundOverrideContext = createContext(NOOP);

/** @returns {{ open: (data: object) => void, close: () => void, isOpen: boolean }} */
export function useSurroundOverride() {
  return useContext(SurroundOverrideContext) ?? NOOP;
}
