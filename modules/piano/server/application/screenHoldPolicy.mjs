/** Piano manual screen hold defaults, read at the instant a hold is requested. */
export function createPianoScreenHoldPolicy({ getPianoConfig }) {
  return {
    onMinutes() { return Number(getPianoConfig().button?.onHoldMinutes) || 10; },
    offMinutes() { const cfg = getPianoConfig(); return Number(cfg.button?.offHoldMinutes)
      || Number(cfg.screensaver?.offCooldownMinutes) || 30; },
  };
}
