// One way a remote-style press reaches a screen's apps, for every device that is not
// the keyboard itself: a gamepad (GamepadAdapter) and another device's D-pad (the phone,
// through an `input` command in useScreenCommands).
//
//   1. the ActionBus (useScreenAction, useScopedRemoteControls, MenuStack). An owner
//      that consumes it returns true, and nothing else happens: it may unmount on Back,
//      and a second event would land in the newly exposed parent.
//   2. otherwise a synthetic keydown on window for direct listeners (Menu.jsx,
//      ArcadeSelector). It is marked __gamepadSynthetic, the flag KeyboardAdapter and
//      useScopedRemoteControls already use to skip what the bus has carried.

const KEYS = Object.freeze({
  navigate: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
  select: 'Enter',
  escape: 'Escape',
});

/** The keyboard key a press stands for, or null for one that has none. */
export function keyForPress(action, payload = {}) {
  if (action === 'navigate') return KEYS.navigate[payload?.direction] ?? null;
  return typeof KEYS[action] === 'string' ? KEYS[action] : null;
}

/**
 * @param {{emit: Function}} bus   the screen-framework ActionBus
 * @param {object} mapping         { action, payload, key? } (key defaults from the action)
 * @param {object} [marks]         extra flags set on the synthetic event (e.g. { __remoteSynthetic: true })
 * @returns {'bus'|'keydown'|'none'} where the press went
 */
export function deliverPress(bus, mapping, marks = {}) {
  if (bus?.emit(mapping.action, mapping.payload) === true) return 'bus';
  const key = mapping.key ?? keyForPress(mapping.action, mapping.payload);
  if (!key || typeof window === 'undefined') return 'none';
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  event.__gamepadSynthetic = true;
  Object.assign(event, marks);
  window.dispatchEvent(event);
  return 'keydown';
}
