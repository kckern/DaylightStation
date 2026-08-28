import { useContext } from 'react';
import { PipContext } from './PipManager.jsx';

export function usePip() {
  const ctx = useContext(PipContext);
  if (!ctx) {
    return {
      show: () => {}, dismiss: () => {}, promote: () => {},
      state: 'idle', hasPip: false,
      registerSlot: () => {}, unregisterSlot: () => {},
    };
  }
  return ctx;
}
