// Harness-only stand-in for the Skyline audio engine: no AudioContext, no
// sound. The screenshot runs must make no noise on whatever machine runs them.
window.__si = window.__si || {};
window.__si.cues = [];
export const SKYLINE_SOUND_SLOTS = Object.freeze(['laser', 'missile', 'hit', 'target', 'explosion', 'crash', 'hurt', 'deny', 'boost', 'finish', 'music']);
export function createSkylineAudio() {
  return {
    loadSounds: async () => ({ loaded: [], missing: [] }),
    prime: async () => true,
    playCue: (cue) => { window.__si.cues.push(cue); return true; },
    setMuted: () => {},
    setVolume: () => {},
    getLevels: () => ({ output: 0 }),
    stop: () => {},
  };
}
export default { createSkylineAudio };
