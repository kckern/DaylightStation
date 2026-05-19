import { createContext, useContext } from 'react';

// Default value: when no ScreenVolumeProvider wraps the tree, every consumer
// behaves exactly as it did before the volume system existed (master = 1 is a
// no-op multiplier). This keeps shared modules (Player, audio bridge, Piano)
// safe to render outside the screen-framework.
const noop = () => {};

const DEFAULT_VALUE = Object.freeze({
  master: 1,
  effectiveMaster: 1,
  muted: false,
  setMaster: noop,
  step: noop,
  toggleMute: noop,
});

export const ScreenVolumeContext = createContext(DEFAULT_VALUE);

export function useScreenVolume() {
  return useContext(ScreenVolumeContext);
}

export function useEffectiveVolume(local = 1) {
  const { effectiveMaster } = useContext(ScreenVolumeContext);
  return effectiveMaster * local;
}

// --- Module-level state for non-React consumers (sound effects, services) ---

let _state = { master: 1, effectiveMaster: 1, muted: false };
const _subscribers = new Set();

export function getMasterVolume() {
  return _state.master;
}

export function getMasterMuted() {
  return _state.muted;
}

export function getEffectiveMaster() {
  return _state.effectiveMaster;
}

export function subscribeMaster(fn) {
  if (typeof fn !== 'function') return () => {};
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

// Internal: ScreenVolumeProvider calls this to mirror state into module scope
// so non-React code can read the latest master synchronously.
export function _publishMasterState(master, effectiveMaster, muted) {
  _state = { master, effectiveMaster, muted };
  for (const fn of _subscribers) {
    try { fn(master, muted); } catch { /* ignore subscriber errors */ }
  }
}

// Test-only: reset module state. Not part of the public API.
export function _resetForTests() {
  _state = { master: 1, effectiveMaster: 1, muted: false };
  _subscribers.clear();
}
