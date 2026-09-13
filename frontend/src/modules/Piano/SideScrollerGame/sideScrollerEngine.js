/**
 * Side-Scroller Engine — Pure functions, no React
 *
 * Chrome-dino-style game logic. All coordinates are normalized 0-1.
 * Y-axis: 0 = top of screen, 1 = bottom.
 *
 * State shape (world):
 * {
 *   obstacles: [],        // array of obstacle objects
 *   projectiles: [],      // buster pellets in flight
 *   worldPos: 0,          // total distance scrolled
 *   score: 0,
 *   health: TOTAL_HEALTH,
 *   playerState: 'running' | 'jumping' | 'ducking',
 *   playerY: GROUND_Y,   // player feet position (Y coordinate)
 *   jumpT: 0,            // jump progress 0..1
 *   duckStartT: 0,       // timestamp when duck started (0 = not ducking)
 *   invincibleUntil: 0,  // timestamp until which player is invincible
 *   shootUntil: 0,       // timestamp until which the shooting pose holds
 *   dodgeCount: 0,       // number of obstacles cleared (passed or shot down)
 *   blockHits: 0,        // pellets that struck a block
 *   blocksBroken: 0,     // blocks shot down
 *   nextId: 1,           // id source for obstacles and pellets
 * }
 *
 * Obstacle shape:
 * {
 *   id: number,          // stable across removals (render key)
 *   type: 'low' | 'high' | 'block' | 'block_hard',
 *   x: number,           // left edge, normalized
 *   y: number,           // top edge, normalized
 *   width: number,
 *   height: number,
 *   hit: boolean,         // true if player already collided with it
 *   dodged: boolean,      // true if player cleared it (passed or broke it)
 *   hp, maxHp: number,    // blocks only — pellets remaining to break it
 *   broken: boolean,      // blocks only — shot down
 * }
 *
 * Projectile shape: { id, x, y } — left/top edge, PELLET_WIDTH × PELLET_HEIGHT.
 */

// ─── Constants ──────────────────────────────────────────────────

export const TOTAL_HEALTH = 28;
export const GROUND_Y = 0.68;
export const PLAYER_X = 0.25;
export const PLAYER_HEIGHT = 0.18;
export const PLAYER_DUCK_HEIGHT = 0.09;
export const PLAYER_WIDTH = 0.04;
export const OBSTACLE_LOW = 'low';
export const OBSTACLE_HIGH = 'high';
export const OBSTACLE_BLOCK = 'block';
export const OBSTACLE_BLOCK_HARD = 'block_hard';
export const JUMP_HEIGHT = 0.25;
export const MAX_DUCK_MS = 800;

// A block floats in the middle band. Its top sits above the highest a jumping
// player's feet ever reach (GROUND_Y - JUMP_HEIGHT = 0.43) and its bottom below
// a ducking player's head (GROUND_Y - PLAYER_DUCK_HEIGHT = 0.59), so neither
// jumping nor ducking clears it — it has to be shot.
export const BLOCK_TOP = 0.38;
export const BLOCK_BOTTOM = 0.64;
export const BLOCK_HP = Object.freeze({ [OBSTACLE_BLOCK]: 1, [OBSTACLE_BLOCK_HARD]: 2 });
export const BLOCK_BREAK_SCORE = 50;

export const PELLET_SPEED = 1.6;      // screen widths per second — outruns any scroll
export const PELLET_WIDTH = 0.015;
export const PELLET_HEIGHT = 0.025;
export const BUSTER_HEIGHT = 0.10;    // pellet centre above the player's feet
export const SHOOT_POSE_MS = 250;

export const DEFAULT_OBSTACLE_MIX = Object.freeze({ [OBSTACLE_LOW]: 1, [OBSTACLE_HIGH]: 1 });
const OBSTACLE_TYPES = [OBSTACLE_LOW, OBSTACLE_HIGH, OBSTACLE_BLOCK, OBSTACLE_BLOCK_HARD];
const PELLET_EXIT_X = 1.05;

/** True for obstacle types that are cleared by shooting. */
export function isShootable(type) {
  return BLOCK_HP[type] !== undefined;
}

// ─── Obstacle Mix ───────────────────────────────────────────────

/**
 * Pick an obstacle type from a level's `obstacle_mix` weights
 * (e.g. `{ low: 1, high: 1, block: 1 }`). Unknown keys and non-positive weights
 * are ignored; an absent or empty mix falls back to low/high evenly.
 *
 * @param {object} [mix]
 * @param {() => number} [random]
 * @returns {string} obstacle type
 */
