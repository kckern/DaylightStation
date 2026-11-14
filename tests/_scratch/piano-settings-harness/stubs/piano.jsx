// Harness-only stand-ins for the piano kiosk hooks the Sound and Maintenance
// sheets read. Every value comes from window.__SCENE__ (set by main.jsx from
// ?scene=), so a scene is data, not code. Nothing here talks to a backend.
const S = () => window.__SCENE__ || {};
const noop = () => {};

export const soundVoiceKey = (value) => value?.voice?.pc == null ? null : `${value.voice.pc}:${value.voice.bank || 0}`;
const comparable = (p) => ({ voice: p?.voice && { pc: p.voice.pc, bank: p.voice.bank || 0 }, reverb: p?.reverb, chorus: p?.chorus });
export const sameSoundPreset = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

export function usePianoSoundBundle() { return { currentBundle: S().bundle, applyBundle: noop }; }
export function usePianoPreset() {
  return {
    preset: { favorites: S().favorites || [] }, saveFavorite: async () => ({ ok: true }), removeFavorite: async () => ({ ok: true }),
    canSave: S().canSave ?? true, persistenceState: S().persistence || 'idle', retryLastSound: noop, maxFavorites: 8, playerName: 'Alex',
  };
}
export function usePianoKioskConfig() { return { pianoId: 'default', config: S().config || {} }; }
export function usePianoRosterOptional() { return null; }
export function usePianoSound() {
  const device = S().device;
  return { device, setEffect: noop, deviceVoice: device?.voiceGroups?.[0]?.voices?.[0], voicePatches: S().voicePatches || {}, auditionAddress: () => true, resync: noop };
}
export function useBridgeMidiTap() { return { state: S().tapState || 'listening', changes: S().tapChanges || [], clear: noop }; }
export function usePianoMix() { return { pianoLevel: S().pianoLevel ?? 0.75, setPianoLevel: noop }; }
const midi = { sendNote: () => true, sendPanic: () => true, connected: true, subscribeRaw: () => noop };
export function usePianoMidi() { return { ...midi, connected: S().health?.state === 'ready' }; }
export function usePianoMidiNotes() { return { activeNotes: new Map() }; }
export function usePianoConnection() { return { health: S().health, repair: S().repair || { state: 'idle', message: null }, repairConnection: noop }; }
export function usePianoScreenOff() { return async () => ({ ok: true }); }
export function screenOffFailureMessage() { return 'Couldn’t turn off display.'; }
export async function DaylightAPI() { return { ok: true }; }
export function DaylightMediaPath(path) {
  return `/${String(path).replace(/^\/|\/$/g, '').replace(/^static\/img\//, 'api/v1/static/img/')}`;
}
