/**
 * Side-Scroller Engine — Pure functions, no React
 *
 * Chrome-dino-style game logic. All coordinates are normalized 0-1.
 * Y-axis: 0 = top of screen, 1 = bottom.
 *
 * State shape (world):
 * {
 *   obstacles: [],        // array of obstacle objects
 *   worldPos: 0,          // total distance scrolled
 *   score: 0,
 *   health: TOTAL_HEALTH,
 *   playerState: 'running' | 'jumping' | 'ducking',
 *   playerY: GROUND_Y,   // player feet position (Y coordinate)
 *   jumpT: 0,            // jump progress 0..1
 *   invincibleUntil: 0,  // timestamp until which player is invincible
 *   dodgeCount: 0,       // number of obstacles successfully dodged
 * }
 *
 * Obstacle shape:
 * {
 *   type: 'low' | 'high',
 *   x: number,           // left edge, normalized
 *   y: number,           // top edge, normalized
 *   width: number,
 *   height: number,
 *   hit: boolean,         // true if player already collided with it
 *   dodged: boolean,      // true if player successfully passed it
 * }
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
export const JUMP_HEIGHT = 0.25;

// ─── World Creation ─────────────────────────────────────────────

/**
 * Create the initial world state.
 * @param {object} config - Optional overrides (e.g. { health: 20 })
 */
export function createInitialWorld(config = {}) {
  return {
    obstacles: [],
    worldPos: 0,
    score: 0,
    health: config.health ?? TOTAL_HEALTH,
    playerState: 'running',
    playerY: GROUND_Y,
    jumpT: 0,
    invincibleUntil: 0,
    dodgeCount: 0,
  };
}

// ─── Obstacle Spawning ──────────────────────────────────────────

/**
 * Spawn a new obstacle at the right edge of the screen.
 * Does NOT mutate the original world.
 *
 * @param {object} world - Current world state
 * @param {'low'|'high'} type - Obstacle type
 * @returns {object} New world with the obstacle appended
 */
export function spawnObstacle(world, type) {
  const width = 0.04 + Math.random() * 0.02;
  let y, height;

  if (type === OBSTACLE_LOW) {
    height = 0.10;
    y = GROUND_Y - height;
  } else {
    // high obstacle floats at head height
    height = 0.05;
    y = GROUND_Y - PLAYER_HEIGHT - 0.02;
  }

  const obstacle = {
    type,
    x: 1.05,
    y,
    width,
    height,
    hit: false,
    dodged: false,
  };

  return {
    ...world,
    obstacles: [...world.obstacles, obstacle],
  };
}

// ─── World Tick ─────────────────────────────────────────────────

/**
 * Advance the world by dt seconds.
 * Moves obstacles left, removes off-screen ones, marks dodged obstacles,
 * advances worldPos, and increments score.
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

  return {
    ...world,
    obstacles,
    worldPos: world.worldPos + shift,
    score: world.score + scrollSpeed * dt * 10,
    dodgeCount,
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
export function applyDuck(world) {
  if (world.playerState === 'jumping') return world;
  return {
    ...world,
    playerState: 'ducking',
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
 * Skips obstacles that are already hit or dodged.
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
