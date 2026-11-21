// keyTestModel.js — key names and the "what can games do with it" verdict for
// the Bluetooth screen's device page.
// Which keys games use comes from input.yml's `keyboard:` block.

export function normalizeKey(key) {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  const k = String(key ?? '');
  return k.length === 1 ? k.toLowerCase() : k;
}

export function gameKeySet(keyboardMap) {
  const out = new Set();
  if (keyboardMap && typeof keyboardMap === 'object') {
    for (const v of Object.values(keyboardMap)) if (typeof v === 'string' && v) out.add(normalizeKey(v));
  }
  return out;
}

const KEY_NAMES = {
  ArrowUp: 'Up arrow', ArrowDown: 'Down arrow', ArrowLeft: 'Left arrow', ArrowRight: 'Right arrow',
  AudioVolumeUp: 'Volume up', AudioVolumeDown: 'Volume down', AudioVolumeMute: 'Mute',
  MediaPlayPause: 'Play/pause', MediaPlay: 'Play', MediaPause: 'Pause', MediaStop: 'Stop',
  MediaTrackNext: 'Next track', MediaTrackPrevious: 'Previous track',
  MediaFastForward: 'Fast forward', MediaRewind: 'Rewind',
  BrowserBack: 'Back', GoBack: 'Back', ContextMenu: 'Menu',
  // Remote controls decoded by the garage box (bt.remote.key, not browser keys).
  ButtonA: 'A button', ButtonB: 'B button', ButtonC: 'C button', ButtonD: 'D button',
  TriggerCircle: 'Circle trigger', TriggerBack: 'Back trigger',
  StickUp: 'Stick up', StickDown: 'Stick down', StickLeft: 'Stick left', StickRight: 'Stick right',
};

/** A short, plain name for a normalized key ('x' → 'X', 'AudioVolumeUp' → 'Volume up'). */
export function keyName(k) {
  if (KEY_NAMES[k]) return KEY_NAMES[k];
  return k.length === 1 ? k.toUpperCase() : k;
}

export function testVerdict({ keys = [], padInputs = 0, gameKeys = new Set() }) {
  if (padInputs > 0) return { id: 'controller', tone: 'ok', text: 'Games can use this as a controller.' };
  const usable = [...new Set(keys.filter((k) => gameKeys.has(k)))];
  if (usable.length) return { id: 'game-keys', tone: 'ok', text: `Games can use these keys: ${usable.map(keyName).join(', ')}.` };
  if (keys.length) return { id: 'other-keys', tone: 'warn', text: "Games can't use these keys yet." };
  return { id: 'nothing', tone: 'idle', text: null };
}
