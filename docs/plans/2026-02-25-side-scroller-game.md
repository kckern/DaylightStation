# Side-Scroller Piano Game — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome-dino-style endless runner controlled by piano notes, with jump/duck actions driven by ActionStaff note matching.

**Architecture:** Pure game engine (`sideScrollerEngine.js`) handles world state, obstacle spawning, collision, and scoring as testable pure functions. A React hook (`useSideScrollerGame.js`) wires the engine to `useStaffMatching` with two actions (jump/duck) and manages the phase state machine. The main component (`SideScrollerGame.jsx`) renders a stick-figure runner canvas, two ActionStaffs stacked on the right, a Mega Man health bar on the left, and PianoKeyboard at the bottom.

**Tech Stack:** React hooks, CSS/HTML rendering (no canvas), `requestAnimationFrame` game loop, existing `useStaffMatching`/`ActionStaff`/`PianoKeyboard` shared components.

**Design Doc:** `docs/plans/2026-02-25-side-scroller-game-design.md`

---

## Task 1: Game Engine — Pure Functions

The engine is the foundation. All game logic lives here as pure functions with no React dependency.

**Files:**
- Create: `frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.js`
- Test: `frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`

### Step 1: Write failing tests for `createInitialWorld` and constants

```js
// sideScrollerEngine.test.js
import { describe, it, expect } from 'vitest';
import {
  TOTAL_HEALTH,
  GROUND_Y,
  PLAYER_HEIGHT,
  PLAYER_DUCK_HEIGHT,
  OBSTACLE_LOW,
  OBSTACLE_HIGH,
  createInitialWorld,
} from './sideScrollerEngine.js';

describe('sideScrollerEngine', () => {
  describe('constants', () => {
    it('exports expected constants', () => {
      expect(TOTAL_HEALTH).toBe(28);
      expect(GROUND_Y).toBeCloseTo(0.75);
      expect(PLAYER_HEIGHT).toBeCloseTo(0.18);
      expect(PLAYER_DUCK_HEIGHT).toBeCloseTo(0.09);
      expect(OBSTACLE_LOW).toBe('low');
      expect(OBSTACLE_HIGH).toBe('high');
    });
  });

  describe('createInitialWorld', () => {
    it('returns a valid initial world state', () => {
      const world = createInitialWorld({ health: 28 });
      expect(world.obstacles).toEqual([]);
      expect(world.worldPos).toBe(0);
      expect(world.score).toBe(0);
      expect(world.health).toBe(28);
      expect(world.playerState).toBe('running');
      expect(world.playerY).toBe(GROUND_Y);
      expect(world.jumpT).toBe(0);
      expect(world.invincibleUntil).toBe(0);
      expect(world.dodgeCount).toBe(0);
    });

    it('uses config health value', () => {
      const world = createInitialWorld({ health: 20 });
      expect(world.health).toBe(20);
    });

    it('defaults health to TOTAL_HEALTH', () => {
      const world = createInitialWorld({});
      expect(world.health).toBe(TOTAL_HEALTH);
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`
Expected: FAIL — module not found

### Step 3: Implement constants and `createInitialWorld`

```js
// sideScrollerEngine.js

// ─── Constants ──────────────────────────────────────────────────
export const TOTAL_HEALTH = 28;
export const GROUND_Y = 0.75;        // ground line at 75% from top (normalized 0-1)
export const PLAYER_X = 0.15;        // player fixed at 15% from left
export const PLAYER_HEIGHT = 0.18;   // standing height (normalized)
export const PLAYER_DUCK_HEIGHT = 0.09; // ducking height (half)
export const PLAYER_WIDTH = 0.04;
export const OBSTACLE_LOW = 'low';
export const OBSTACLE_HIGH = 'high';

// ─── World State ────────────────────────────────────────────────

export function createInitialWorld(config = {}) {
  return {
    obstacles: [],
    worldPos: 0,
    score: 0,
    health: config.health ?? TOTAL_HEALTH,
    playerState: 'running', // 'running' | 'jumping' | 'ducking'
    playerY: GROUND_Y,
    jumpT: 0,              // progress through jump arc (0-1), 0 = not jumping
    invincibleUntil: 0,    // timestamp until which player is invincible
    dodgeCount: 0,         // obstacles dodged (for healing)
  };
}
```

### Step 4: Run tests to verify they pass

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`
Expected: PASS

### Step 5: Write failing tests for `spawnObstacle`

Add to the test file:

```js
import { /* ...existing... */, spawnObstacle } from './sideScrollerEngine.js';

describe('spawnObstacle', () => {
  it('adds an obstacle to the world', () => {
    const world = createInitialWorld({});
    const next = spawnObstacle(world, OBSTACLE_LOW);
    expect(next.obstacles).toHaveLength(1);
    expect(next.obstacles[0].type).toBe(OBSTACLE_LOW);
  });

  it('spawns low obstacles on the ground', () => {
    const world = createInitialWorld({});
    const next = spawnObstacle(world, OBSTACLE_LOW);
    const ob = next.obstacles[0];
    expect(ob.x).toBeGreaterThan(1.0); // off right edge
    expect(ob.y + ob.height).toBeCloseTo(GROUND_Y, 1); // bottom sits on ground
  });

  it('spawns high obstacles at head height', () => {
    const world = createInitialWorld({});
    const next = spawnObstacle(world, OBSTACLE_HIGH);
    const ob = next.obstacles[0];
    expect(ob.x).toBeGreaterThan(1.0);
    expect(ob.y).toBeLessThan(GROUND_Y - PLAYER_DUCK_HEIGHT); // above ducking height
  });

  it('does not mutate the original world', () => {
    const world = createInitialWorld({});
    spawnObstacle(world, OBSTACLE_LOW);
    expect(world.obstacles).toHaveLength(0);
  });
});
```

### Step 6: Run tests, verify fail

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`
Expected: FAIL — `spawnObstacle` not exported

### Step 7: Implement `spawnObstacle`

Add to `sideScrollerEngine.js`:

```js
export function spawnObstacle(world, type) {
  const obstacle = {
    type,
    x: 1.05,
    width: 0.04 + Math.random() * 0.02,
    hit: false,
    dodged: false,
  };

  if (type === OBSTACLE_LOW) {
    obstacle.height = 0.10;
    obstacle.y = GROUND_Y - obstacle.height; // sits on ground line
  } else {
    obstacle.height = 0.05;
    obstacle.y = GROUND_Y - PLAYER_HEIGHT - 0.02; // at head height, above ducking clearance
  }

  return { ...world, obstacles: [...world.obstacles, obstacle] };
}
```

### Step 8: Run tests, verify pass

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`
Expected: PASS

### Step 9: Write failing tests for `tickWorld`

```js
import { /* ...existing... */, tickWorld } from './sideScrollerEngine.js';

