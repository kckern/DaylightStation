// Original pixel art for Skyline Invaders: things that fall on a city at night.
// Drawn for this game; not derived from any arcade game and not shared with
// the piano's grids. Rows are strings, '#' = filled, '.' = empty, and every
// sprite takes its colour from CSS `color` (PixelSprite fills currentColor).
//
// The scene reaches these only through threatArt()/cannonArt(), so a skin
// export can replace them later without touching a component.
//
// Each threat is told apart by outline alone, before colour:
//   meteor  a burning rock: a narrow flame above a notched, cratered base
//   drone   two rotors far apart on a thin frame, a small cabin and skids below
//   pod     a round capsule cut in two by a seam
//   bomber  a flat wing with a fin at each tip, the widest shape in the sky
// The tests count differing cells to hold them apart from each other and from
// the classic arcade shapes.

export const SPRITE_GRID = Object.freeze({ columns: 11, rows: 8 });
/** Scene units per art pixel for an 11 x 8 threat drawn at 44 x 32. */
export const SPRITE_PIXEL = 4;

const sprite = (...frames) => Object.freeze({ frames: Object.freeze(frames.map((rows) => Object.freeze(rows))) });

export const INVADER_SPRITES = Object.freeze({
  // Sparks jump from side to side of the flame; the rock does not change.
  meteor: sprite(
    [
      '.....#.....',
      '...#.##....',
      '....###..#.',
      '...#####...',
      '..#######..',
      '.####.####.',
      '..########.',
      '...##.###..',
    ],
    [
      '.....#.....',
      '.....##.#..',
      '..#.###....',
      '...#####...',
      '..#######..',
      '.####.####.',
      '..########.',
      '...##.###..',
    ],
  ),
  // Rotors spin: each blade is seen flat, then as two tips.
  drone: sprite(
    [
      '###.....###',
      '.#.......#.',
      '.#########.',
      '....###....',
      '...##.##...',
      '...#####...',
      '...#...#...',
      '..##...##..',
    ],
    [
      '#.#.....#.#',
      '.#.......#.',
      '.#########.',
      '....###....',
      '...##.##...',
      '...#####...',
      '...#...#...',
      '..##...##..',
    ],
  ),
  // Lights run along the seam where the shell will split.
  pod: sprite(
    [
      '....###....',
      '..#######..',
      '.#########.',
      '.#########.',
      '.#.......#.',
      '.#########.',
      '..#######..',
      '....###....',
    ],
    [
      '....###....',
      '..#######..',
      '.#########.',
      '.#########.',
      '.#.##.##.#.',
      '.#########.',
      '..#######..',
      '....###....',
    ],
  ),
  // The bay opens in the belly and a bomb shows under it.
  bomber: sprite(
    [
      '...........',
      '...........',
      '#...###...#',
      '###########',
      '###########',
      '.#.#####.#.',
      '....###....',
      '...........',
    ],
    [
      '...........',
      '...........',
      '#...###...#',
      '###########',
      '###########',
      '.#.##.##.#.',
      '....#.#....',
      '.....#.....',
    ],
  ),
  // 4 x 5: tail fins up, nose down.
  bomb: sprite(['#..#', '.##.', '####', '####', '.##.']),
  // One barrel with a muzzle brake, on a rooftop mount. The shot leaves from
  // the centre column, which is the aim line.
  cannon: sprite([
    '....###....',
    '.....#.....',
    '.....#.....',
    '....###....',
    '..#######..',
    '.##.###.##.',
    '.#########.',
    '###.###.###',
  ]),
  // 9 x 7: a tower with a mast and a lower annex; windows are the gaps.
  building: sprite([
    '..#......',
    '.####....',
    '.#.##.###',
    '.####.#.#',
    '##.######',
    '####.##.#',
    '#########',
  ]),
  rubble: sprite([
    '.........',
    '.........',
    '.........',
    '.#.......',
    '.##...#..',
    '###.#.##.',
    '#########',
  ]),
});
