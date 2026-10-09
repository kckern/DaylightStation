import { describe, it, expect } from 'vitest';
import {
  TOTAL_HEALTH,
  GROUND_Y,
  PLAYER_X,
  PLAYER_HEIGHT,
  PLAYER_DUCK_HEIGHT,
  PLAYER_WIDTH,
  OBSTACLE_LOW,
  OBSTACLE_HIGH,
  JUMP_HEIGHT,
  MAX_DUCK_MS,
  createInitialWorld,
  spawnObstacle,
  tickWorld,
  applyJump,
  updateJump,
  applyDuck,
  updateDuck,
  releaseDuck,
  getPlayerHitbox,
  checkCollisions,
  applyDamage,
  applyHeal,
  evaluateLevel,
  OBSTACLE_BLOCK,
  OBSTACLE_BLOCK_HARD,
  BLOCK_TOP,
  BLOCK_BOTTOM,
  BLOCK_BREAK_SCORE,
  PELLET_SPEED,
  SHOOT_POSE_MS,
  applyShoot,
  isShootable,
  pickObstacleType,
  mixIncludesShootable,
} from './sideScrollerEngine.js';

// ─── Constants ──────────────────────────────────────────────────

describe('constants', () => {
  it('exports expected constant values', () => {
    expect(TOTAL_HEALTH).toBe(28);
    expect(GROUND_Y).toBe(0.68);
    expect(PLAYER_X).toBe(0.25);
    expect(PLAYER_HEIGHT).toBe(0.18);
    expect(PLAYER_DUCK_HEIGHT).toBe(0.09);
    expect(PLAYER_WIDTH).toBe(0.04);
    expect(OBSTACLE_LOW).toBe('low');
    expect(OBSTACLE_HIGH).toBe('high');
    expect(JUMP_HEIGHT).toBe(0.25);
    expect(MAX_DUCK_MS).toBe(800);
  });
});

// ─── createInitialWorld ─────────────────────────────────────────

describe('createInitialWorld', () => {
  it('returns initial world state with defaults', () => {
    const world = createInitialWorld();
    expect(world).toEqual({
      obstacles: [],
      projectiles: [],
      worldPos: 0,
      score: 0,
      health: TOTAL_HEALTH,
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
    });
  });

  it('accepts config overrides for health', () => {
    const world = createInitialWorld({ health: 10 });
    expect(world.health).toBe(10);
  });

  it('uses TOTAL_HEALTH when config.health is undefined', () => {
    const world = createInitialWorld({});
    expect(world.health).toBe(TOTAL_HEALTH);
  });
});

// ─── spawnObstacle ──────────────────────────────────────────────

describe('spawnObstacle', () => {
  it('spawns a low obstacle at x=1.05 on the ground', () => {
    const world = createInitialWorld();
    const next = spawnObstacle(world, OBSTACLE_LOW);
    expect(next.obstacles.length).toBe(1);
    const obs = next.obstacles[0];
    expect(obs.type).toBe(OBSTACLE_LOW);
    expect(obs.x).toBe(1.05);
    expect(obs.hit).toBe(false);
    expect(obs.dodged).toBe(false);
    // Low obstacle sits on the ground: y = GROUND_Y - height
    expect(obs.height).toBeCloseTo(0.10, 1);
    expect(obs.y).toBeCloseTo(GROUND_Y - obs.height, 5);
  });

  it('spawns a high obstacle — unjumpable pillar', () => {
    const world = createInitialWorld();
    const next = spawnObstacle(world, OBSTACLE_HIGH);
    const obs = next.obstacles[0];
    expect(obs.type).toBe(OBSTACLE_HIGH);
    expect(obs.x).toBe(1.05);
    expect(obs.height).toBeCloseTo(0.22, 1);
    // Bottom baseline = GROUND_Y - PLAYER_HEIGHT + 0.02 = 0.52
    // y = bottom - height = 0.52 - 0.22 = 0.30
    expect(obs.y).toBeCloseTo(0.30, 2);
  });

  it('does NOT mutate the original world', () => {
    const world = createInitialWorld();
    const next = spawnObstacle(world, OBSTACLE_LOW);
    expect(world.obstacles.length).toBe(0);
    expect(next.obstacles.length).toBe(1);
    expect(next).not.toBe(world);
  });

  it('preserves existing obstacles when spawning', () => {
    const world = createInitialWorld();
    const w1 = spawnObstacle(world, OBSTACLE_LOW);
    const w2 = spawnObstacle(w1, OBSTACLE_HIGH);
    expect(w2.obstacles.length).toBe(2);
    expect(w2.obstacles[0].type).toBe(OBSTACLE_LOW);
    expect(w2.obstacles[1].type).toBe(OBSTACLE_HIGH);
  });

  it('obstacle width is between 0.04 and 0.06', () => {
    // Run multiple times to cover random range
    for (let i = 0; i < 20; i++) {
      const world = createInitialWorld();
      const next = spawnObstacle(world, OBSTACLE_LOW);
      const obs = next.obstacles[0];
      expect(obs.width).toBeGreaterThanOrEqual(0.04);
      expect(obs.width).toBeLessThanOrEqual(0.06);
    }
  });
});

