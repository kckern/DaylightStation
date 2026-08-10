const FNV_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const GLYPH_SATURATION = 62;
const GLYPH_LIGHTNESS = 52;

export const GLYPH_GRID = 5;
const HALF_COLS = 3;

function fnv1a(value) {
  let hash = FNV_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function seedFor(material) {
  const value = material || {};
  if (
    (value.kind === 'stack' || value.kind === 'section' || value.kind === 'song')
    && Array.isArray(value.children)
  ) {
    const childSeeds = value.children
      .map((child) => (typeof child === 'string' ? child : seedFor(child)))
      .sort();
    return `stack(${childSeeds.join('|')})`;
  }
  if (value.roman?.length) return `roman:${value.roman.join('-')}`;
  if (value.degrees?.length) return `degrees:${value.degrees.join('-')}`;
  if (value.type === 'groove') return `groove:${value.feel || ''}:${value.slug}`;
  return `slug:${value.slug || value.path || value.id || ''}`;
}

export function glyphColor(seed) {
  const hue = fnv1a(`color\0${seed}`) % 360;
  return { hue, css: `hsl(${hue} ${GLYPH_SATURATION}% ${GLYPH_LIGHTNESS}%)` };
}

export function glyphCells(seed) {
  const half = [];
  for (let index = 0; index < HALF_COLS * GLYPH_GRID; index += 1) {
    half.push(fnv1a(`cell\0${index}\0${seed}`) % 100 < 55);
  }
  if (half.every((on) => !on)) half[Math.floor(half.length / 2)] = true;
  if (half.every((on) => on)) half[0] = false;

  const cells = new Array(GLYPH_GRID * GLYPH_GRID).fill(false);
  for (let row = 0; row < GLYPH_GRID; row += 1) {
    for (let column = 0; column < HALF_COLS; column += 1) {
      const on = half[column * GLYPH_GRID + row];
      cells[row * GLYPH_GRID + column] = on;
      cells[row * GLYPH_GRID + (GLYPH_GRID - 1 - column)] = on;
    }
  }
  return cells;
}
