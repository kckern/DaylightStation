// pairButtonState.js — pairing-progress → button-state mapping for
// ControllerStatus.jsx, split out so Fast Refresh can hot-reload the panel
// on its own.

/**
 * Translate a pairing-progress status into the button's display/disabled state.
 *
 * Pure helper so it can be reasoned about (and tested) without rendering.
 *
 * @param {{ phase?: string, device?: object, message?: string, paired?: Array }|null|undefined} pairing
 * @returns {{ label: string, disabled: boolean, scanning: boolean }}
 */
export function pairButtonState(pairing) {
  const phase = pairing && pairing.phase;
  switch (phase) {
    case 'scanning':
      return { label: 'Scanning for controllers… (~30s)', disabled: true, scanning: true };
    case 'paired': {
      const name = pairing?.device?.name;
      return { label: name ? `Paired: ${name}` : 'Paired', disabled: true, scanning: false };
    }
    case 'done': {
      const n = Array.isArray(pairing?.paired) ? pairing.paired.length : 0;
      return {
        label: n > 0 ? `Done — ${n} paired` : 'Done',
        disabled: false,
        scanning: false,
      };
    }
    case 'error':
      return {
        label: `Pairing failed — ${pairing?.message || 'unknown error'}`,
        disabled: false,
        scanning: false,
      };
    default:
      return { label: '🎮 Pair controller', disabled: false, scanning: false };
  }
}