// ─── tickWorld ──────────────────────────────────────────────────

describe('tickWorld', () => {
  it('moves obstacles leftward', () => {
    let world = createInitialWorld();
    world = spawnObstacle(world, OBSTACLE_LOW);
    const startX = world.obstacles[0].x;
    const dt = 1; // 1 second
    const scrollSpeed = 1;
    const ticked = tickWorld(world, dt, scrollSpeed);
    const expectedShift = scrollSpeed * 0.08 * dt;
    expect(ticked.obstacles[0].x).toBeCloseTo(startX - expectedShift, 5);
  });

  it('removes obstacles past left edge (x + width < 0)', () => {
    let world = createInitialWorld();
    world = {
      ...world,
      obstacles: [
        { type: OBSTACLE_LOW, x: -0.10, y: 0.65, width: 0.05, height: 0.10, hit: false, dodged: false },
      ],
    };
    const ticked = tickWorld(world, 0.1, 1);
    expect(ticked.obstacles.length).toBe(0);
  });

  it('marks obstacle as dodged when its right edge passes PLAYER_X', () => {
    const world = {
      ...createInitialWorld(),
      obstacles: [
        { type: OBSTACLE_LOW, x: 0.26, y: 0.65, width: 0.04, height: 0.10, hit: false, dodged: false },
      ],
    };
    // right edge = 0.26 + 0.04 = 0.30 > PLAYER_X(0.25) before tick
    // After tick: shift = 1 * 0.08 * 1 = 0.08, newX = 0.26 - 0.08 = 0.18
    // right edge = 0.18 + 0.04 = 0.22 < PLAYER_X(0.25)
    const ticked2 = tickWorld(world, 1, 1);
    expect(ticked2.obstacles[0].dodged).toBe(true);
    expect(ticked2.dodgeCount).toBe(1);
  });

  it('does not re-dodge already-dodged obstacles', () => {
    let world = {
      ...createInitialWorld(),
      dodgeCount: 3,
      obstacles: [
        { type: OBSTACLE_LOW, x: 0.05, y: 0.65, width: 0.04, height: 0.10, hit: false, dodged: true },
      ],
    };
    const ticked = tickWorld(world, 1, 1);
    expect(ticked.dodgeCount).toBe(3); // unchanged
  });

  it('advances worldPos', () => {
    const world = createInitialWorld();
    const dt = 0.5;
    const scrollSpeed = 2;
    const ticked = tickWorld(world, dt, scrollSpeed);
    const expectedShift = scrollSpeed * 0.08 * dt;
    expect(ticked.worldPos).toBeCloseTo(expectedShift, 5);
  });

  it('increments score', () => {
    const world = createInitialWorld();
    const dt = 1;
    const scrollSpeed = 5;
    const ticked = tickWorld(world, dt, scrollSpeed);
    expect(ticked.score).toBeCloseTo(scrollSpeed * dt * 10, 5);
  });

  it('does NOT mutate original world', () => {
    let world = createInitialWorld();
    world = spawnObstacle(world, OBSTACLE_LOW);
    const originalX = world.obstacles[0].x;
    tickWorld(world, 1, 1);
    expect(world.obstacles[0].x).toBe(originalX);
  });
});

