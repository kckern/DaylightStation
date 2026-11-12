// Game volume: each fitness game keeps its own level in the fitness volume
// store, the way the music player keeps one per playlist and the emulator one
// per console. It is not the video level (fitness/global/video): the household
// sets videos to ~10% linear for loud-mastered shows, and game audio fed that
// level through the log curve came out at 1.6% — silent (2026-11-12).
//
// Store convention (as FitnessMusicPlayer / DancePartyWidget): the stored value
// IS the output gain, written as logVolumeFromLevel(level); the button level is
// read back with logLevelFromVolume. So the curve is applied exactly once.
import {
  logLevelFromVolume,
  logVolumeFromLevel,
  snapToTouchLevel,
} from '../../../../../__capabilities/playback/browser/volume/touchVolumeModel.js';

// Level 60 on the house log curve = 0.158 output (-16 dB). With the game sound
// sets mastered at cues -20 LUFS / music -26 (Skyline) and Cycle Race's -14.5
// LUFS music at music_volume 0.55, both land within a few dB of the garage's
// normal video listening level (shows ~-18 LUFS at 0.1).
export const GAME_DEFAULT_LEVEL = 60;

export const gameVolumeIds = (gameId) => ({
  grandparentId: `fitness-game-${gameId}`,
  parentId: 'global',
  trackId: 'game',
});

export const storedVolumeFromLevel = (level) => logVolumeFromLevel(level);

/**
 * @param {{ volume?: number, muted?: boolean, source?: string }} state usePersistentVolume state
 * @returns {{ level: number, output: number, muted: boolean, isDefault: boolean }}
 */
export function resolveGameVolume(state = {}, { defaultLevel = GAME_DEFAULT_LEVEL } = {}) {
  const isDefault = state.source !== 'exact' && state.source !== 'season-sibling' && state.source !== 'show-sibling';
  const level = isDefault
    ? defaultLevel
    : snapToTouchLevel(logLevelFromVolume(Number.isFinite(state.volume) ? state.volume : 0));
  const muted = !!state.muted || level <= 0;
  const output = muted ? 0 : logVolumeFromLevel(level);
  return { level, output, muted, isDefault };
}
