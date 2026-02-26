import { describe, it, expect, vi } from 'vitest';
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
  createInitialWorld,
  spawnObstacle,
  tickWorld,
  applyJump,
  updateJump,
  applyDuck,
  releaseDuck,
  getPlayerHitbox,
  checkCollisions,
  applyDamage,
  applyHeal,
  evaluateLevel,
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
  });
});

// ─── createInitialWorld ─────────────────────────────────────────

describe('createInitialWorld', () => {
  it('returns initial world state with defaults', () => {
    const world = createInitialWorld();
    expect(world).toEqual({
      obstacles: [],
      worldPos: 0,
      score: 0,
      health: TOTAL_HEALTH,
      playerState: 'running',
      playerY: GROUND_Y,
      jumpT: 0,
      invincibleUntil: 0,
      dodgeCount: 0,
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

  it('spawns a high obstacle floating at head height', () => {
    const world = createInitialWorld();
    const next = spawnObstacle(world, OBSTACLE_HIGH);
    const obs = next.obstacles[0];
    expect(obs.type).toBe(OBSTACLE_HIGH);
    expect(obs.x).toBe(1.05);
    expect(obs.height).toBeCloseTo(0.05, 1);
    // High obstacle at head height: y = GROUND_Y - PLAYER_HEIGHT - 0.02
    expect(obs.y).toBeCloseTo(GROUND_Y - PLAYER_HEIGHT - 0.02, 5);
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
    const obstacleWidth = 0.05;
    // Place obstacle so that its right edge is just past PLAYER_X after tick
    const startX = PLAYER_X; // right edge = startX + width = 0.15 + 0.05 = 0.20 > PLAYER_X
    let world = {
      ...createInitialWorld(),
      obstacles: [
        { type: OBSTACLE_LOW, x: startX, y: 0.65, width: obstacleWidth, height: 0.10, hit: false, dodged: false },
      ],
    };
    // After a tick, obstacle moves left. With scrollSpeed=10, dt=1: shift = 10*0.08*1 = 0.8
    // newX = 0.15 - 0.8 = -0.65, right edge = -0.65 + 0.05 = -0.60, which is < PLAYER_X
    const ticked = tickWorld(world, 1, 10);
    // The obstacle was removed (past left edge) or dodged
    // Actually it might be removed since x + width < 0. Let's use smaller dt.
    // Let's use precise placement instead.
    let world2 = {
      ...createInitialWorld(),
      obstacles: [
        { type: OBSTACLE_LOW, x: 0.26, y: 0.65, width: 0.04, height: 0.10, hit: false, dodged: false },
      ],
    };
    // right edge = 0.26 + 0.04 = 0.30 > PLAYER_X(0.25) before tick
    // After tick: shift = 1 * 0.08 * 1 = 0.08, newX = 0.26 - 0.08 = 0.18
    // right edge = 0.18 + 0.04 = 0.22 < PLAYER_X(0.25)
    const ticked2 = tickWorld(world2, 1, 1);
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
  it('sets playerState to ducking', () => {
    const world = createInitialWorld();
    const ducked = applyDuck(world);
    expect(ducked.playerState).toBe('ducking');
  });

  it('is a no-op if jumping', () => {
    const world = { ...createInitialWorld(), playerState: 'jumping' };
    const result = applyDuck(world);
    expect(result).toBe(world);
  });

  it('does NOT mutate original world', () => {
    const world = createInitialWorld();
    applyDuck(world);
    expect(world.playerState).toBe('running');
  });
});

// ─── releaseDuck ────────────────────────────────────────────────

describe('releaseDuck', () => {
  it('returns to running if ducking', () => {
    const world = { ...createInitialWorld(), playerState: 'ducking' };
    const released = releaseDuck(world);
    expect(released.playerState).toBe('running');
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
          // head height for standing player, but ducking player is shorter
          x: PLAYER_X,
          y: GROUND_Y - PLAYER_HEIGHT - 0.02,
          width: 0.05,
          height: 0.05,
          hit: false,
          dodged: false,
        },
      ],
    };
    const hb = getPlayerHitbox(world);
    // Ducking hitbox top = GROUND_Y - PLAYER_DUCK_HEIGHT = 0.68 - 0.09 = 0.59
    // High obstacle bottom = (GROUND_Y - PLAYER_HEIGHT - 0.02) + 0.05 = 0.68 - 0.18 - 0.02 + 0.05 = 0.53
    // 0.53 < 0.59, so no overlap vertically
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
