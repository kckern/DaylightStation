import React from 'react';

// The game's icons, drawn as bitmaps so they sit on a pixel grid like the scene
// art, and never depend on which symbol or emoji font the kiosk has.
//   #  body (currentColor)   o  highlight   .  empty
// Every icon gets a one-pixel ink outline (4-neighbour, so corners step), which
// is what keeps it readable over sky, snow and rock alike. An icon printed in
// ink on a coloured key drops the outline (`.sg-icon__ink` in the stylesheet).
const BITMAPS = Object.freeze({
  heart: [
    '.##...##.',
    '####.####',
    '#o#######',
    '#o#######',
    '#########',
    '.#######.',
    '..#####..',
    '...###...',
    '....#....',
  ],
  bell: [
    '....#....',
    '...###...',
    '..#o###..',
    '.#o#####.',
    '.#o#####.',
    '.#######.',
    '.#######.',
    '#########',
    '#########',
    '.........',
    '...###...',
  ],
  target: [
    '..#####..',
    '.##...##.',
    '##.....##',
    '#..###..#',
    '#..###..#',
    '#..###..#',
    '##.....##',
    '.##...##.',
    '..#####..',
  ],
  bolt: [
    '.....###',
    '....###.',
    '...###..',
    '..######',
    '.######.',
    '..###...',
    '.###....',
    '###.....',
  ],
  bomb: [
    '......o..',
    '.....#.o.',
    '....#....',
    '..####...',
    '.######..',
    '##o#####.',
    '#o######.',
    '########.',
    '.######..',
    '..####...',
  ],
  missile: [
    '##.........',
    '###........',
    '.#########.',
    '.##########',
    '.#########.',
    '###........',
    '##.........',
  ],
  boost: [
    '##...##....',
    '.##...##...',
    '..##...##..',
    '...##...##.',
    '....##...##',
    '...##...##.',
    '..##...##..',
    '.##...##...',
    '##...##....',
  ],
  lock: [
    '..#####..',
    '.##...##.',
    '.#.....#.',
    '.#.....#.',
    '#########',
    '#########',
    '####.####',
    '####.####',
    '#########',
  ],
  check: [
    '........##',
    '.......###',
    '......###.',
    '##...###..',
    '###.###...',
    '.#####....',
    '..###.....',
    '...#......',
  ],
  right: [
    '......#....',
    '......##...',
    '......###..',
    '##########.',
    '###########',
    '##########.',
    '......###..',
    '......##...',
    '......#....',
  ],
  cross: [
    '##.....##',
    '###...###',
    '.###.###.',
    '..#####..',
    '...###...',
    '..#####..',
    '.###.###.',
    '###...###',
    '##.....##',
  ],
  retry: [
    '...#.......',
    '..##.......',
    '.#########.',
    '###########',
    '.##########',
    '..##....###',
    '...#....###',
    '........###',
    '..#########',
    '..########.',
  ],
  restart: [
    '##.....##',
    '##....###',
    '##...####',
    '##..#####',
    '##.######',
    '##..#####',
    '##...####',
    '##....###',
    '##.....##',
  ],
  flights: [
    '###.###.###',
    '###.###.###',
    '###.###.###',
    '...........',
    '###.###.###',
    '###.###.###',
    '###.###.###',
    '...........',
    '###.###.###',
    '###.###.###',
    '###.###.###',
  ],
  sound: [
    '...######',
    '...######',
    '...#....#',
    '...#....#',
    '...#....#',
    '...#....#',
    '.###..###',
    '####.####',
    '####.####',
    '.##...##.',
  ],
  info: [
    '.###.',
    '.###.',
    '.....',
    '####.',
    '.###.',
    '.###.',
    '.###.',
    '.###.',
    '#####',
  ],
  wait: [
    '##.##.##',
    '##.##.##',
  ],
  // A won star (Skyline Invaders' best result). An unwon one is the same
  // star in a solid darker colour, never a faded one.
  star: [
    '....#....',
    '....#....',
    '...###...',
    '#########',
    '.#######.',
    '..#####..',
    '..##.##..',
    '.##...##.',
    '.#.....#.',
  ],
  // The "more" button: sound and settings.
  more: [
    '###..###..###',
    '###..###..###',
    '###..###..###',
  ],
  rider: [
    '...###...',
    '..#####..',
    '..#####..',
    '..#####..',
    '...###...',
    '.........',
    '.#######.',
    '#########',
    '#########',
  ],
  pointer: [
    '...#',
    '..##',
    '.###',
    '####',
    '.###',
    '..##',
    '...#',
  ],
  cursor: [
    '##....',
    '####..',
    '######',
    '####..',
    '##....',
  ],
  // Small arrows for the in-scene callouts (drawn at the scene's own grain).
  drop: [
    '..###..',
    '..###..',
    '..###..',
    '#######',
    '.#####.',
    '..###..',
    '...#...',
  ],
  fire: [
    '...#...',
    '...##..',
    '######.',
    '#######',
    '######.',
    '...##..',
    '...#...',
  ],
  dash: [
    '#..#...',
    '##.##..',
    '.##.##.',
    '..##.##',
    '.##.##.',
    '##.##..',
    '#..#...',
  ],
});
const mirror = (rows) => rows.map((row) => [...row].reverse().join(''));
const ALL = Object.freeze({ ...BITMAPS, left: mirror(BITMAPS.right) });