// ─── applyJump ──────────────────────────────────────────────────

describe('applyJump', () => {
  it('sets playerState to jumping and jumpT to 0', () => {
    const world = createInitialWorld();
    const jumped = applyJump(world);
    expect(jumped.playerState).toBe('jumping');
    expect(jumped.jumpT).toBe(0);
  });

  it('is a no-op if already jumping', () => {
    const world = { ...createInitialWorld(), playerState: 'jumping', jumpT: 0.5 };
    const result = applyJump(world);
    expect(result.jumpT).toBe(0.5); // unchanged
    expect(result).toBe(world); // same reference (no-op)
  });

  it('does NOT mutate original world', () => {
    const world = createInitialWorld();
    applyJump(world);
    expect(world.playerState).toBe('running');
  });
});

// ─── updateJump ─────────────────────────────────────────────────

describe('updateJump', () => {
  it('advances jumpT toward 1', () => {
    const world = { ...createInitialWorld(), playerState: 'jumping', jumpT: 0 };
    const jumpDurationMs = 500;
    const dt = 0.1; // 100ms
    const updated = updateJump(world, dt, jumpDurationMs);
    expect(updated.jumpT).toBeCloseTo(0.2, 5); // 100 / 500 = 0.2
  });

  it('applies parabolic arc to playerY', () => {
    const world = { ...createInitialWorld(), playerState: 'jumping', jumpT: 0 };
    const jumpDurationMs = 500;
    // At t=0.5 (peak), arcOffset = -4 * 0.25 * 0.5 * (0.5 - 1) = -4 * 0.25 * 0.5 * -0.5 = 0.25
    // playerY = GROUND_Y - arcOffset = 0.68 - 0.25 = 0.43
    const dt = 0.25; // 250ms = half of 500ms
    const updated = updateJump(world, dt, jumpDurationMs);
    expect(updated.jumpT).toBeCloseTo(0.5, 5);
    const expectedArc = -4 * JUMP_HEIGHT * 0.5 * (0.5 - 1);
    expect(updated.playerY).toBeCloseTo(GROUND_Y - expectedArc, 5);
  });

  it('returns to running when jumpT reaches 1', () => {
    const world = { ...createInitialWorld(), playerState: 'jumping', jumpT: 0.9 };
    const jumpDurationMs = 500;
    const dt = 0.1; // 100ms, which advances jumpT by 0.2, taking it past 1.0
    const updated = updateJump(world, dt, jumpDurationMs);
    expect(updated.playerState).toBe('running');
    expect(updated.playerY).toBe(GROUND_Y);
    expect(updated.jumpT).toBe(0);
  });

  it('is a no-op if not jumping', () => {
    const world = createInitialWorld(); // playerState = 'running'
    const result = updateJump(world, 0.1, 500);
    expect(result).toBe(world);
  });

  it('does NOT mutate original world', () => {
    const world = { ...createInitialWorld(), playerState: 'jumping', jumpT: 0 };
    updateJump(world, 0.1, 500);
    expect(world.jumpT).toBe(0);
  });
});

// ─── applyDuck ──────────────────────────────────────────────────

describe('applyDuck', () => {
  it('sets playerState to ducking and records duckStartT', () => {
    const world = createInitialWorld();
    const ducked = applyDuck(world, 5000);
    expect(ducked.playerState).toBe('ducking');
    expect(ducked.duckStartT).toBe(5000);
  });

  it('is a no-op if jumping', () => {
    const world = { ...createInitialWorld(), playerState: 'jumping' };
    const result = applyDuck(world, 5000);
    expect(result).toBe(world);
  });

  it('does NOT mutate original world', () => {
    const world = createInitialWorld();
    applyDuck(world, 5000);
    expect(world.playerState).toBe('running');
  });
});

