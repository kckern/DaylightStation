import { describeBoard, dropDisc, legalColumns } from './engine.mjs';

const pokemonArt = (file) => `/api/v1/proxy/media/stream/${encodeURIComponent(`games/pokemon/svg/${file}`)}`;

// Round, stacking, gravity-minded characters. Deliberately disjoint from the
// Chess and Checkers packs: changing games should mean meeting a new ladder,
// not seeing the same seven mascots pasted onto another board.
export const CONNECT_FOUR_OPPONENTS = Object.freeze([
  { id: 'diglett', name: 'Diglett', art: pokemonArt('0050-diglett-gen1.svg'), depth: 1 },
  { id: 'voltorb', name: 'Voltorb', art: pokemonArt('0100-voltorb-gen1.svg'), depth: 2 },
  { id: 'magnemite', name: 'Magnemite', art: pokemonArt('0081-magnemite-gen1.svg'), depth: 3 },
  { id: 'exeggcute', name: 'Exeggcute', art: pokemonArt('0102-exeggcute-gen1.svg'), depth: 4 },
  { id: 'graveler', name: 'Graveler', art: pokemonArt('0075-graveler-gen1.svg'), depth: 5 },
  { id: 'electrode', name: 'Electrode', art: pokemonArt('0101-electrode-gen1.svg'), depth: 6 },
  { id: 'zapdos', name: 'Zapdos', art: pokemonArt('0145-zapdos-gen1.svg'), depth: 7 },
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
