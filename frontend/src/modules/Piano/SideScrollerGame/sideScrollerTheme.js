/**
 * Theme resolution for the side-scroller game.
 *
 * The renderer is generic: all visuals (sprite sheet, obstacle skins,
 * background, ground) and sound effects come from a `theme` block on the
 * per-game config (`config.games['side-scroller'].theme`), which lives in the
 * household piano YAML in the data dir — not the repo. DEFAULT_THEME reproduces
 * the original Mega Man + procedural-CSS look so an absent/empty theme is a
 * no-op. See docs/plans/2026-06-24-side-scroller-theme-config-design.md.
 */

// Original appearance, encoded as the fallback theme. Player sprite points at
// the data-dir static asset (NOT a committed repo copy).
export const DEFAULT_THEME = {
  player: {
    src: '/api/v1/static/img/sprites/megaman-sprites.png',
    grid: { cols: 5, rows: 6 },
    displaySize: 144,
    // pose → [col, row] (0-indexed); nested array = animation cycle
    frames: {
      stand: [0, 0],
      jump: [4, 0],
      duck: [0, 3],
      hit: [2, 3],
      run: [[0, 1], [1, 1], [2, 1], [3, 1]],
    },
  },
  obstacles: {
    // Procedural CSS fallback (matches the original gradients).
    low: { src: null, fill: ['#cc3333', '#991a1a'], border: '#ff6666' },
    high: { src: null, fill: ['#3366cc', '#1a3399'], border: '#6699ff' },
  },
  background: {
    src: null,
    color: 'linear-gradient(180deg, #0c0c1e 0%, #141432 60%, #1a1a3a 100%)',
  },
  ground: { color: 'rgba(100, 200, 255, 0.5)' },
  // All null until real assets land; a null path is a silent no-op.
  sounds: {
    jump: null,
    duck: null,
    hit: null,
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
    obstacles: {
      low: mergePiece(DEFAULT_THEME.obstacles.low, t.obstacles?.low),
      high: mergePiece(DEFAULT_THEME.obstacles.high, t.obstacles?.high),
    },
    background: mergePiece(DEFAULT_THEME.background, t.background),
    ground: mergePiece(DEFAULT_THEME.ground, t.ground),
    sounds: mergePiece(DEFAULT_THEME.sounds, t.sounds),
  };
}

/**
 * Resolve the player sprite frame (as a background-position) for the current
 * state. Run frames cycle by world position; the cycle length comes from the
 * theme's `run` array, not a hardcoded value.
 */
export function getSpriteFrame(state, worldPos, { idle, invincible } = {}, theme) {
  const { frames, grid } = theme.player;
  if (idle) return frameToPosition(frames.stand, grid);
  if (invincible) return frameToPosition(frames.hit, grid);
  if (state === 'jumping') return frameToPosition(frames.jump, grid);
  if (state === 'ducking') return frameToPosition(frames.duck, grid);
  const run = frames.run;
  const frameIdx = Math.floor((worldPos * 32) % run.length);
  return frameToPosition(run[frameIdx], grid);
}
