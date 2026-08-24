import { describeBoard, dropDisc, legalColumns } from './engine.mjs';

// These are mechanics-only difficulty profiles. Environments may merge them
// with names, artwork, and themes loaded from mounted configuration.
export const CONNECT_FOUR_OPPONENTS = Object.freeze([
  ...Array.from({ length: 7 }, (_, index) => Object.freeze({
    id: `level-${index + 1}`,
    name: `Level ${index + 1}`,
    art: null,
    depth: index + 1,
  })),
]);

const ORDER = [3, 2, 4, 1, 5, 0, 6];

function immediate(board, player) {
  return ORDER.find((column) => {
    const result = dropDisc(board, column, player);
    return !result.error && describeBoard(result.board).winner === player;
  });
}

/** Deterministic local teaching partner: win, block, then prefer the centre. */
export function chooseColumn(board, { player = 2, level = 1 } = {}) {
  const legal = new Set(legalColumns(board));
  if (!legal.size) return null;
  const winning = immediate(board, player);
  if (winning !== undefined) return winning;
  const blocking = immediate(board, player === 1 ? 2 : 1);
  if (blocking !== undefined) return blocking;
  const shift = Math.max(0, Number(level) - 1) % ORDER.length;
  const preference = [...ORDER.slice(shift), ...ORDER.slice(0, shift)];
  return preference.find((column) => legal.has(column)) ?? null;
}

export default { CONNECT_FOUR_OPPONENTS, chooseColumn };