describe('updateDuck', () => {
  it('is a no-op if not ducking', () => {
    const world = createInitialWorld();
    const result = updateDuck(world, 5000, MAX_DUCK_MS);
    expect(result).toBe(world);
  });

  it('remains ducking if within time limit', () => {
    const world = { ...createInitialWorld(), playerState: 'ducking', duckStartT: 5000 };
    const result = updateDuck(world, 5500, MAX_DUCK_MS); // 500ms elapsed, limit 800ms
    expect(result.playerState).toBe('ducking');
  });

  it('auto-releases to running when time limit exceeded', () => {
    const world = { ...createInitialWorld(), playerState: 'ducking', duckStartT: 5000 };
    const result = updateDuck(world, 5800, MAX_DUCK_MS); // 800ms elapsed = limit
    expect(result.playerState).toBe('running');
    expect(result.duckStartT).toBe(0);
  });

  it('auto-releases when well past time limit', () => {
    const world = { ...createInitialWorld(), playerState: 'ducking', duckStartT: 1000 };
    const result = updateDuck(world, 5000, MAX_DUCK_MS); // 4000ms elapsed
    expect(result.playerState).toBe('running');
    expect(result.duckStartT).toBe(0);
  });

  it('does NOT mutate original world', () => {
    const world = { ...createInitialWorld(), playerState: 'ducking', duckStartT: 1000 };
    updateDuck(world, 5000, MAX_DUCK_MS);
    expect(world.playerState).toBe('ducking');
  });
});

// ─── releaseDuck ────────────────────────────────────────────────

describe('releaseDuck', () => {
  it('returns to running and resets duckStartT if ducking', () => {
    const world = { ...createInitialWorld(), playerState: 'ducking', duckStartT: 5000 };
    const released = releaseDuck(world);
    expect(released.playerState).toBe('running');
    expect(released.duckStartT).toBe(0);
  });

  it('is a no-op if not ducking', () => {
    const world = createInitialWorld(); // running
    const result = releaseDuck(world);
    expect(result).toBe(world);
  });

  it('is a no-op if jumping', () => {
    const world = { ...createInitialWorld(), playerState: 'jumping' };
    const result = releaseDuck(world);
    expect(result).toBe(world);
  });

  it('does NOT mutate original world', () => {
    const world = { ...createInitialWorld(), playerState: 'ducking' };
    releaseDuck(world);
    expect(world.playerState).toBe('ducking');
  });
});

// ─── getPlayerHitbox ────────────────────────────────────────────

describe('getPlayerHitbox', () => {
  it('returns standing hitbox when running', () => {
    const world = createInitialWorld();
    const hb = getPlayerHitbox(world);
    expect(hb).toEqual({
      x: PLAYER_X,
      y: GROUND_Y - PLAYER_HEIGHT,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
    });
  });

  it('returns shorter hitbox when ducking', () => {
    const world = { ...createInitialWorld(), playerState: 'ducking' };
    const hb = getPlayerHitbox(world);
    expect(hb).toEqual({
      x: PLAYER_X,
      y: GROUND_Y - PLAYER_DUCK_HEIGHT,
      width: PLAYER_WIDTH,
      height: PLAYER_DUCK_HEIGHT,
    });
  });

  it('uses current playerY for jumping hitbox', () => {
    const world = { ...createInitialWorld(), playerState: 'jumping', playerY: 0.50 };
    const hb = getPlayerHitbox(world);
    expect(hb).toEqual({
      x: PLAYER_X,
      y: 0.50 - PLAYER_HEIGHT,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
    });
  });
});

// ─── checkCollisions ────────────────────────────────────────────

