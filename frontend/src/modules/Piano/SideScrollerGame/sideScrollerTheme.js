/**
 * Theme resolution for the side-scroller game.
 *
 * The renderer is generic: all visuals (sprite sheet, pellet, obstacle skins,
 * explosion, background, ground) and sound effects come from a `theme` block on
 * the per-game config (`config.games['side-scroller'].theme`), which lives in
 * the household piano YAML in the data dir — not the repo. DEFAULT_THEME
 * reproduces the Mega Man + procedural-CSS look so an absent/empty theme is a
 * no-op. See docs/plans/2026-06-24-side-scroller-theme-config-design.md.
 */

// Original appearance, encoded as the fallback theme. The legacy source is
// served through the approved gaming-asset catalog, not the generic static
// image directory.
export const DEFAULT_THEME = {
  player: {
    src: '/api/v1/presentation/catalogs/side-scroller/assets/player.megaman/image',
    grid: { cols: 5, rows: 6 },
    displaySize: 144,
    // pose → [col, row] (0-indexed); nested array = animation cycle
    frames: {
      stand: [0, 0],
      jump: [4, 0],
      duck: [0, 3],
      hit: [[1, 3], [2, 3]],
      run: [[0, 1], [1, 1], [2, 1], [3, 1]],
      shoot: [4, 1],
      shootRun: [[1, 2], [2, 2], [3, 2], [4, 2]],
      shootJump: [0, 2],
    },
  },
  // The buster pellet. A null src/grid reuses the player sheet.
  projectile: {
    src: null,
    grid: null,
    frame: [2, 4],
    displaySize: 144,
  },
  obstacles: {
    // Procedural CSS fallback (matches the original gradients).
    low: { src: null, fill: ['#cc3333', '#991a1a'], border: '#ff6666' },
    high: { src: null, fill: ['#3366cc', '#1a3399'], border: '#6699ff' },
    // Shootable blocks. `pattern` draws mortar/rivets over a procedural skin.
    block: { src: null, fill: ['#c8742c', '#8a4a17'], border: '#f0a060', pattern: 'brick' },
    block_hard: { src: null, fill: ['#9aa3ad', '#5b636c'], border: '#d7dde3', pattern: 'steel' },
  },
  // Death burst: orbs radiating from where the player stood.
  explosion: {
    core: '#ffffff',
    ring: '#9eeaff',
    edge: '#1f6fff',
    size: 34,
  },
  background: {
    src: null,
    color: 'linear-gradient(180deg, #0c0c1e 0%, #141432 60%, #1a1a3a 100%)',
  },
  ground: { color: 'rgba(100, 200, 255, 0.5)' },
  // All null by default; a null path is a silent no-op.
  sounds: {
    jump: null,
    duck: null,
    shoot: null,
    hit: null,
    death: null,
    dodge: null,
    levelup: null,
    gameover: null,
    start: null,
  },
};

/**
 * Convert a [col, row] cell into a CSS `background-position` string for a sheet
 * sized `background-size: cols*100% rows*100%`. With N columns the valid
 * positions are 0/(N-1)..(N-1)/(N-1) → 0%..100%. Guards single-cell grids.
 */
export function frameToPosition([col, row], grid) {
  const cols = grid?.cols ?? 1;
  const rows = grid?.rows ?? 1;
  const x = cols > 1 ? (col / (cols - 1)) * 100 : 0;
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  return `${x}% ${y}%`;
}

function mergePiece(base, override) {
  if (!override) return { ...base };
  return { ...base, ...override };
}

/**
 * Deep-merge `gameConfig.theme` over DEFAULT_THEME, per piece. A config can
 * override just `player.src` and keep the default grid/frames/obstacles/etc.
 */
export function resolveTheme(gameConfig) {
  const t = gameConfig?.theme ?? {};
  return {
    player: mergePiece(DEFAULT_THEME.player, t.player),
    projectile: mergePiece(DEFAULT_THEME.projectile, t.projectile),
    obstacles: {
      low: mergePiece(DEFAULT_THEME.obstacles.low, t.obstacles?.low),
      high: mergePiece(DEFAULT_THEME.obstacles.high, t.obstacles?.high),
      block: mergePiece(DEFAULT_THEME.obstacles.block, t.obstacles?.block),
      block_hard: mergePiece(DEFAULT_THEME.obstacles.block_hard, t.obstacles?.block_hard),
    },
    explosion: mergePiece(DEFAULT_THEME.explosion, t.explosion),
    background: mergePiece(DEFAULT_THEME.background, t.background),
    ground: mergePiece(DEFAULT_THEME.ground, t.ground),
    sounds: mergePiece(DEFAULT_THEME.sounds, t.sounds),
  };
}

/**
 * A frame entry is either one cell ([col, row]) or a cycle of cells. Cycles
 * advance by world position, so their speed tracks the scroll.
 */
function cellAt(entry, worldPos) {
  if (!Array.isArray(entry?.[0])) return entry;
  return entry[Math.floor((worldPos * 32) % entry.length)];
}

/**
 * Resolve the player sprite frame (as a background-position) for the current
 * state. Cycle lengths come from the theme's arrays, not hardcoded values. A
 * theme without shooting frames keeps its plain poses while shooting.
 */
export function getSpriteFrame(state, worldPos, { idle, invincible, shooting } = {}, theme) {
  const { frames, grid } = theme.player;
  const pick = (entry) => frameToPosition(cellAt(entry, worldPos), grid);
  if (idle) return pick(frames.stand);
  if (invincible) return pick(frames.hit);
  if (state === 'jumping') return pick(shooting && frames.shootJump ? frames.shootJump : frames.jump);
  if (state === 'ducking') return pick(frames.duck);
  return pick(shooting && frames.shootRun ? frames.shootRun : frames.run);
}
