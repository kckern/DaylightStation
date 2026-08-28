// checkersAddressingModel.js — addressing/rejection-message logic for
// PianoCheckers.jsx, split out so Fast Refresh can hot-reload the game
// screen on its own.
import { DEFAULT_FILE_NOTES, DEFAULT_RANK_NOTES } from './checkersAddress.js';

const AXIS = 8;

/**
 * What to put on screen when the board refuses an address.
 *
 * `forced_source` is the one that used to have no wording at all: mid multi-
 * jump the engine pins the source, so re-selecting is impossible and every
 * address that is not the jump destination bounces. The player saw a board
 * that ignored them and answered the only way they could — by playing the
 * same address over and over.
 */
export function selectionMessage(rejection) {
  if (rejection === 'select_source') return "Play a glowing red piece's file and rank notes together.";
  if (rejection === 'select_destination') return "Play a glowing destination's file and rank notes together.";
  if (rejection === 'forced_source') return 'You must keep jumping with the glowing piece — play a glowing destination.';
  return null;
}

/**
 * Map this game's explicit file/rank config onto the common dimensions. Only a
 * complete, valid pair can override the selected addressing tier.
 */
export function configuredAddressing(config) {
  const clean = (axis) => Array.isArray(axis) && axis.length === AXIS && axis.every(Number.isFinite);
  const overrides = {};
  if (clean(config?.file_notes) && clean(config?.rank_notes)
    && (config.file_notes !== DEFAULT_FILE_NOTES || config.rank_notes !== DEFAULT_RANK_NOTES)) {
    overrides.scheme = {
      id: 'checkers-configured-axes', kind: 'staff',
      roots: config.file_notes, qualities: config.rank_notes,
    };
  }
  return overrides;
}
