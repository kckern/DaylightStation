// controllerIndicatorLabels.js — text/label logic for ControllerIndicator.jsx,
// split out so Fast Refresh can hot-reload the indicator component on its own.

/** Human-readable fault text. Kept short enough to sit in the chrome. */
export function faultLabel(fault) {
  switch (fault) {
    case 'input-gap': return 'Controller not reaching game';
    case 'frozen': return 'Game stopped responding';
    case 'contract-broken': return 'Emulator needs a restart';
    case 'audio-suspended': return 'Sound stopped';
    default: return 'Controller problem';
  }
}

/** Screen-reader label for the whole indicator. */
export function ariaLabelFor(state, fault) {
  if (state === 'fault') return `Controller fault: ${faultLabel(fault)}`;
  if (state === 'healing') return 'Reconnecting controller';
  if (state === 'no-pad') return 'No controller connected; keyboard works';
  return 'Controller connected';
}