describe('tickWorld', () => {
  it('moves obstacles leftward', () => {
    let world = createInitialWorld({});
    world = spawnObstacle(world, OBSTACLE_LOW);
    const startX = world.obstacles[0].x;
    const next = tickWorld(world, 0.016, 3); // 16ms frame, speed 3
    expect(next.obstacles[0].x).toBeLessThan(startX);
  });

  it('increments score over time', () => {
    const world = createInitialWorld({});
    const next = tickWorld(world, 0.016, 3);
    expect(next.score).toBeGreaterThan(0);
  });

  it('removes obstacles that scroll past the left edge', () => {
    let world = createInitialWorld({});
    world = { ...world, obstacles: [{ type: OBSTACLE_LOW, x: -0.2, width: 0.04, y: 0.65, height: 0.1, hit: false, dodged: false }] };
    const next = tickWorld(world, 0.016, 3);
    expect(next.obstacles).toHaveLength(0);
  });

  it('marks obstacles as dodged when they pass the player', () => {
    let world = createInitialWorld({});
    // Place obstacle just past the player
    world = {
      ...world,
      obstacles: [{
        type: OBSTACLE_LOW, x: PLAYER_X - 0.06, width: 0.04,
        y: GROUND_Y - 0.1, height: 0.1, hit: false, dodged: false,
      }],
    };
    const next = tickWorld(world, 0.016, 3);
    expect(next.obstacles[0].dodged).toBe(true);
    expect(next.dodgeCount).toBe(1);
  });

  it('advances worldPos', () => {
    const world = createInitialWorld({});
    const next = tickWorld(world, 0.016, 3);
    expect(next.worldPos).toBeGreaterThan(0);
  });
});
```

### Step 10: Implement `tickWorld`

```js
export function tickWorld(world, dt, scrollSpeed) {
  const dx = scrollSpeed * 0.08 * dt; // normalize speed to world units per second
  let dodgeCount = world.dodgeCount;

  const obstacles = world.obstacles
    .map(ob => {
      const moved = { ...ob, x: ob.x - dx };
      // Mark as dodged when obstacle's right edge passes player's left edge
      if (!moved.dodged && !moved.hit && (moved.x + moved.width) < PLAYER_X) {
        moved.dodged = true;
        dodgeCount++;
      }
      return moved;
    })
    .filter(ob => ob.x + ob.width > -0.1); // remove off-screen

  return {
    ...world,
    obstacles,
    worldPos: world.worldPos + dx,
    score: world.score + Math.round(scrollSpeed * dt * 10),
    dodgeCount,
  };
}
```

### Step 11: Run tests, verify pass

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`
Expected: PASS

### Step 12: Write failing tests for jump mechanics

```js
import { /* ...existing... */, applyJump, updateJump } from './sideScrollerEngine.js';

describe('applyJump', () => {
  it('sets playerState to jumping when on ground', () => {
    const world = createInitialWorld({});
    const next = applyJump(world);
    expect(next.playerState).toBe('jumping');
    expect(next.jumpT).toBe(0);
  });

  it('does nothing if already jumping', () => {
    let world = createInitialWorld({});
    world = { ...world, playerState: 'jumping', jumpT: 0.3 };
    const next = applyJump(world);
    expect(next.jumpT).toBe(0.3); // unchanged
  });
});

describe('updateJump', () => {
  it('advances jumpT over time', () => {
    let world = createInitialWorld({});
    world = applyJump(world);
    const next = updateJump(world, 0.1, 500); // 100ms elapsed, 500ms duration
    expect(next.jumpT).toBeGreaterThan(0);
    expect(next.playerY).toBeLessThan(GROUND_Y); // above ground
  });

  it('returns to ground when jump completes', () => {
    let world = createInitialWorld({});
    world = { ...world, playerState: 'jumping', jumpT: 0.99 };
    const next = updateJump(world, 0.1, 500); // enough to finish
    expect(next.playerState).toBe('running');
    expect(next.playerY).toBeCloseTo(GROUND_Y);
    expect(next.jumpT).toBe(0);
  });

  it('follows a parabolic arc (highest at midpoint)', () => {
    let world = createInitialWorld({});
    world = { ...world, playerState: 'jumping', jumpT: 0.0 };
    const atMid = updateJump(world, 0.25, 500); // jumpT ~ 0.5
    const atQuarter = updateJump(world, 0.125, 500); // jumpT ~ 0.25
    expect(atMid.playerY).toBeLessThan(atQuarter.playerY); // midpoint is highest (lowest Y)
  });
});
```

### Step 13: Implement `applyJump` and `updateJump`

```js
const JUMP_HEIGHT = 0.25; // how high the jump arc peaks

export function applyJump(world) {
  if (world.playerState === 'jumping') return world;
  return { ...world, playerState: 'jumping', jumpT: 0 };
}

export function updateJump(world, dt, jumpDurationMs) {
  if (world.playerState !== 'jumping') return world;

  const durationSec = jumpDurationMs / 1000;
  const newT = world.jumpT + dt / durationSec;

  if (newT >= 1) {
    return { ...world, playerState: 'running', playerY: GROUND_Y, jumpT: 0 };
  }

  // Parabolic arc: y = -4h*t*(t-1) where h is peak height
  const arcOffset = -4 * JUMP_HEIGHT * newT * (newT - 1);
  return { ...world, playerY: GROUND_Y - arcOffset, jumpT: newT };
}
```

### Step 14: Run tests, verify pass

### Step 15: Write failing tests for duck mechanics

```js
import { /* ...existing... */, applyDuck, releaseDuck } from './sideScrollerEngine.js';

describe('applyDuck', () => {
  it('sets playerState to ducking', () => {
    const world = createInitialWorld({});
    const next = applyDuck(world);
    expect(next.playerState).toBe('ducking');
  });

  it('does nothing if jumping', () => {
    let world = createInitialWorld({});
    world = { ...world, playerState: 'jumping' };
    const next = applyDuck(world);
    expect(next.playerState).toBe('jumping');
  });
});

describe('releaseDuck', () => {
  it('returns to running when ducking', () => {
    let world = createInitialWorld({});
    world = applyDuck(world);
    const next = releaseDuck(world);
    expect(next.playerState).toBe('running');
  });

  it('does nothing if not ducking', () => {
    const world = createInitialWorld({});
    const next = releaseDuck(world);
    expect(next.playerState).toBe('running');
  });
});
```

### Step 16: Implement `applyDuck` and `releaseDuck`

```js
export function applyDuck(world) {
  if (world.playerState === 'jumping') return world;
  return { ...world, playerState: 'ducking' };
}

export function releaseDuck(world) {
  if (world.playerState !== 'ducking') return world;
  return { ...world, playerState: 'running' };
}
```

### Step 17: Run tests, verify pass

### Step 18: Write failing tests for collision detection

