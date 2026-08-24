const FNV_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const GRID_SIZE = 5;
const CARD_HUES = [18, 42, 142, 184, 208, 344];

function hashString(value) {
  let hash = FNV_BASIS;
  const input = String(value || 'card');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function cardIdenticonHue(seed) {
  return CARD_HUES[hashString(`hue:${seed}`) % CARD_HUES.length];
}

export function cardIdenticonCells(seed) {
  const cells = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    const half = [];
    for (let column = 0; column < 3; column += 1) {
      half.push(hashString(`cell:${row}:${column}:${seed}`) % 100 < 54);
    }
    cells.push([...half, half[1], half[0]]);
  }
  if (cells.every((row) => row.every(Boolean))) cells[0][0] = false;
  if (cells.every((row) => row.every((cell) => !cell))) cells[2][2] = true;
  return cells;
}

export { GRID_SIZE };
