import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * What a play surface was doing at the moment it was observed.
 *
 * `UNKNOWN` is a first-class state, not an absence. An observer that cannot
 * reach a device reports UNKNOWN rather than guessing, and UNKNOWN never
 * accrues played time and never ends a session on its own. Collapsing it into
 * either PLAYING or PAUSED is the bug this value object exists to prevent.
 */
export const PlayState = Object.freeze({
  PLAYING: 'playing',
  PAUSED: 'paused',
  UNKNOWN: 'unknown',
});

const VALID = new Set(Object.values(PlayState));

export function isPlayState(value) {
  return VALID.has(value);
}

export function assertPlayState(value) {
  if (!VALID.has(value)) {
    throw new ValidationError(`Unknown play state: ${JSON.stringify(value)}`, {
      code: 'INVALID_PLAY_STATE',
      field: 'state',
      value,
    });
  }
  return value;
}

/** Only PLAYING earns time. Everything else — including UNKNOWN — earns none. */
export function accrues(state) {
  return state === PlayState.PLAYING;
}