export function pickObstacleType(mix, random = Math.random) {
  const weighted = OBSTACLE_TYPES
    .map((type) => [type, Number(mix?.[type]) || 0])
    .filter(([, weight]) => weight > 0);
  const pool = weighted.length > 0 ? weighted : Object.entries(DEFAULT_OBSTACLE_MIX);
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let r = random() * total;
  for (const [type, weight] of pool) {
    if (r < weight) return type;
    r -= weight;
  }
  return pool[pool.length - 1][0];
}

/** True when a level's mix can spawn something that must be shot. */
export function mixIncludesShootable(mix) {
  return OBSTACLE_TYPES.some((type) => isShootable(type) && Number(mix?.[type]) > 0);
}

// ─── World Creation ─────────────────────────────────────────────

/**
 * Create the initial world state.
 * @param {object} config - Optional overrides (e.g. { health: 20 })
 */
export function createInitialWorld(config = {}) {
  return {
    obstacles: [],
    projectiles: [],
    worldPos: 0,
    score: 0,
    health: config.health ?? TOTAL_HEALTH,
    playerState: 'running',
    playerY: GROUND_Y,
    jumpT: 0,
    duckStartT: 0,
    invincibleUntil: 0,
    shootUntil: 0,
    dodgeCount: 0,
    blockHits: 0,
    blocksBroken: 0,
    nextId: 1,
  };
}

// ─── Obstacle Spawning ──────────────────────────────────────────

/**
 * Spawn a new obstacle at the right edge of the screen.
 * Does NOT mutate the original world.
 *
 * @param {object} world - Current world state
 * @param {'low'|'high'|'block'|'block_hard'} type - Obstacle type
 * @returns {object} New world with the obstacle appended
 */
export function spawnObstacle(world, type) {
  const width = 0.04 + Math.random() * 0.02;
  const id = world.nextId ?? 1;
  let y, height;
  const extra = {};

  if (type === OBSTACLE_LOW) {
    height = 0.10;
    y = GROUND_Y - height;
  } else if (isShootable(type)) {
    y = BLOCK_TOP;
    height = BLOCK_BOTTOM - BLOCK_TOP;
    extra.hp = BLOCK_HP[type];
    extra.maxHp = BLOCK_HP[type];
    extra.broken = false;
  } else {
    // Tall pillar — unjumpable, must duck to clear
    // Bottom baseline at GROUND_Y - PLAYER_HEIGHT + 0.02 = 0.52
    // Top at 0.30 — clears the jump staff zone (ends at 30%)
    // Still unjumpable: player bottom at peak = 0.43 > 0.30
    height = 0.22;
    y = GROUND_Y - PLAYER_HEIGHT + 0.02 - height;
  }

  const obstacle = {
    id,
    type,
    x: 1.05,
    y,
    width,
    height,
    hit: false,
    dodged: false,
    ...extra,
  };

  return {
    ...world,
    obstacles: [...world.obstacles, obstacle],
    nextId: id + 1,
  };
}

// ─── World Tick ─────────────────────────────────────────────────

/**
 * Index of the block a pellet strikes this frame, or -1. The test sweeps both
 * bodies across the frame (pellet rightward from its old x, block leftward from
 * its old x) so a low frame rate cannot tunnel a pellet through a thin block.
 * The nearest (leftmost) eligible block wins.
 */
function findPelletTarget(obstacles, pellet, newX, shift) {
  const sweepStart = pellet.x;
  const sweepEnd = newX + PELLET_WIDTH;
  const top = pellet.y;
  const bottom = pellet.y + PELLET_HEIGHT;
  let best = -1;

  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    if (!isShootable(ob.type) || ob.broken || ob.hit || ob.dodged) continue;
    const overlapX = sweepStart < ob.x + shift + ob.width && sweepEnd > ob.x;
    const overlapY = top < ob.y + ob.height && bottom > ob.y;
    if (overlapX && overlapY && (best < 0 || ob.x < obstacles[best].x)) best = i;
  }

  return best;
}

/**
 * Advance the world by dt seconds.
 * Moves obstacles left, removes off-screen ones, marks dodged obstacles,
 * flies pellets and resolves their block hits, advances worldPos, and
 * increments score.
 *
 * Does NOT mutate the original world.
 *
 * @param {object} world - Current world state
 * @param {number} dt - Delta time in seconds
 * @param {number} scrollSpeed - Current scroll speed multiplier
 * @returns {object} New world state
 */