```js
import { /* ...existing... */, checkCollisions, getPlayerHitbox } from './sideScrollerEngine.js';

describe('checkCollisions', () => {
  it('detects collision with low obstacle when running', () => {
    let world = createInitialWorld({});
    world = {
      ...world,
      playerState: 'running',
      obstacles: [{
        type: OBSTACLE_LOW, x: PLAYER_X, width: 0.04,
        y: GROUND_Y - 0.10, height: 0.10, hit: false, dodged: false,
      }],
    };
    const collisions = checkCollisions(world);
    expect(collisions).toHaveLength(1);
  });

  it('no collision with low obstacle when jumping high enough', () => {
    let world = createInitialWorld({});
    world = {
      ...world,
      playerState: 'jumping',
      playerY: GROUND_Y - 0.20, // well above obstacle
      obstacles: [{
        type: OBSTACLE_LOW, x: PLAYER_X, width: 0.04,
        y: GROUND_Y - 0.10, height: 0.10, hit: false, dodged: false,
      }],
    };
    const collisions = checkCollisions(world);
    expect(collisions).toHaveLength(0);
  });

  it('detects collision with high obstacle when running', () => {
    let world = createInitialWorld({});
    world = {
      ...world,
      playerState: 'running',
      obstacles: [{
        type: OBSTACLE_HIGH, x: PLAYER_X, width: 0.04,
        y: GROUND_Y - PLAYER_HEIGHT - 0.02, height: 0.05, hit: false, dodged: false,
      }],
    };
    const collisions = checkCollisions(world);
    expect(collisions).toHaveLength(1);
  });

  it('no collision with high obstacle when ducking', () => {
    let world = createInitialWorld({});
    world = {
      ...world,
      playerState: 'ducking',
      obstacles: [{
        type: OBSTACLE_HIGH, x: PLAYER_X, width: 0.04,
        y: GROUND_Y - PLAYER_HEIGHT - 0.02, height: 0.05, hit: false, dodged: false,
      }],
    };
    const collisions = checkCollisions(world);
    expect(collisions).toHaveLength(0);
  });

  it('skips already-hit obstacles', () => {
    let world = createInitialWorld({});
    world = {
      ...world,
      obstacles: [{
        type: OBSTACLE_LOW, x: PLAYER_X, width: 0.04,
        y: GROUND_Y - 0.10, height: 0.10, hit: true, dodged: false,
      }],
    };
    const collisions = checkCollisions(world);
    expect(collisions).toHaveLength(0);
  });
});
```

### Step 19: Implement `checkCollisions` and `getPlayerHitbox`

```js
export function getPlayerHitbox(world) {
  const h = world.playerState === 'ducking' ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
  return {
    x: PLAYER_X,
    y: world.playerY - h,
    width: PLAYER_WIDTH,
    height: h,
  };
}

function boxesOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function checkCollisions(world) {
  const player = getPlayerHitbox(world);
  return world.obstacles.filter(ob => !ob.hit && !ob.dodged && boxesOverlap(player, ob));
}
```

### Step 20: Run tests, verify pass

### Step 21: Write failing tests for damage and healing

```js
import { /* ...existing... */, applyDamage, applyHeal, evaluateLevel } from './sideScrollerEngine.js';

describe('applyDamage', () => {
  it('reduces health by damage amount', () => {
    let world = createInitialWorld({ health: 28 });
    const next = applyDamage(world, 2, 1000, 100);
    expect(next.health).toBe(26);
  });

  it('sets invincibility timer', () => {
    let world = createInitialWorld({});
    const next = applyDamage(world, 2, 1000, 100);
    expect(next.invincibleUntil).toBe(1100);
  });

  it('marks colliding obstacles as hit', () => {
    let world = createInitialWorld({});
    const obstacle = {
      type: OBSTACLE_LOW, x: PLAYER_X, width: 0.04,
      y: GROUND_Y - 0.10, height: 0.10, hit: false, dodged: false,
    };
    world = { ...world, obstacles: [obstacle] };
    const next = applyDamage(world, 2, 1000, 100, [0]);
    expect(next.obstacles[0].hit).toBe(true);
  });

  it('does not go below 0 health', () => {
    let world = createInitialWorld({});
    world = { ...world, health: 1 };
    const next = applyDamage(world, 5, 1000, 100);
    expect(next.health).toBe(0);
  });

  it('skips damage during invincibility', () => {
    let world = createInitialWorld({});
    world = { ...world, health: 20, invincibleUntil: 200 };
    const next = applyDamage(world, 2, 1000, 100); // now=100 < invincibleUntil=200
    expect(next.health).toBe(20);
  });
});

describe('applyHeal', () => {
  it('adds health up to TOTAL_HEALTH', () => {
    let world = createInitialWorld({});
    world = { ...world, health: 26 };
    const next = applyHeal(world, 1);
    expect(next.health).toBe(27);
  });

  it('does not exceed TOTAL_HEALTH', () => {
    let world = createInitialWorld({});
    world = { ...world, health: 28 };
    const next = applyHeal(world, 1);
    expect(next.health).toBe(28);
  });
});

describe('evaluateLevel', () => {
  it('returns fail when health is 0', () => {
    const world = { ...createInitialWorld({}), health: 0 };
    expect(evaluateLevel(world, { score_to_advance: 500 })).toBe('fail');
  });

  it('returns advance when score reaches threshold', () => {
    const world = { ...createInitialWorld({}), score: 600 };
    expect(evaluateLevel(world, { score_to_advance: 500 })).toBe('advance');
  });

  it('returns null when neither condition met', () => {
    const world = { ...createInitialWorld({}), score: 100, health: 20 };
    expect(evaluateLevel(world, { score_to_advance: 500 })).toBeNull();
  });
});
```

### Step 22: Implement `applyDamage`, `applyHeal`, `evaluateLevel`

```js
export function applyDamage(world, damagePerHit, invincibilityMs, now, hitIndices = []) {
  if (now < world.invincibleUntil) return world;

  const obstacles = world.obstacles.map((ob, i) =>
    hitIndices.includes(i) ? { ...ob, hit: true } : ob
  );

  return {
    ...world,
    obstacles,
    health: Math.max(0, world.health - damagePerHit),
    invincibleUntil: now + invincibilityMs,
  };
}

export function applyHeal(world, healAmount) {
  return {
    ...world,
    health: Math.min(TOTAL_HEALTH, world.health + healAmount),
  };
}

export function evaluateLevel(world, levelConfig) {
  if (world.health <= 0) return 'fail';
  if (world.score >= levelConfig.score_to_advance) return 'advance';
  return null;
}
```

### Step 23: Run all engine tests, verify pass

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`
Expected: All PASS

### Step 24: Commit

```bash
git add frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.js \
       frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js