describe('checkCollisions', () => {
  it('detects collision with overlapping obstacle', () => {
    const world = {
      ...createInitialWorld(),
      obstacles: [
        {
          type: OBSTACLE_LOW,
          x: PLAYER_X, // overlaps player horizontally
          y: GROUND_Y - 0.10, // overlaps player vertically
          width: 0.05,
          height: 0.10,
          hit: false,
          dodged: false,
        },
      ],
    };
    const hits = checkCollisions(world);
    expect(hits.length).toBe(1);
    expect(hits[0]).toBe(world.obstacles[0]);
  });

  it('skips obstacles already marked as hit', () => {
    const world = {
      ...createInitialWorld(),
      obstacles: [
        {
          type: OBSTACLE_LOW,
          x: PLAYER_X,
          y: GROUND_Y - 0.10,
          width: 0.05,
          height: 0.10,
          hit: true,
          dodged: false,
        },
      ],
    };
    const hits = checkCollisions(world);
    expect(hits.length).toBe(0);
  });

  it('skips obstacles marked as dodged', () => {
    const world = {
      ...createInitialWorld(),
      obstacles: [
        {
          type: OBSTACLE_LOW,
          x: PLAYER_X,
          y: GROUND_Y - 0.10,
          width: 0.05,
          height: 0.10,
          hit: false,
          dodged: true,
        },
      ],
    };
    const hits = checkCollisions(world);
    expect(hits.length).toBe(0);
  });

  it('returns empty array when no obstacles overlap', () => {
    const world = {
      ...createInitialWorld(),
      obstacles: [
        {
          type: OBSTACLE_LOW,
          x: 0.80, // far right, no overlap
          y: GROUND_Y - 0.10,
          width: 0.05,
          height: 0.10,
          hit: false,
          dodged: false,
        },
      ],
    };
    const hits = checkCollisions(world);
    expect(hits.length).toBe(0);
  });

  it('does not collide with high obstacle when ducking', () => {
    const world = {
      ...createInitialWorld(),
      playerState: 'ducking',
      obstacles: [
        {
          type: OBSTACLE_HIGH,
          x: PLAYER_X,
          y: 0.30,
          width: 0.05,
          height: 0.22,
          hit: false,
          dodged: false,
        },
      ],
    };
    const hits = checkCollisions(world);
    expect(hits.length).toBe(0);
  });

  it('does not collide with low obstacle when jumping high enough', () => {
    const world = {
      ...createInitialWorld(),
      playerState: 'jumping',
      playerY: 0.30, // jumping, feet at y=0.30, well above GROUND_Y
      obstacles: [
        {
          type: OBSTACLE_LOW,
          x: PLAYER_X,
          y: GROUND_Y - 0.10, // sits on ground = 0.58
          width: 0.05,
          height: 0.10, // bottom at GROUND_Y = 0.68
          hit: false,
          dodged: false,
        },
      ],
    };
    // Player hitbox top = 0.30 - 0.18 = 0.12, bottom = 0.30
    // Obstacle top = 0.58, bottom = 0.68
    // No vertical overlap (0.30 < 0.45)
    const hits = checkCollisions(world);
    expect(hits.length).toBe(0);
  });

  it('collides with high obstacle even at jump peak', () => {
    const world = {
      ...createInitialWorld(),
      playerState: 'jumping',
      playerY: GROUND_Y - JUMP_HEIGHT,
      obstacles: [
        {
          type: OBSTACLE_HIGH,
          x: PLAYER_X,
          y: 0.30,
          width: 0.05,
          height: 0.22,
          hit: false,
          dodged: false,
        },
      ],
    };
    const hits = checkCollisions(world);
    expect(hits.length).toBe(1);
  });
});

// ─── applyDamage ────────────────────────────────────────────────

