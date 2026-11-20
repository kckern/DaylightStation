import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';
import { playbackLog } from './playbackLogger.js';

/** Dispatch a playback progress write without making the player wait for it. */
export async function recordPlaybackProgress(payload, { completion = false } = {}) {
  try {
    await DaylightAPI('api/v1/play/log', payload);
  } catch (error) {
    const { type, assetId, seconds, percent } = payload;
    playbackLog('play.log.failed', {
      type,
      assetId,
      seconds,
      percent,
      ...(completion ? { completion } : {}),
      message: error?.message || 'unknown',
    }, { level: 'warn' });
  }
}