git commit -m "feat(piano): add side-scroller game engine with tests"
```

---

## Task 2: Add Jump/Duck Icons to ActionStaff

ActionStaff's `ACTION_ICONS` map needs `jump` and `duck` entries so the staves render correctly.

**Files:**
- Modify: `frontend/src/modules/Piano/components/ActionStaff.jsx` (lines 3-9 imports, lines 49-56 icon map)

### Step 1: Add imports and icon entries

In `ActionStaff.jsx`, add `IconArrowBigUpLine` to the existing import (it already imports `IconArrowBigDownLine`):

```jsx
import {
  IconCaretLeftFilled,
  IconCaretRightFilled,
  IconRotate,
  IconRotateClockwise,
  IconArrowBigDownLine,
  IconArrowBigUpLine,
  IconReplace,
} from '@tabler/icons-react';
```

Add to `ACTION_ICONS`:

```jsx
const ACTION_ICONS = {
  moveLeft: <IconCaretLeftFilled className="action-icon" />,
  moveRight: <IconCaretRightFilled className="action-icon" />,
  rotateCCW: <IconRotate className="action-icon" />,
  rotateCW: <IconRotateClockwise className="action-icon" />,
  hardDrop: <IconArrowBigDownLine className="action-icon" />,
  hold: <IconReplace className="action-icon" />,
  jump: <IconArrowBigUpLine className="action-icon" />,
  duck: <IconArrowBigDownLine className="action-icon" />,
};
```

### Step 2: Commit

```bash
git add frontend/src/modules/Piano/components/ActionStaff.jsx
git commit -m "feat(piano): add jump/duck icons to ActionStaff"
```

---

## Task 3: piano.yml Config — Level Definitions

**Files:**
- Modify: `data/household/config/piano.yml` (append to `side-scroller` section, replacing the existing stub)

### Step 1: Replace the `side-scroller` section

Replace the existing `side-scroller` block (currently just activation) with:

```yaml
  side-scroller:
    activation:
      notes: [33, 105]       # A1 + A7
      window_ms: 300
    health: 28
    damage_per_hit: 2
    heal_per_dodge: 1
    invincibility_ms: 1000
    jump_duration_ms: 500
    levels:
      # --- White keys, treble clef (gentle intro) ---
      - name: "Easy Run"
        scroll_speed: 2
        obstacle_interval_ms: 3000
        note_range: [60, 72]
        complexity: single
        white_keys_only: true
        target_rotation: dodge
        score_to_advance: 400

      - name: "Warming Up"
        scroll_speed: 2.5
        obstacle_interval_ms: 2500
        note_range: [60, 72]
        complexity: single
        white_keys_only: true
        target_rotation: dodge
        score_to_advance: 600

      # --- Add sharps/flats ---
      - name: "Sharp Turn"
        scroll_speed: 2.5
        obstacle_interval_ms: 2500
        note_range: [60, 72]
        complexity: single
        target_rotation: dodge
        score_to_advance: 700

      # --- Bass clef ---
      - name: "Low Road"
        scroll_speed: 3
        obstacle_interval_ms: 2200
        note_range: [48, 60]
        complexity: single
        target_rotation: dodge
        score_to_advance: 800

      # --- Full range ---
      - name: "Wide Open"
        scroll_speed: 3
        obstacle_interval_ms: 2000
        note_range: [48, 84]
        complexity: single
        target_rotation: dodge
        score_to_advance: 900

      # --- Dyads ---
      - name: "Double Up"
        scroll_speed: 3
        obstacle_interval_ms: 2500
        note_range: [60, 72]
        complexity: dyad
        white_keys_only: true
        target_rotation: dodge
        score_to_advance: 1000

      - name: "Dyad Dash"
        scroll_speed: 3.5
        obstacle_interval_ms: 2200
        note_range: [48, 84]
        complexity: dyad
        target_rotation: dodge
        score_to_advance: 1200

      # --- Triads ---
      - name: "Triad Trail"
        scroll_speed: 3.5
        obstacle_interval_ms: 2500
        note_range: [60, 72]
        complexity: triad
        white_keys_only: true
        target_rotation: dodge
        score_to_advance: 1400

      - name: "Full Chord"
        scroll_speed: 4
        obstacle_interval_ms: 2000
        note_range: [48, 84]
        complexity: triad
        target_rotation: dodge
        score_to_advance: 1800

      # --- Speed finale ---
      - name: "Sprint!"
        scroll_speed: 7
        obstacle_interval_ms: 1000
        note_range: [48, 84]
        complexity: triad
        target_rotation: dodge
        score_to_advance: 3000
```

### Step 2: Commit

```bash
git add data/household/config/piano.yml
git commit -m "feat(piano): add side-scroller level config"
```

---

## Task 4: SideScrollerOverlay Component

Simple overlay for countdown and game over — mirrors TetrisOverlay pattern.

**Files:**
- Create: `frontend/src/modules/Piano/SideScrollerGame/components/SideScrollerOverlay.jsx`
- Create: `frontend/src/modules/Piano/SideScrollerGame/components/SideScrollerOverlay.scss`

### Step 1: Create overlay component

```jsx
// SideScrollerOverlay.jsx
import './SideScrollerOverlay.scss';