describe('applyDamage', () => {
  it('reduces health by damagePerHit', () => {
    const world = createInitialWorld();
    const damaged = applyDamage(world, 4, 1000, 100);
    expect(damaged.health).toBe(TOTAL_HEALTH - 4);
  });

  it('sets invincibleUntil', () => {
    const world = createInitialWorld();
    const now = 5000;
    const invincibilityMs = 1500;
    const damaged = applyDamage(world, 4, invincibilityMs, now);
    expect(damaged.invincibleUntil).toBe(now + invincibilityMs);
  });

  it('marks obstacles at hitIndices as hit', () => {
    const world = {
      ...createInitialWorld(),
      obstacles: [
        { type: OBSTACLE_LOW, x: 0.15, y: 0.65, width: 0.05, height: 0.10, hit: false, dodged: false },
        { type: OBSTACLE_HIGH, x: 0.16, y: 0.55, width: 0.05, height: 0.05, hit: false, dodged: false },
      ],
    };
    const damaged = applyDamage(world, 4, 1000, 100, [0]);
    expect(damaged.obstacles[0].hit).toBe(true);
    expect(damaged.obstacles[1].hit).toBe(false);
  });

  it('skips damage if currently invincible', () => {
    const world = { ...createInitialWorld(), invincibleUntil: 2000 };
    const damaged = applyDamage(world, 4, 1000, 1500); // now=1500 < 2000
    expect(damaged.health).toBe(TOTAL_HEALTH); // unchanged
  });

  it('health does not go below 0', () => {
    const world = { ...createInitialWorld(), health: 2 };
    const damaged = applyDamage(world, 10, 1000, 100);
    expect(damaged.health).toBe(0);
  });

  it('does NOT mutate original world', () => {
    const world = createInitialWorld();
    applyDamage(world, 4, 1000, 100);
    expect(world.health).toBe(TOTAL_HEALTH);
  });

  it('does NOT mutate original obstacles array', () => {
    const world = {
      ...createInitialWorld(),
      obstacles: [
        { type: OBSTACLE_LOW, x: 0.15, y: 0.65, width: 0.05, height: 0.10, hit: false, dodged: false },
      ],
    };
    applyDamage(world, 4, 1000, 100, [0]);
    expect(world.obstacles[0].hit).toBe(false);
  });
});

// ─── applyHeal ──────────────────────────────────────────────────

describe('applyHeal', () => {
  it('increases health by healAmount', () => {
    const world = { ...createInitialWorld(), health: 20 };
    const healed = applyHeal(world, 5);
    expect(healed.health).toBe(25);
  });

  it('caps health at TOTAL_HEALTH', () => {
    const world = { ...createInitialWorld(), health: 26 };
    const healed = applyHeal(world, 10);
    expect(healed.health).toBe(TOTAL_HEALTH);
  });

  it('does NOT mutate original world', () => {
    const world = { ...createInitialWorld(), health: 20 };
    applyHeal(world, 5);
    expect(world.health).toBe(20);
  });
});

// ─── evaluateLevel ──────────────────────────────────────────────

describe('evaluateLevel', () => {
  it('returns "fail" if health <= 0', () => {
    const world = { ...createInitialWorld(), health: 0 };
    expect(evaluateLevel(world, { score_to_advance: 100 })).toBe('fail');
  });

  it('returns "advance" if score >= score_to_advance', () => {
    const world = { ...createInitialWorld(), score: 150 };
    expect(evaluateLevel(world, { score_to_advance: 100 })).toBe('advance');
  });

  it('returns "advance" if score equals score_to_advance exactly', () => {
    const world = { ...createInitialWorld(), score: 100 };
    expect(evaluateLevel(world, { score_to_advance: 100 })).toBe('advance');
  });

  it('returns null if game is still in progress', () => {
    const world = { ...createInitialWorld(), score: 50, health: 10 };
    expect(evaluateLevel(world, { score_to_advance: 100 })).toBe(null);
  });

  it('prefers "fail" over "advance" when health is 0 even if score is enough', () => {
    const world = { ...createInitialWorld(), health: 0, score: 200 };
    expect(evaluateLevel(world, { score_to_advance: 100 })).toBe('fail');
  });
});

// ─── Blocks & shooting ──────────────────────────────────────────

/** A block parked `x` into the screen, as spawnObstacle builds one. */
function worldWithBlock(type, x, extra = {}) {
  const spawned = spawnObstacle(createInitialWorld(), type);
  return { ...spawned, obstacles: [{ ...spawned.obstacles[0], x, width: 0.05 }], ...extra };
}