export function tickWorld(world, dt, scrollSpeed) {
  const shift = scrollSpeed * 0.08 * dt;
  let dodgeCount = world.dodgeCount;
  let score = world.score + scrollSpeed * dt * 10;
  let blockHits = world.blockHits ?? 0;
  let blocksBroken = world.blocksBroken ?? 0;

  // Move obstacles and apply dodge/removal
  const obstacles = [];
  for (const obs of world.obstacles) {
    const newX = obs.x - shift;

    // Remove obstacles fully past left edge
    if (newX + obs.width < 0) continue;

    // Check if right edge has passed PLAYER_X (newly dodged)
    const rightEdge = newX + obs.width;
    const wasPastPlayer = obs.x + obs.width < PLAYER_X;
    const nowPastPlayer = rightEdge < PLAYER_X;
    const newlyDodged = !obs.dodged && !obs.hit && !wasPastPlayer && nowPastPlayer;

    if (newlyDodged) {
      dodgeCount++;
    }

    obstacles.push({
      ...obs,
      x: newX,
      dodged: obs.dodged || newlyDodged,
    });
  }

  // Fly pellets; a pellet that strikes a block is consumed
  const travel = PELLET_SPEED * dt;
  const projectiles = [];
  for (const pellet of world.projectiles ?? []) {
    const newX = pellet.x + travel;
    const target = findPelletTarget(obstacles, pellet, newX, shift);

    if (target >= 0) {
      const block = obstacles[target];
      const hp = block.hp - 1;
      blockHits++;
      if (hp <= 0) {
        // Shot down: stops colliding and counts as cleared, like a dodge.
        obstacles[target] = { ...block, hp: 0, broken: true, dodged: true };
        dodgeCount++;
        blocksBroken++;
        score += BLOCK_BREAK_SCORE;
      } else {
        obstacles[target] = { ...block, hp };
      }
      continue;
    }

    if (newX > PELLET_EXIT_X) continue;
    projectiles.push({ ...pellet, x: newX });
  }

  return {
    ...world,
    obstacles,
    projectiles,
    worldPos: world.worldPos + shift,
    score,
    dodgeCount,
    blockHits,
    blocksBroken,
  };
}

// ─── Jump ───────────────────────────────────────────────────────

/**
 * Initiate a jump. No-op if already jumping.
 * @param {object} world
 * @returns {object} New world (or same reference if no-op)
 */
export function applyJump(world) {
  if (world.playerState === 'jumping') return world;
  return {
    ...world,
    playerState: 'jumping',
    jumpT: 0,
  };
}

/**
 * Advance jump arc. No-op if not jumping.
 *
 * Parabolic arc: arcOffset = -4 * JUMP_HEIGHT * t * (t - 1)
 * playerY = GROUND_Y - arcOffset
 *
 * When t >= 1, returns to running state.
 *
 * @param {object} world
 * @param {number} dt - Delta time in seconds
 * @param {number} jumpDurationMs - Total jump duration in milliseconds
 * @returns {object} New world (or same reference if no-op)
 */
export function updateJump(world, dt, jumpDurationMs) {
  if (world.playerState !== 'jumping') return world;

  const dtMs = dt * 1000;
  const newT = world.jumpT + dtMs / jumpDurationMs;

  if (newT >= 1) {
    return {
      ...world,
      playerState: 'running',
      playerY: GROUND_Y,
      jumpT: 0,
    };
  }

  const arcOffset = -4 * JUMP_HEIGHT * newT * (newT - 1);
  return {
    ...world,
    jumpT: newT,
    playerY: GROUND_Y - arcOffset,
  };
}

// ─── Duck ───────────────────────────────────────────────────────

/**
 * Start ducking. No-op if jumping.
 * @param {object} world
 * @returns {object} New world (or same reference if no-op)
 */
export function applyDuck(world, now) {
  if (world.playerState === 'jumping') return world;
  return {
    ...world,
    playerState: 'ducking',
    duckStartT: now,
  };
}

/**
 * Release duck (return to running). No-op if not ducking.
 * @param {object} world
 * @returns {object} New world (or same reference if no-op)
 */
export function releaseDuck(world) {
  if (world.playerState !== 'ducking') return world;
  return {
    ...world,
    playerState: 'running',
    duckStartT: 0,
  };
}