// The control model names its buttons with text symbols; this is the same list
// as pictures. An unknown symbol is shown as the text it is.
const BY_SYMBOL = Object.freeze({
  'ϟ': 'bolt', '●': 'rider', '➤': 'missile', '»': 'boost', '←': 'left', '→': 'right', '×': 'cross', '✓': 'check',
  '▦': 'flights', '♫': 'sound', '↻': 'retry', '⟲': 'restart', 'ⓘ': 'info', '—': 'wait', '⋯': 'more',
});
export const iconForSymbol = (symbol) => BY_SYMBOL[symbol] || null;

function runs(rows, wanted) {
  let d = '';
  rows.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x += 1) {
      const on = x < row.length && wanted(x, y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) { d += `M${start} ${y}h${x - start}v1h${start - x}z`; start = -1; }
    }
  });
  return d;
}

const compiled = new Map();
function compile(name) {
  if (compiled.has(name)) return compiled.get(name);
  const source = ALL[name];
  if (!source) return null;
  const width = Math.max(...source.map((row) => row.length));
  // One empty pixel all round, so the outline has somewhere to go.
  const rows = ['', ...source, ''].map((row) => `.${row.padEnd(width, '.')}.`);
  const at = (x, y) => rows[y]?.[x] || '.';
  // Empty pixels the outside can reach; any other empty pixel is a hole in the
  // shape (the gap inside a ring) and is inked, so the scene never shows through.
  const outside = new Set(); const queue = [[0, 0]];
  while (queue.length) {
    const [x, y] = queue.pop(); const key = `${x},${y}`;
    if (x < 0 || y < 0 || y >= rows.length || x >= width + 2 || outside.has(key) || at(x, y) !== '.') continue;
    outside.add(key); queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const filled = (x, y) => at(x, y) !== '.';
  const result = {
    width: width + 2, height: rows.length,
    body: runs(rows, (x, y) => at(x, y) === '#'),
    lit: runs(rows, (x, y) => at(x, y) === 'o'),
    ink: runs(rows, (x, y) => !filled(x, y) && (!outside.has(`${x},${y}`) || filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))),
  };
  compiled.set(name, result);
  return result;
}

/**
 * One icon. In HTML it sizes itself from `--sg-icon-px` (the size of one of its
 * pixels); inside the flight scene pass `x`, `y` and `px` in scene units.
 */
export function PixelIcon({ name, x, y, px, className = '' }) {
  const icon = compile(name);
  if (!icon) return null;
  const placed = px != null;
  return <svg className={`sg-icon${placed ? '' : ' sg-icon--inline'} ${className}`.trim()} data-icon={name} aria-hidden="true" focusable="false"
    viewBox={`0 0 ${icon.width} ${icon.height}`} shapeRendering="crispEdges"
    {...(placed ? { x, y, width: icon.width * px, height: icon.height * px } : { style: { '--w': icon.width, '--h': icon.height } })}>
    <path className="sg-icon__ink" d={icon.ink}/>
    <path className="sg-icon__body" d={icon.body}/>
    {icon.lit && <path className="sg-icon__lit" d={icon.lit}/>}
  </svg>;
}
export const iconSize = (name, px = 1) => { const icon = compile(name); return icon ? { width: icon.width * px, height: icon.height * px } : { width: 0, height: 0 }; };

/**
 * The four bike buttons as a 2×2 block with one lit: which button to press,
 * shown the way the buttons sit on the handlebar (1 2 over 3 4).
 */
export function PadGlyph({ position, x, y, px, className = '' }) {
  const placed = px != null;
  return <svg className={`sg-pad${placed ? '' : ' sg-pad--inline'} ${className}`.trim()} data-button={position} aria-hidden="true" focusable="false"
    viewBox="0 0 9 9" shapeRendering="crispEdges"
    {...(placed ? { x, y, width: 9 * px, height: 9 * px } : {})}>
    <rect className="sg-pad__case" width="9" height="9"/>
    {[1, 2, 3, 4].map((slot) => <rect key={slot} className="sg-pad__key" data-slot={slot} data-lit={slot === position ? 'true' : 'false'}
      x={slot % 2 ? 1 : 5} y={slot < 3 ? 1 : 5} width="3" height="3"/>)}
  </svg>;
}