export function SideScrollerOverlay({ phase, countdown, score, level, levelName }) {
  if (phase === 'STARTING' && countdown != null) {
    return (
      <div className="scroller-overlay">
        <div className="scroller-overlay__countdown">
          {countdown === 0 ? 'GO!' : countdown}
        </div>
      </div>
    );
  }

  if (phase === 'LEVEL_UP') {
    return (
      <div className="scroller-overlay">
        <div className="scroller-overlay__level-up">
          <h2 className="scroller-overlay__title">LEVEL UP!</h2>
          <p className="scroller-overlay__level-name">{levelName}</p>
        </div>
      </div>
    );
  }

  if (phase === 'GAME_OVER') {
    return (
      <div className="scroller-overlay">
        <div className="scroller-overlay__gameover">
          <h2 className="scroller-overlay__title">GAME OVER</h2>
          <div className="scroller-overlay__stats">
            <div className="scroller-overlay__stat">
              <span className="scroller-overlay__stat-value">{score}</span>
              <span className="scroller-overlay__stat-label">Score</span>
            </div>
            <div className="scroller-overlay__stat">
              <span className="scroller-overlay__stat-value">{level}</span>
              <span className="scroller-overlay__stat-label">Level</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
```

### Step 2: Create overlay styles

```scss
// SideScrollerOverlay.scss
.scroller-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  pointer-events: none;

  &__countdown {
    font-size: 8rem;
    font-weight: 900;
    color: white;
    text-shadow:
      0 0 30px rgba(0, 200, 255, 0.8),
      0 0 60px rgba(0, 200, 255, 0.4);
  }

  &__level-up {
    text-align: center;
    background: rgba(0, 0, 0, 0.8);
    padding: 40px 60px;
    border-radius: 16px;
    border: 2px solid rgba(0, 255, 200, 0.5);
  }

  &__gameover {
    text-align: center;
    background: rgba(0, 0, 0, 0.8);
    padding: 40px 60px;
    border-radius: 16px;
    border: 2px solid rgba(255, 50, 50, 0.5);
  }

  &__title {
    font-size: 3rem;
    font-weight: 900;
    margin: 0 0 24px;
  }

  .scroller-overlay__gameover &__title {
    color: #ff4444;
    text-shadow: 0 0 20px rgba(255, 68, 68, 0.6);
  }

  .scroller-overlay__level-up &__title {
    color: #00ffc8;
    text-shadow: 0 0 20px rgba(0, 255, 200, 0.6);
  }

  &__level-name {
    font-size: 1.5rem;
    color: rgba(255, 255, 255, 0.7);
    margin: 0;
  }

  &__stats {
    display: flex;
    gap: 32px;
    justify-content: center;
  }

  &__stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  &__stat-value {
    font-size: 2rem;
    font-weight: 800;
    color: white;
  }

  &__stat-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
}
```

### Step 3: Commit

```bash
git add frontend/src/modules/Piano/SideScrollerGame/components/
git commit -m "feat(piano): add side-scroller overlay component"
```

---

## Task 5: RunnerCanvas Component

The scrolling world with stick figure and obstacles. All rendering with HTML/CSS divs for consistency with the rest of the Piano module.

**Files:**
- Create: `frontend/src/modules/Piano/SideScrollerGame/components/RunnerCanvas.jsx`
- Create: `frontend/src/modules/Piano/SideScrollerGame/components/RunnerCanvas.scss`

### Step 1: Create RunnerCanvas component

```jsx
// RunnerCanvas.jsx
import { useMemo } from 'react';
import {
  GROUND_Y, PLAYER_X, PLAYER_HEIGHT, PLAYER_DUCK_HEIGHT, PLAYER_WIDTH,
} from '../sideScrollerEngine.js';
import './RunnerCanvas.scss';

/**
 * Renders the side-scroller game world: ground, stick figure, obstacles.
 * All positions are normalized 0-1 and rendered via percentage CSS.
 */
export function RunnerCanvas({ world, scrollSpeed, invincible }) {
  const playerH = world.playerState === 'ducking' ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
  const playerTop = (world.playerY - playerH) * 100;
  const playerLeft = PLAYER_X * 100;

  // Ground scroll position — cycles background pattern
  const groundOffset = useMemo(
    () => (world.worldPos * 500) % 100,
    [world.worldPos]
  );

  return (
    <div className="runner-canvas">
      {/* Ground line */}
      <div
        className="runner-canvas__ground"
        style={{
          top: `${GROUND_Y * 100}%`,
          backgroundPositionX: `${-groundOffset}px`,
        }}
      />

      {/* Stick figure */}
      <div
        className={[
          'runner-canvas__player',
          `runner-canvas__player--${world.playerState}`,
          invincible && 'runner-canvas__player--invincible',
        ].filter(Boolean).join(' ')}
        style={{
          left: `${playerLeft}%`,
          top: `${playerTop}%`,
          width: `${PLAYER_WIDTH * 100}%`,
          height: `${playerH * 100}%`,
        }}
      >
        <StickFigure state={world.playerState} />
      </div>

      {/* Obstacles */}
      {world.obstacles.map((ob, i) => (
        <div
          key={i}
          className={[
            'runner-canvas__obstacle',
            `runner-canvas__obstacle--${ob.type}`,
            ob.hit && 'runner-canvas__obstacle--hit',
          ].filter(Boolean).join(' ')}
          style={{
            left: `${ob.x * 100}%`,
            top: `${ob.y * 100}%`,
            width: `${ob.width * 100}%`,
            height: `${ob.height * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * SVG stick figure with three poses: running, jumping, ducking.
 */
function StickFigure({ state }) {
  return (
    <svg className="runner-canvas__figure-svg" viewBox="0 0 40 100" preserveAspectRatio="xMidYMax meet">
      {state === 'running' && (
        <>
          {/* Head */}
          <circle cx="20" cy="15" r="10" fill="none" stroke="white" strokeWidth="3" />
          {/* Body */}
          <line x1="20" y1="25" x2="20" y2="60" stroke="white" strokeWidth="3" />
          {/* Arms */}
          <line x1="20" y1="35" x2="5" y2="48" stroke="white" strokeWidth="3" />
          <line x1="20" y1="35" x2="35" y2="48" stroke="white" strokeWidth="3" />
          {/* Legs — spread for running */}
          <line x1="20" y1="60" x2="8" y2="85" stroke="white" strokeWidth="3" />
          <line x1="20" y1="60" x2="32" y2="85" stroke="white" strokeWidth="3" />
          {/* Feet */}
          <line x1="8" y1="85" x2="3" y2="85" stroke="white" strokeWidth="3" />
          <line x1="32" y1="85" x2="37" y2="85" stroke="white" strokeWidth="3" />
        </>
      )}
      {state === 'jumping' && (
        <>
          {/* Head */}
          <circle cx="20" cy="10" r="10" fill="none" stroke="white" strokeWidth="3" />
          {/* Body */}
          <line x1="20" y1="20" x2="20" y2="50" stroke="white" strokeWidth="3" />
          {/* Arms raised */}
          <line x1="20" y1="30" x2="5" y2="18" stroke="white" strokeWidth="3" />
          <line x1="20" y1="30" x2="35" y2="18" stroke="white" strokeWidth="3" />
          {/* Legs tucked */}
          <line x1="20" y1="50" x2="10" y2="65" stroke="white" strokeWidth="3" />
          <line x1="20" y1="50" x2="30" y2="65" stroke="white" strokeWidth="3" />
          <line x1="10" y1="65" x2="12" y2="75" stroke="white" strokeWidth="3" />
          <line x1="30" y1="65" x2="28" y2="75" stroke="white" strokeWidth="3" />
        </>
      )}
      {state === 'ducking' && (
        <>
          {/* Head — lower */}
          <circle cx="28" cy="25" r="9" fill="none" stroke="white" strokeWidth="3" />
          {/* Body — bent forward */}
          <line x1="25" y1="33" x2="15" y2="55" stroke="white" strokeWidth="3" />
          {/* Arms forward */}
          <line x1="20" y1="42" x2="32" y2="50" stroke="white" strokeWidth="3" />
          {/* Legs wide */}
          <line x1="15" y1="55" x2="5" y2="85" stroke="white" strokeWidth="3" />
          <line x1="15" y1="55" x2="30" y2="85" stroke="white" strokeWidth="3" />
          {/* Feet */}
          <line x1="5" y1="85" x2="0" y2="85" stroke="white" strokeWidth="3" />
          <line x1="30" y1="85" x2="35" y2="85" stroke="white" strokeWidth="3" />
        </>
      )}
    </svg>
  );
}
```

### Step 2: Create RunnerCanvas styles

```scss
// RunnerCanvas.scss
.runner-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background: #1a1a2e;
  overflow: hidden;

  &__ground {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.6) 0px,
      rgba(255, 255, 255, 0.6) 12px,
      transparent 12px,
      transparent 20px
    );
    background-size: 20px 2px;
  }

  &__player {
    position: absolute;
    z-index: 10;

    &--invincible {
      opacity: 0.5;
    }
  }

  &__figure-svg {
    width: 100%;
    height: 100%;
  }

  &__obstacle {
    position: absolute;
    border-radius: 3px;

    &--low {
      background: rgba(255, 100, 100, 0.8);
      border: 1px solid rgba(255, 150, 150, 0.5);
    }

    &--high {
      background: rgba(100, 150, 255, 0.8);
      border: 1px solid rgba(150, 180, 255, 0.5);
    }

    &--hit {
      opacity: 0.3;
    }
  }
}
```

### Step 3: Commit

```bash
git add frontend/src/modules/Piano/SideScrollerGame/components/RunnerCanvas.jsx \
       frontend/src/modules/Piano/SideScrollerGame/components/RunnerCanvas.scss
git commit -m "feat(piano): add RunnerCanvas component with stick figure"
```

---

## Task 6: Game State Machine Hook — `useSideScrollerGame`

Wires the engine to `useStaffMatching`, manages the rAF game loop, phases, level progression.

**Files:**
- Create: `frontend/src/modules/Piano/SideScrollerGame/useSideScrollerGame.js`

### Step 1: Create the hook

```js
// useSideScrollerGame.js
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { generateTargets, useStaffMatching } from '../PianoTetris/useStaffMatching.js';
import { shuffle, buildNotePool } from '../noteUtils.js';
import {
  TOTAL_HEALTH,
  createInitialWorld,
  spawnObstacle,
  tickWorld,
  applyJump,
  applyDuck,
  releaseDuck,
  updateJump,
  checkCollisions,
  applyDamage,
  applyHeal,
  evaluateLevel,
  OBSTACLE_LOW,
  OBSTACLE_HIGH,
} from './sideScrollerEngine.js';

// ─── Constants ──────────────────────────────────────────────────
const COUNTDOWN_STEPS = [3, 2, 1, 0];
const COUNTDOWN_STEP_MS = 800;
const GAME_OVER_DISPLAY_MS = 5000;
const LEVEL_UP_DISPLAY_MS = 2000;
const SIDE_SCROLLER_ACTIONS = ['jump', 'duck'];

// ─── Target Generation (2 actions only) ─────────────────────────

function generateScrollerTargets(noteRange, complexity, whiteKeysOnly) {
  const notesPerAction = { single: 1, dyad: 2, triad: 3 };
  let count = notesPerAction[complexity] || 1;

  const available = shuffle([...buildNotePool(noteRange, whiteKeysOnly)]);
  const totalNeeded = count * SIDE_SCROLLER_ACTIONS.length;

  if (available.length < totalNeeded) count = 1;

  const targets = {};
  for (let a = 0; a < SIDE_SCROLLER_ACTIONS.length; a++) {
    const start = a * count;
    const pitches = [];
    for (let i = 0; i < count; i++) {
      pitches.push(available[(start + i) % available.length]);
    }
    targets[SIDE_SCROLLER_ACTIONS[a]] = pitches;
  }
  return targets;
}

// ─── Hook ───────────────────────────────────────────────────────

export function useSideScrollerGame(activeNotes, gameConfig) {
  const logger = useMemo(() => getChildLogger({ component: 'side-scroller' }), []);

  const [phase, setPhase] = useState('IDLE');
  const [world, setWorld] = useState(() => createInitialWorld(gameConfig));
  const [level, setLevel] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [targets, setTargets] = useState(null);
  const [levelName, setLevelName] = useState('');

  const worldRef = useRef(world);
  const phaseRef = useRef(phase);
  const levelRef = useRef(level);

  useEffect(() => { worldRef.current = world; }, [world]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { levelRef.current = level; }, [level]);

  const levels = gameConfig?.levels ?? [];
  const config = {
    health: gameConfig?.health ?? TOTAL_HEALTH,
    damagePerHit: gameConfig?.damage_per_hit ?? 2,
    healPerDodge: gameConfig?.heal_per_dodge ?? 1,
    invincibilityMs: gameConfig?.invincibility_ms ?? 1000,
    jumpDurationMs: gameConfig?.jump_duration_ms ?? 500,
  };

  // Timer refs
  const rafRef = useRef(null);
  const countdownRef = useRef(null);
  const gameOverRef = useRef(null);
  const levelUpRef = useRef(null);
  const lastFrameRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const prevDodgeCountRef = useRef(0);

  // ─── Cleanup ────────────────────────────────────────────────

  const clearAllTimers = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (gameOverRef.current) { clearTimeout(gameOverRef.current); gameOverRef.current = null; }
    if (levelUpRef.current) { clearTimeout(levelUpRef.current); levelUpRef.current = null; }
  }, []);

  // ─── Target Regeneration ────────────────────────────────────

  const regenerateTargets = useCallback((lvlConfig) => {
    if (!lvlConfig) return;
    const noteRange = lvlConfig.note_range || [60, 72];
    const complexity = lvlConfig.complexity || 'single';
    const whiteKeysOnly = lvlConfig.white_keys_only ?? false;
    setTargets(generateScrollerTargets(noteRange, complexity, whiteKeysOnly));
  }, []);

  // ─── Game Loop (rAF) ───────────────────────────────────────

  const gameLoop = useCallback((timestamp) => {
    if (phaseRef.current !== 'PLAYING') return;

    const dt = lastFrameRef.current ? (timestamp - lastFrameRef.current) / 1000 : 0.016;
    lastFrameRef.current = timestamp;

    const lvlConfig = levels[levelRef.current] ?? levels[0];
    if (!lvlConfig) return;

    const scrollSpeed = lvlConfig.scroll_speed ?? 3;
    const obstacleIntervalMs = lvlConfig.obstacle_interval_ms ?? 2000;

    setWorld(prev => {
      let next = tickWorld(prev, dt, scrollSpeed);
      next = updateJump(next, dt, config.jumpDurationMs);

      // Spawn obstacles at intervals
      const elapsed = (timestamp - lastSpawnRef.current);
      if (elapsed >= obstacleIntervalMs || lastSpawnRef.current === 0) {
        const type = Math.random() < 0.5 ? OBSTACLE_LOW : OBSTACLE_HIGH;
        next = spawnObstacle(next, type);
        lastSpawnRef.current = timestamp;
      }

      // Check collisions
      const collisions = checkCollisions(next);
      if (collisions.length > 0) {
        const hitIndices = collisions.map(c => next.obstacles.indexOf(c));
        next = applyDamage(next, config.damagePerHit, config.invincibilityMs, timestamp, hitIndices);
        logger.debug('side-scroller.collision', { health: next.health });
      }

      // Check for newly dodged obstacles → heal
      if (next.dodgeCount > prevDodgeCountRef.current) {
        const dodged = next.dodgeCount - prevDodgeCountRef.current;
        for (let i = 0; i < dodged; i++) {
          next = applyHeal(next, config.healPerDodge);
        }
        prevDodgeCountRef.current = next.dodgeCount;
      }

      // Evaluate level
      const outcome = evaluateLevel(next, lvlConfig);
      if (outcome === 'fail') {
        logger.info('side-scroller.game-over', { score: next.score, level: levelRef.current });
        setPhase('GAME_OVER');
        return next;
      }
      if (outcome === 'advance') {
        logger.info('side-scroller.level-advance', { from: levelRef.current, score: next.score });
        const nextLevel = levelRef.current + 1;
        if (nextLevel >= levels.length) {
          // Beat all levels — game over with victory
          setPhase('GAME_OVER');
          return next;
        }
        setLevel(nextLevel);
        setLevelName(levels[nextLevel]?.name ?? '');
        // Reset score for new level (cumulative distance doesn't carry over)
        next = { ...next, score: 0 };
        // Regenerate targets for new level
        setTimeout(() => regenerateTargets(levels[nextLevel]), 0);
      }

      return next;
    });

    rafRef.current = requestAnimationFrame(gameLoop);
  }, [levels, config, logger, regenerateTargets]);

  // Start/stop game loop based on phase
  useEffect(() => {
    if (phase === 'PLAYING') {
      lastFrameRef.current = 0;
      lastSpawnRef.current = 0;
      prevDodgeCountRef.current = 0;
      rafRef.current = requestAnimationFrame(gameLoop);
    } else {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    }
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [phase, gameLoop]);

  // ─── Action Handlers ────────────────────────────────────────

  const handleAction = useCallback((actionName) => {
    if (actionName === 'jump') {
      setWorld(prev => applyJump(prev));
    } else if (actionName === 'duck') {
      setWorld(prev => applyDuck(prev));
    }
  }, []);

  // Release duck when duck action is no longer matched
  const staffEnabled = phase === 'PLAYING';
  const { matchedActions } = useStaffMatching(activeNotes, targets, handleAction, staffEnabled);

  // Watch for duck release
  useEffect(() => {
    if (phase !== 'PLAYING') return;
    if (!matchedActions.has('duck')) {
      setWorld(prev => releaseDuck(prev));
    }
  }, [matchedActions, phase]);

  // ─── Target regeneration on dodge ───────────────────────────

  useEffect(() => {
    if (phase !== 'PLAYING') return;
    const lvlConfig = levels[level] ?? levels[0];
    if (!lvlConfig || lvlConfig.target_rotation !== 'dodge') return;
    if (world.dodgeCount > 0 && world.dodgeCount !== prevDodgeCountRef.current) {
      // Note: prevDodgeCountRef is updated in the game loop, but this effect
      // fires on world.dodgeCount changes for target rotation
      regenerateTargets(lvlConfig);
    }
  }, [world.dodgeCount, phase, level, levels, regenerateTargets]);

  // ─── Start Game (Countdown) ─────────────────────────────────

  const startGame = useCallback(() => {
    if (phaseRef.current !== 'IDLE') return;
    clearAllTimers();

    setWorld(createInitialWorld(config));
    setLevel(0);
    setPhase('STARTING');
    setCountdown(3);
    setLevelName(levels[0]?.name ?? '');

    logger.info('side-scroller.game-started', {});

    let step = 0;
    countdownRef.current = setInterval(() => {
      step++;
      if (step < COUNTDOWN_STEPS.length) {
        setCountdown(COUNTDOWN_STEPS[step]);
      } else {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(null);
        setPhase('PLAYING');

        // Generate initial targets
        const lvlConfig = levels[0];
        if (lvlConfig) {
          regenerateTargets(lvlConfig);
        }
      }
    }, COUNTDOWN_STEP_MS);
  }, [clearAllTimers, levels, config, logger, regenerateTargets]);

  // ─── Game Over Auto-Dismiss ─────────────────────────────────

  useEffect(() => {
    if (phase !== 'GAME_OVER') return;
    gameOverRef.current = setTimeout(() => {
      gameOverRef.current = null;
      logger.info('side-scroller.game-dismissed', { score: worldRef.current.score });
      setPhase('IDLE');
      setWorld(createInitialWorld(config));
      setTargets(null);
    }, GAME_OVER_DISPLAY_MS);
    return () => {
      if (gameOverRef.current) { clearTimeout(gameOverRef.current); gameOverRef.current = null; }
    };
  }, [phase, config, logger]);

  // ─── Cleanup on Unmount ─────────────────────────────────────

  useEffect(() => clearAllTimers, [clearAllTimers]);

  // ─── Return ─────────────────────────────────────────────────

  return {
    phase,
    world,
    level,
    levelName,
    countdown,
    targets,
    matchedActions,
    health: world.health,
    totalHealth: config.health,
    score: world.score,
    startGame,
  };
}

export default useSideScrollerGame;
```

### Step 2: Commit

```bash
git add frontend/src/modules/Piano/SideScrollerGame/useSideScrollerGame.js
git commit -m "feat(piano): add side-scroller game state machine hook"
```

---

## Task 7: Main Layout — `SideScrollerGame.jsx` and Styles

Wire everything together: RunnerCanvas on left, ActionStaffs stacked right, health bar far left, keyboard bottom.

**Files:**
- Modify: `frontend/src/modules/Piano/SideScrollerGame/SideScrollerGame.jsx` (replace placeholder)
- Modify: `frontend/src/modules/Piano/SideScrollerGame/SideScrollerGame.scss` (replace placeholder)

### Step 1: Replace SideScrollerGame.jsx

```jsx
// SideScrollerGame.jsx
import { useMemo, useEffect } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { ActionStaff } from '../components/ActionStaff.jsx';
import { useSideScrollerGame } from './useSideScrollerGame.js';
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
import { RunnerCanvas } from './components/RunnerCanvas.jsx';
import { SideScrollerOverlay } from './components/SideScrollerOverlay.jsx';
import { computeKeyboardRange } from '../noteUtils.js';
import './SideScrollerGame.scss';

export function SideScrollerGame({ activeNotes, gameConfig, onDeactivate }) {
  const logger = useMemo(() => getChildLogger({ component: 'side-scroller-game' }), []);

  const game = useSideScrollerGame(activeNotes, gameConfig);
  useAutoGameLifecycle(game.phase, game.startGame, onDeactivate, logger, 'side-scroller');

  // Keyboard range from current level
  const levels = gameConfig?.levels ?? [];
  const currentLevelConfig = levels[game.level] ?? levels[0];
  const { startNote, endNote } = useMemo(() => {
    const noteRange = currentLevelConfig?.note_range ?? [60, 72];
    return computeKeyboardRange(noteRange);
  }, [currentLevelConfig]);

  // Keyboard target highlights from jump/duck pitches
  const keyboardTargets = useMemo(() => {
    if (!game.targets) return null;
    const pitches = new Set();
    for (const action of ['jump', 'duck']) {
      const actionPitches = game.targets[action];
      if (actionPitches) {
        for (const p of actionPitches) pitches.add(p);
      }
    }
    return pitches.size > 0 ? pitches : null;
  }, [game.targets]);

  // Invincibility check (for flashing)
  const invincible = game.world.invincibleUntil > performance.now();

  // Expose game state for testing
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname !== 'localhost') return;
    window.__SIDE_SCROLLER_DEBUG__ = {
      phase: game.phase,
      world: game.world,
      level: game.level,
      targets: game.targets,
      score: game.score,
      health: game.health,
    };
    return () => { delete window.__SIDE_SCROLLER_DEBUG__; };
  });

  return (
    <div className="side-scroller">
      {/* Play area */}
      <div className="side-scroller__play-area">
        {/* Health bar — far left */}
        {game.phase === 'PLAYING' && (
          <div className="side-scroller__life-meter" aria-hidden="true">
            <div className="side-scroller__life-frame">
              {Array.from({ length: game.totalHealth }, (_, i) => (
                <div key={i} className={[
                  'side-scroller__life-notch',
                  i < Math.ceil(game.health) && 'side-scroller__life-notch--active',
                  i < Math.ceil(game.health) && game.health <= game.totalHealth * 0.25 && 'side-scroller__life-notch--danger',
                ].filter(Boolean).join(' ')} />
              ))}
            </div>
          </div>
        )}

        {/* Game canvas — fills left */}
        <div className="side-scroller__canvas">
          <RunnerCanvas world={game.world} scrollSpeed={currentLevelConfig?.scroll_speed ?? 3} invincible={invincible} />

          {/* Score overlay */}
          {game.phase === 'PLAYING' && (
            <div className="side-scroller__hud">
              <div className="side-scroller__score">
                <span className="side-scroller__score-value">{game.score}</span>
                <span className="side-scroller__score-label">SCORE</span>
              </div>
              <div className="side-scroller__level-badge">
                {game.levelName}
              </div>
            </div>
          )}
        </div>

        {/* Action staves — stacked right */}
        <div className="side-scroller__staves-right">
          <ActionStaff
            action="jump"
            targetPitches={game.targets?.jump ?? []}
            matched={game.matchedActions?.has('jump') ?? false}
            activeNotes={activeNotes}
          />
          <ActionStaff
            action="duck"
            targetPitches={game.targets?.duck ?? []}
            matched={game.matchedActions?.has('duck') ?? false}
            activeNotes={activeNotes}
          />
        </div>
      </div>

      {/* Piano keyboard */}
      <div className="side-scroller__keyboard">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
          targetNotes={keyboardTargets}
        />
      </div>

      {/* Overlay */}
      <SideScrollerOverlay
        phase={game.phase}
        countdown={game.countdown}
        score={game.score}
        level={game.level}
        levelName={game.levelName}
      />
    </div>
  );
}

export default SideScrollerGame;
```

### Step 2: Replace SideScrollerGame.scss

```scss
// SideScrollerGame.scss
.side-scroller {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #1a1a2e;
  color: #fff;
  position: relative;
  overflow: hidden;

  // ─── Play Area ────────────────────────────────────────────────
  &__play-area {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
  }

  // ─── Health Bar (Mega Man) ────────────────────────────────────
  &__life-meter {
    position: absolute;
    left: clamp(12px, 2vw, 32px);
    top: 50%;
    transform: translateY(-50%);
    height: 70%;
    width: clamp(32px, 3.5vw, 56px);
    z-index: 30;
    pointer-events: none;
  }

  &__life-frame {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column-reverse;
    gap: clamp(1px, 0.15vh, 3px);
    padding: clamp(4px, 0.5vw, 8px);
    background: #0a0a12;
    border: clamp(2px, 0.3vw, 5px) solid #1a1a2e;
    border-radius: clamp(6px, 0.8vw, 14px);
    box-shadow: inset 0 0 0 clamp(1px, 0.1vw, 2px) rgba(255, 255, 255, 0.08);
    box-sizing: border-box;
  }

  &__life-notch {
    flex: 1;
    width: 100%;
    border-radius: clamp(1px, 0.1vw, 2px);
    background: transparent;

    &--active {
      background: #e8b830;
      box-shadow: inset 0 clamp(-1px, -0.1vh, -2px) 0 rgba(0, 0, 0, 0.35);
      border-top: clamp(1px, 0.08vh, 2px) solid rgba(255, 235, 150, 0.6);
    }

    &--danger {
      background: #e83030;
      box-shadow: inset 0 clamp(-1px, -0.1vh, -2px) 0 rgba(0, 0, 0, 0.35);
      border-top-color: rgba(255, 150, 150, 0.6);
    }
  }

  // ─── Game Canvas ──────────────────────────────────────────────
  &__canvas {
    flex: 1;
    min-width: 0;
    position: relative;
  }

  // ─── HUD (score/level) ───────────────────────────────────────
  &__hud {
    position: absolute;
    top: 1rem;
    left: clamp(60px, 8vw, 100px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__score {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  &__score-value {
    font-size: 2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #00ffc8;
    text-shadow: 0 0 10px rgba(0, 255, 200, 0.4);
  }

  &__score-label {
    font-size: 0.6rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.4);
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  &__level-badge {
    font-size: 0.9rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  // ─── Action Staves (right side) ──────────────────────────────
  &__staves-right {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    flex: 0 0 auto;
    width: 130px;
    min-width: 80px;
    padding: 1rem 1rem 1rem 0;

    .action-staff {
      flex: 1 1 0;
      min-height: 0;
    }
  }

  // ─── Keyboard ─────────────────────────────────────────────────
  &__keyboard {
    height: 18%;
    flex-shrink: 0;
    display: flex;
    align-items: flex-start;
    border-top: 1px solid rgba(0, 200, 255, 0.2);
  }
}
```

### Step 3: Commit

```bash
git add frontend/src/modules/Piano/SideScrollerGame/SideScrollerGame.jsx \
       frontend/src/modules/Piano/SideScrollerGame/SideScrollerGame.scss
git commit -m "feat(piano): wire up side-scroller main layout"
```

---

## Task 8: Update Game Registry

Point the `side-scroller` registry entry to the real hook.

**Files:**
- Modify: `frontend/src/modules/Piano/gameRegistry.js` (line 37)

### Step 1: Update the hook reference

Change the `hook` entry from:
```js
hook: () => import('./SideScrollerGame/SideScrollerGame'),
```
to:
```js
hook: () => import('./SideScrollerGame/useSideScrollerGame'),
```

### Step 2: Commit

```bash
git add frontend/src/modules/Piano/gameRegistry.js
git commit -m "feat(piano): point side-scroller registry to real hook"
```

---

## Task 9: Manual Smoke Test

### Step 1: Start dev server and test

1. Ensure dev server is running: `lsof -i :3111` — if not, run `npm run dev`
2. Open the Piano app in the browser
3. Activate the side-scroller (play A1 + A7 simultaneously)
4. Verify:
   - Countdown 3-2-1-GO appears
   - Stick figure runs on the ground
   - Obstacles scroll from right to left
   - ActionStaffs appear on the right (jump top, duck bottom)
   - Health bar appears on the left
   - Piano keyboard at bottom highlights target notes
   - Playing the jump note makes the figure jump
   - Playing the duck note makes the figure duck
   - Hitting an obstacle reduces health
   - Dodging obstacles heals
   - Game over when health depletes
   - Score/level display works

### Step 2: Run engine unit tests

```bash
npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js
```

Expected: All tests PASS.

### Step 3: Final commit if any adjustments needed

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Game engine (pure functions + tests) | `sideScrollerEngine.js`, `sideScrollerEngine.test.js` |
| 2 | ActionStaff jump/duck icons | `ActionStaff.jsx` |
| 3 | piano.yml level config | `piano.yml` |
| 4 | Overlay component | `SideScrollerOverlay.jsx/.scss` |
| 5 | RunnerCanvas component | `RunnerCanvas.jsx/.scss` |
| 6 | Game state machine hook | `useSideScrollerGame.js` |
| 7 | Main layout + styles | `SideScrollerGame.jsx/.scss` |
| 8 | Game registry update | `gameRegistry.js` |
| 9 | Smoke test | Manual verification |