/**
 * Auto-release duck if time limit exceeded.
 * @param {object} world
 * @param {number} now - Current timestamp (ms)
 * @param {number} maxDuckMs - Maximum duck duration
 * @returns {object} New world (or same reference if no-op)
 */
export function updateDuck(world, now, maxDuckMs) {
  if (world.playerState !== 'ducking') return world;
  if (now - world.duckStartT >= maxDuckMs) {
    return {
      ...world,
      playerState: 'running',
      duckStartT: 0,
    };
  }
  return world;
}

// ─── Shoot ──────────────────────────────────────────────────────

/**
 * Fire one pellet from the buster and hold the shooting pose. No-op while
 * ducking — there is no slide-shot. Mid-jump shots are allowed; they simply fly
 * above a block.
 *
 * @param {object} world
 * @param {number} now - Current timestamp (ms)
 * @returns {object} New world (or same reference if no-op)
 */
export function applyShoot(world, now) {
  if (world.playerState === 'ducking') return world;
  const id = world.nextId ?? 1;
  const pellet = {
    id,
    x: PLAYER_X + PLAYER_WIDTH,
    y: world.playerY - BUSTER_HEIGHT - PELLET_HEIGHT / 2,
  };
  return {
    ...world,
    projectiles: [...(world.projectiles ?? []), pellet],
    shootUntil: now + SHOOT_POSE_MS,
    nextId: id + 1,
  };
}

// ─── Hitbox & Collision ─────────────────────────────────────────

/**
 * Get the player's axis-aligned bounding box.
 * Height depends on ducking state.
 *
 * @param {object} world
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function getPlayerHitbox(world) {
  const h = world.playerState === 'ducking' ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
  return {
    x: PLAYER_X,
    y: world.playerY - h,
    width: PLAYER_WIDTH,
    height: h,
  };
}

/**
 * Check for AABB collisions between the player and obstacles.
 * Skips obstacles that are already hit or dodged (a broken block is dodged).
 *
 * @param {object} world
 * @returns {object[]} Array of obstacle objects that overlap the player
 */
export function checkCollisions(world) {
  const hb = getPlayerHitbox(world);
  const collisions = [];

  for (const obs of world.obstacles) {
    if (obs.hit || obs.dodged) continue;

    // AABB overlap test
    const overlapX = hb.x < obs.x + obs.width && hb.x + hb.width > obs.x;
    const overlapY = hb.y < obs.y + obs.height && hb.y + hb.height > obs.y;

    if (overlapX && overlapY) {
      collisions.push(obs);
    }
  }

  return collisions;
}

// ─── Damage & Healing ───────────────────────────────────────────

/**
 * Apply damage to the player. Skips if currently invincible.
 * Marks obstacles at hitIndices as hit. Does NOT mutate.
 *
 * @param {object} world
 * @param {number} damagePerHit
 * @param {number} invincibilityMs
 * @param {number} now - Current timestamp (ms)
 * @param {number[]} hitIndices - Indices into world.obstacles to mark as hit
 * @returns {object} New world state
 */
export function applyDamage(world, damagePerHit, invincibilityMs, now, hitIndices = []) {
  if (now < world.invincibleUntil) return world;

  const obstacles = world.obstacles.map((obs, i) => {
    if (hitIndices.includes(i)) {
      return { ...obs, hit: true };
    }
    return obs;
  });

  return {
    ...world,
    health: Math.max(0, world.health - damagePerHit),
    invincibleUntil: now + invincibilityMs,
    obstacles,
  };
}

/**
 * Heal the player. Caps at TOTAL_HEALTH.
 * Does NOT mutate.
 *
 * @param {object} world
 * @param {number} healAmount
 * @returns {object} New world state
 */
export function applyHeal(world, healAmount) {
  return {
    ...world,
    health: Math.min(TOTAL_HEALTH, world.health + healAmount),
  };
}

// ─── Level Evaluation ───────────────────────────────────────────

/**
 * Evaluate whether the current level is won, lost, or still in progress.
 *
 * @param {object} world
 * @param {object} levelConfig - Must have { score_to_advance: number }
 * @returns {'fail'|'advance'|null}
 */
export function evaluateLevel(world, levelConfig) {
  if (world.health <= 0) return 'fail';
  if (world.score >= levelConfig.score_to_advance) return 'advance';
  return null;
}
