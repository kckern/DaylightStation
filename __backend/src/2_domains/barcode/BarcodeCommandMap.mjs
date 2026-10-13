/**
 * BarcodeCommandMap - Maps barcode command names to WebSocket broadcast payloads.
 *
 * Each entry is a function that accepts an optional argument and returns
 * the WS payload to broadcast. Parameterized commands (volume, speed)
 * use the argument; simple commands ignore it.
 *
 * @module domains/barcode/BarcodeCommandMap
 */

export const COMMAND_MAP = {
  pause:    () => ({ playback: 'pause' }),
  play:     () => ({ playback: 'play' }),
  next:     () => ({ playback: 'next' }),
  prev:     () => ({ playback: 'prev' }),
  ffw:      () => ({ playback: 'fwd' }),
  rew:      () => ({ playback: 'rew' }),
  stop:     () => ({ action: 'reset' }),
  off:      () => ({ action: 'sleep' }),
  blackout: () => ({ shader: 'blackout' }),
  volume:   (arg) => ({ volume: Number(arg) }),
  speed:    (arg) => ({ rate: Number(arg) }),
};

export const KNOWN_COMMANDS = Object.keys(COMMAND_MAP);

export function resolveCommand(command, arg) {
  const factory = COMMAND_MAP[command];
  if (!factory) return null;
  return factory(arg);
}
