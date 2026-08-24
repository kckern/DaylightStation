import { nextRandom } from './random.mjs';

const NOTATION = /^(\d{0,2})d(\d{1,5})(?:([+-])(\d{1,5}))?$/i;

export function parseDiceNotation(notation = '1d6') {
  const match = NOTATION.exec(String(notation).replaceAll(' ', ''));
  if (!match) throw new Error('Dice notation must use NdS±M');
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const modifier = Number(match[4] || 0) * (match[3] === '-' ? -1 : 1);
  if (count < 1 || count > 100) throw new Error('Dice count must be between 1 and 100');
  if (sides < 2 || sides > 10000) throw new Error('Dice sides must be between 2 and 10000');
  return { count, sides, modifier, notation: `${count}d${sides}${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}` };
}

export function rollDice(notation = '1d6', seed = 1) {
  const parsed = parseDiceNotation(notation);
  let rngState = Number(seed) >>> 0;
  const rolls = [];
  for (let index = 0; index < parsed.count; index += 1) {
    const next = nextRandom(rngState);
    rngState = next.state;
    rolls.push(1 + Math.floor(next.value * parsed.sides));
  }
  return { ...parsed, rolls, total: rolls.reduce((sum, roll) => sum + roll, parsed.modifier), rng_state: rngState };
}

export function diceRendererKind(sides, { webgl = true } = {}) {
  if (!webgl) return 'deterministic-2d';
  if (sides === 100) return 'percentile-pair';
  if ([4, 6, 8, 10, 12, 20].includes(sides)) return 'three-polyhedron';
  return 'deterministic-2d';
}
