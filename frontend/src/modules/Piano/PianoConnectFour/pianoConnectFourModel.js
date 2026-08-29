// frontend/src/modules/Piano/PianoConnectFour/pianoConnectFourModel.js
//
// Pure addressing/board logic for Connect Four, split out of
// PianoConnectFour.jsx (which keeps the components) so Fast Refresh can
// hot-reload the game screen without a full remount.
import { noteName, staffTokenNotes } from '../PianoChessGame/staffAddress.js';

export const COLUMNS = 7;
export const DEFAULT_CONFIG = {
  input_mode: 'notes', addressing: { vocabulary: 'staff', shuffle: 'never' },
  column_notes: [60, 62, 64, 65, 67, 69, 71],
  column_chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'], default_level: 1,
};
const ROOTS = [0, 2, 4, 5, 7, 9, 11];

/**
 * Map this game's explicit column config onto the common dimensions.
 *
 * One axis, not two: gravity picks the row, so Connect Four addresses a COLUMN
 * and nothing else. The scheme's `qualities` is filled with the same values as
 * `roots` because the shape is shared with the two-axis games and a scheme with
 * a missing axis fails validation — nothing ever reads it here.
 */
export function configuredAddressing(config) {
  const notes = config?.column_notes;
  const overrides = {};
  if (Array.isArray(notes) && notes.length === COLUMNS && notes.every(Number.isFinite)
    && notes.join() !== DEFAULT_CONFIG.column_notes.join()) {
    overrides.scheme = { id: 'connect-four-configured-columns', kind: 'staff', roots: notes, qualities: notes };
  }
  return overrides;
}

/**
 * The chord roots this game addresses columns with, in SCALE order.
 *
 * The chord tier tables are alphabetical, because chess maps file `a` to A. A
 * row of columns read left to right is a scale, not an alphabet — so the same
 * tier material is re-sorted from C upward here. Same notes, the order a player
 * reading a keyboard expects.
 */
export function scaleRoots(roots, size = COLUMNS) {
  const order = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const rank = (root) => {
    const index = order.indexOf(root);
    return index < 0 ? order.length : index;
  };
  return [...roots].sort((a, b) => rank(a) - rank(b)).slice(0, size);
}

export function shuffledColumns(seed) {
  const values = [0, 1, 2, 3, 4, 5, 6];
  let state = seed >>> 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}

export function addressedColumn(active, config, deal) {
  const notes = [...active.keys()].sort((a, b) => a - b);
  if (!notes.length) return null;
  if (config.input_mode === 'chords') {
    const pcs = [...new Set(notes.map((note) => note % 12))];
    const index = ROOTS.findIndex((root) => pcs.length === 3 && [root, (root + 4) % 12, (root + 7) % 12].every((pc) => pcs.includes(pc)));
    return index < 0 ? null : deal[index];
  }
  const shaped = Array.isArray(config.column_notes?.[0]);
  const index = config.column_notes.findIndex((note) => {
    if (!shaped) return note === notes.at(-1) || note % 12 === notes.at(-1) % 12;
    const expected = staffTokenNotes(note).slice().sort((a, b) => a - b);
    return expected.length === notes.length && expected.every((value, i) => value === notes[i]);
  });
  return index < 0 ? null : deal[index];
}

/**
 * The rail's cards, in COLUMN order — not address order.
 *
 * `deal[address] = column`, so a shuffled game moves which note plays which
 * column while `config.column_notes` itself never changes. A rail drawn in
 * address order would show the SAME seven cards regardless of the deal, which
 * is exactly backwards: the rail sits over the board, so card N has to name
 * whatever note actually drops a disc into column N right now — inverting the
 * deal is what makes that true instead of coincidental.
 */
export function columnAddresses(config, deal) {
  const addressByColumn = [];
  deal.forEach((column, address) => { addressByColumn[column] = address; });
  return addressByColumn.map((address) => ({
    midi: config.column_notes[address],
    label: noteName(config.column_notes[address]),
    chord: config.column_chords?.[address] ?? null,
  }));
}

/**
 * Where the newest disc landed, and how far it had to fall to get there.
 *
 * Discs stack from the floor up, so the newest one in a column is the TOPMOST
 * occupied cell in it — no need to diff boards or thread the landing row out of
 * the engine. `rows` counts cells from above the board's rim down to the resting
 * place, which is what turns one animation into a fall of the right length: a
 * disc into a full column barely moves, a disc into an empty one falls six.
 */
export function lastDrop(board, moves) {
  if (!moves.length) return null;
  const column = moves.at(-1);
  const row = board.findIndex((cells) => cells[column]);
  if (row < 0) return null;
  return { row, column, rows: row + 1, ply: moves.length };
}

/** Longer falls take longer. Gravity, not a fixed transition. */
export function dropDurationMs(rows) {
  return 190 + Math.max(0, rows) * 52;
}

/**
 * The four cells that won, as `row-column` keys.
 *
 * The engine has always reported them (`describeBoard` → `winningCells`) and the
 * board has always thrown them away, so a finished game looked exactly like an
 * unfinished one plus a sentence. Keys rather than the raw pairs because the
 * board asks the question once per cell, forty-two times a render.
 */
export function winningKeys(status) {
  return new Set((status?.winningCells ?? []).map(({ row, column }) => `${row}-${column}`));
}
