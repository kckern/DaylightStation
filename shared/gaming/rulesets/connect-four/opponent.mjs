import { describeBoard, dropDisc, legalColumns } from './engine.mjs';

// These are mechanics-only difficulty profiles. Environments may merge them
// with names, artwork, and themes loaded from mounted configuration.
const CONNECT_FOUR_CHARACTERS = [
  ['diglett', 'Diglett', '0050-diglett-gen1.svg'],
  ['psyduck', 'Psyduck', '0054-psyduck-gen1.svg'],
  ['magnemite', 'Magnemite', '0081-magnemite-gen1.svg'],
  ['porygon', 'Porygon', '0137-porygon-gen1.svg'],
  ['gengar', 'Gengar', '0094-gengar-gen1.svg'],
  ['dragonite', 'Dragonite', '0149-dragonite-gen1.svg'],
  ['mew', 'Mew', '0151-mew-gen1.svg'],
];
export const CONNECT_FOUR_OPPONENTS = Object.freeze(CONNECT_FOUR_CHARACTERS.map(([id, name, art], index) => Object.freeze({
  id, name, art: `/api/v1/static/img/pokemon/${art}`, theme: null, depth: index + 1,
  dialogue: Object.freeze({
    persona: `${name} is a warm, competitive Connect Four opponent.`,
    voice: 'React briefly to threats, blocks, and connected lines.',
    lore: Object.freeze({ type: [], references: [], known_references: [], use: 'never' }),
  }),
})));

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