describe('block geometry', () => {
  it('spawns blocks floating in the middle band with their hit points', () => {
    const soft = spawnObstacle(createInitialWorld(), OBSTACLE_BLOCK).obstacles[0];
    const hard = spawnObstacle(createInitialWorld(), OBSTACLE_BLOCK_HARD).obstacles[0];
    expect(soft).toMatchObject({ type: 'block', y: BLOCK_TOP, hp: 1, maxHp: 1, broken: false });
    expect(soft.height).toBeCloseTo(BLOCK_BOTTOM - BLOCK_TOP, 5);
    expect(hard).toMatchObject({ type: 'block_hard', hp: 2, maxHp: 2 });
  });

  it('cannot be jumped: every sample of a jump overlapping it collides', () => {
    for (let t = 0.02; t < 1; t += 0.02) {
      const arc = -4 * JUMP_HEIGHT * t * (t - 1);
      const world = worldWithBlock(OBSTACLE_BLOCK, PLAYER_X, { playerState: 'jumping', jumpT: t, playerY: GROUND_Y - arc });
      expect(checkCollisions(world), `jump t=${t.toFixed(2)}`).toHaveLength(1);
    }
  });

  it('cannot be ducked under', () => {
    const world = worldWithBlock(OBSTACLE_BLOCK, PLAYER_X, { playerState: 'ducking' });
    expect(checkCollisions(world)).toHaveLength(1);
  });

  it('stays clear of both staff zones', () => {
    expect(BLOCK_TOP).toBeGreaterThan(0.30);
    expect(BLOCK_BOTTOM).toBeLessThan(0.70);
  });

  it('gives every obstacle a stable, increasing id', () => {
    const w = spawnObstacle(spawnObstacle(createInitialWorld(), OBSTACLE_LOW), OBSTACLE_BLOCK);
    expect(w.obstacles.map((o) => o.id)).toEqual([1, 2]);
    expect(w.nextId).toBe(3);
  });
});

describe('pickObstacleType', () => {
  const at = (r) => () => r;

  it('keeps today\'s even low/high split when a level names no mix', () => {
    expect(pickObstacleType(undefined, at(0.1))).toBe(OBSTACLE_LOW);
    expect(pickObstacleType(undefined, at(0.9))).toBe(OBSTACLE_HIGH);
    expect(pickObstacleType({}, at(0.9))).toBe(OBSTACLE_HIGH);
  });

  it('walks the weights in order, ignoring unknown and non-positive keys', () => {
    const mix = { low: 1, high: 0, block: 1, block_hard: 2, dragon: 5 };
    expect(pickObstacleType(mix, at(0.0))).toBe(OBSTACLE_LOW);
    expect(pickObstacleType(mix, at(0.3))).toBe(OBSTACLE_BLOCK);
    expect(pickObstacleType(mix, at(0.6))).toBe(OBSTACLE_BLOCK_HARD);
    expect(pickObstacleType(mix, at(0.999))).toBe(OBSTACLE_BLOCK_HARD);
  });

  it('knows when a mix needs a shoot staff', () => {
    expect(mixIncludesShootable({ low: 1, high: 1 })).toBe(false);
    expect(mixIncludesShootable({ low: 1, block: 0 })).toBe(false);
    expect(mixIncludesShootable({ block_hard: 1 })).toBe(true);
    expect(mixIncludesShootable(undefined)).toBe(false);
    expect(isShootable('high')).toBe(false);
  });
});

describe('applyShoot', () => {
  it('fires a pellet from the buster and holds the shooting pose', () => {
    const next = applyShoot(createInitialWorld(), 1000);
    expect(next.projectiles).toHaveLength(1);
    expect(next.projectiles[0].x).toBeCloseTo(PLAYER_X + PLAYER_WIDTH, 5);
    expect(next.shootUntil).toBe(1000 + SHOOT_POSE_MS);
    expect(next.nextId).toBe(2);
  });

  it('fires at block height from the ground', () => {
    const [pellet] = applyShoot(createInitialWorld(), 0).projectiles;
    expect(pellet.y).toBeGreaterThan(BLOCK_TOP);
    expect(pellet.y).toBeLessThan(BLOCK_BOTTOM);
  });

  it('is a no-op while ducking — there is no slide-shot', () => {
    const ducking = applyDuck(createInitialWorld(), 0);
    expect(applyShoot(ducking, 10)).toBe(ducking);
  });

  it('fires mid-jump, too high to reach a block at the peak', () => {
    const peak = { ...createInitialWorld(), playerState: 'jumping', jumpT: 0.5, playerY: GROUND_Y - JUMP_HEIGHT };
    const [pellet] = applyShoot(peak, 0).projectiles;
    expect(pellet.y).toBeLessThan(BLOCK_TOP);
  });
});

