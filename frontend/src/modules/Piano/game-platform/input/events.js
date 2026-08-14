export const MUSICAL_INPUT_TYPES = Object.freeze({
  ADDRESS_PREVIEW: 'address-preview',
  ADDRESS_COMMIT: 'address-commit',
  COMMAND: 'command',
  PITCH_ATTACK: 'pitch-attack',
  PITCH_RELEASE: 'pitch-release',
  GESTURE: 'gesture',
});

export function musicalInput(type, payload = {}, timestamp = performance.now()) {
  if (!Object.values(MUSICAL_INPUT_TYPES).includes(type)) throw new Error(`Unsupported musical input: ${type}`);
  return Object.freeze({ type, ...payload, timestamp });
}
