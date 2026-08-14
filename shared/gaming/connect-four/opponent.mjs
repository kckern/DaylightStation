import { describeBoard, dropDisc, legalColumns } from './engine.mjs';

export const CONNECT_FOUR_OPPONENTS = Object.freeze([
  { id: 'pebble', name: 'Pebble', depth: 1 },
  { id: 'pogo', name: 'Pogo', depth: 2 },
  { id: 'stack', name: 'Stack', depth: 3 },
  { id: 'zigzag', name: 'Zigzag', depth: 4 },
  { id: 'cascade', name: 'Cascade', depth: 5 },
  { id: 'fortress', name: 'Fortress', depth: 6 },
  { id: 'parallax', name: 'Parallax', depth: 7 },
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