describe('pellets in flight', () => {
  it('fly right and leave the screen', () => {
    let world = applyShoot(createInitialWorld(), 0);
    world = tickWorld(world, 0.1, 0);
    expect(world.projectiles[0].x).toBeCloseTo(PLAYER_X + PLAYER_WIDTH + PELLET_SPEED * 0.1, 5);
    for (let i = 0; i < 10; i++) world = tickWorld(world, 0.1, 0);
    expect(world.projectiles).toHaveLength(0);
  });

  it('break a one-shot block, which then counts as cleared', () => {
    let world = applyShoot(worldWithBlock(OBSTACLE_BLOCK, 0.5), 0);
    for (let i = 0; i < 10 && !world.obstacles[0].broken; i++) world = tickWorld(world, 0.05, 2);
    expect(world.obstacles[0]).toMatchObject({ broken: true, dodged: true, hp: 0 });
    expect(world.projectiles).toHaveLength(0);
    expect(world).toMatchObject({ dodgeCount: 1, blockHits: 1, blocksBroken: 1 });
    expect(world.score).toBeGreaterThan(BLOCK_BREAK_SCORE);
  });

  it('crack a two-shot block on the first hit and break it on the second', () => {
    let world = applyShoot(worldWithBlock(OBSTACLE_BLOCK_HARD, 0.6), 0);
    for (let i = 0; i < 10 && world.blockHits === 0; i++) world = tickWorld(world, 0.05, 2);
    expect(world.obstacles[0]).toMatchObject({ hp: 1, broken: false, dodged: false });
    expect(world.dodgeCount).toBe(0);
    world = applyShoot(world, 100);
    for (let i = 0; i < 10 && world.blockHits === 1; i++) world = tickWorld(world, 0.05, 2);
    expect(world.obstacles[0]).toMatchObject({ hp: 0, broken: true });
    expect(world.dodgeCount).toBe(1);
  });

  it('never tunnel through a block at a low frame rate', () => {
    let world = applyShoot(worldWithBlock(OBSTACLE_BLOCK, 0.45), 0);
    world = tickWorld(world, 0.1, 7); // max dt, max scroll: 0.16 + 0.056 relative travel
    world = tickWorld(world, 0.1, 7);
    expect(world.obstacles[0].broken).toBe(true);
  });

  it('pass low and high obstacles without touching them', () => {
    const spawned = spawnObstacle(createInitialWorld(), OBSTACLE_LOW);
    let world = applyShoot({ ...spawned, obstacles: [{ ...spawned.obstacles[0], x: 0.5 }] }, 0);
    for (let i = 0; i < 12; i++) world = tickWorld(world, 0.05, 0);
    expect(world.obstacles[0].hit).toBe(false);
    expect(world.blockHits).toBe(0);
  });

  it('ignore a block that already hit the player', () => {
    let world = worldWithBlock(OBSTACLE_BLOCK, 0.5);
    world = { ...world, obstacles: [{ ...world.obstacles[0], hit: true }] };
    world = applyShoot(world, 0);
    for (let i = 0; i < 10; i++) world = tickWorld(world, 0.05, 0);
    expect(world.blockHits).toBe(0);
  });

  it('a broken block never collides with the player', () => {
    const world = worldWithBlock(OBSTACLE_BLOCK, PLAYER_X);
    const broken = { ...world, obstacles: [{ ...world.obstacles[0], broken: true, dodged: true, hp: 0 }] };
    expect(checkCollisions(broken)).toHaveLength(0);
  });
});
