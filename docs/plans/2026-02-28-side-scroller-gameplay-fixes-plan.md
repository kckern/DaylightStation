# Side-Scroller Gameplay Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three gameplay bugs — high blocks must be unjumpable (duck only), duck must have a time limit, and notes must rotate per dodge.

**Architecture:** Pure engine functions in `sideScrollerEngine.js` (no React, no side effects). Game loop in `useSideScrollerGame.js` wires engine into React state. TDD — all engine changes tested first.

**Tech Stack:** Vitest for engine tests, React hooks for game loop integration.

**Design doc:** `docs/plans/2026-02-28-side-scroller-gameplay-fixes-design.md`

---

### Task 1: Update high obstacle geometry — failing tests

**Files:**
- Modify: `frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js:88-97`

**Step 1: Update the existing high-obstacle spawn test to expect new geometry**

The high obstacle must be unjumpable. New geometry:
- `height`: `0.30` (was `0.05`)
- `y`: `GROUND_Y - PLAYER_HEIGHT + 0.02 - 0.30` = `0.22` (bottom stays at `0.52`)

Change the test at line 88–97:

```js
  it('spawns a high obstacle — unjumpable pillar', () => {
    const world = createInitialWorld();
    const next = spawnObstacle(world, OBSTACLE_HIGH);
    const obs = next.obstacles[0];
    expect(obs.type).toBe(OBSTACLE_HIGH);
    expect(obs.x).toBe(1.05);
    expect(obs.height).toBeCloseTo(0.30, 1);
    // Bottom baseline = GROUND_Y - PLAYER_HEIGHT + 0.02 = 0.52
    // y = bottom - height = 0.52 - 0.30 = 0.22
    expect(obs.y).toBeCloseTo(0.22, 2);
  });
```

**Step 2: Add test proving jumping cannot clear a high obstacle**

Add after the existing collision tests (after line 506):

```js
  it('collides with high obstacle even at jump peak', () => {
    // At jump peak: playerY = GROUND_Y - JUMP_HEIGHT = 0.43
    // Player hitbox top = 0.43 - PLAYER_HEIGHT = 0.25
    // High obstacle: y=0.22, bottom=0.52
    // Overlap: 0.25 < 0.52 && 0.43 > 0.22 → true
    const world = {
      ...createInitialWorld(),
      playerState: 'jumping',
      playerY: GROUND_Y - JUMP_HEIGHT, // 0.43 — peak of jump
      obstacles: [
        {
          type: OBSTACLE_HIGH,
          x: PLAYER_X,
          y: 0.22,
          width: 0.05,
          height: 0.30,
          hit: false,
          dodged: false,
        },
      ],
    };
    const hits = checkCollisions(world);
    expect(hits.length).toBe(1);
  });
```

**Step 3: Update the existing "does not collide with high obstacle when ducking" test**

The test at line 459–482 uses old geometry. Update the obstacle in that test:

```js
  it('does not collide with high obstacle when ducking', () => {
    const world = {
      ...createInitialWorld(),
      playerState: 'ducking',
      obstacles: [
        {
          type: OBSTACLE_HIGH,
          x: PLAYER_X,
          y: 0.22,
          width: 0.05,
          height: 0.30,
          hit: false,
          dodged: false,
        },
      ],
    };
    // Ducking hitbox top = GROUND_Y - PLAYER_DUCK_HEIGHT = 0.68 - 0.09 = 0.59
    // High obstacle bottom = 0.22 + 0.30 = 0.52
    // 0.59 < 0.52 is false → no vertical overlap → no collision
    const hits = checkCollisions(world);
    expect(hits.length).toBe(0);
  });
```

**Step 4: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`

Expected: The spawn test and jump-peak collision test FAIL (old geometry doesn't match new expectations).

**Step 5: Commit failing tests**

```bash
git add frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js
git commit -m "test(side-scroller): update high obstacle tests for unjumpable geometry"
```

---

### Task 2: Implement high obstacle geometry change

**Files:**
- Modify: `frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.js:78-85`

**Step 1: Change the high obstacle branch in `spawnObstacle()`**

Replace lines 81–84:

```js
  } else {
    // high obstacle just above standing head — must duck to clear
    height = 0.05;
    y = GROUND_Y - PLAYER_HEIGHT - 0.03;
  }
```

With:

```js
  } else {
    // Tall pillar — unjumpable, must duck to clear
    // Bottom baseline at GROUND_Y - PLAYER_HEIGHT + 0.02 = 0.52
    // Extends above jump peak (player top at peak = 0.25)
    height = 0.30;
    y = GROUND_Y - PLAYER_HEIGHT + 0.02 - height;
  }
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`

Expected: ALL PASS

**Step 3: Commit**

```bash
git add frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.js
git commit -m "fix(side-scroller): make high obstacles unjumpable pillars"
```

---

### Task 3: Duck timer — failing tests

**Files:**
- Modify: `frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`

**Step 1: Add imports for new exports**

Add `updateDuck` and `MAX_DUCK_MS` to the import block at line 1–24. The updated import:

```js
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
} from './sideScrollerEngine.js';
```

**Step 2: Update constants test to include MAX_DUCK_MS**

In the `constants` describe block (line 28–40), add:

```js
    expect(MAX_DUCK_MS).toBe(800);
```

**Step 3: Update createInitialWorld test to include duckStartT**

In the `createInitialWorld` describe, update the expected state (line 47-58) to include:

```js
    duckStartT: 0,
```

**Step 4: Update applyDuck tests for timestamp parameter**

Replace the `applyDuck` describe block (lines 294–312) with:

```js
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
```

**Step 5: Add updateDuck tests**

Add a new describe block after the `applyDuck` tests:

```js
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
```

**Step 6: Update releaseDuck test to verify duckStartT reset**

In the `releaseDuck` describe (lines 314-340), update the first test:

```js
  it('returns to running and resets duckStartT if ducking', () => {
    const world = { ...createInitialWorld(), playerState: 'ducking', duckStartT: 5000 };
    const released = releaseDuck(world);
    expect(released.playerState).toBe('running');
    expect(released.duckStartT).toBe(0);
  });
```

**Step 7: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`

Expected: FAIL — `updateDuck` and `MAX_DUCK_MS` not exported, `duckStartT` not in world state, `applyDuck` doesn't accept timestamp.

**Step 8: Commit failing tests**

```bash
git add frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js
git commit -m "test(side-scroller): add duck timer tests"
```

---

### Task 4: Implement duck timer in engine

**Files:**
- Modify: `frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.js`

**Step 1: Add MAX_DUCK_MS constant**

After the `JUMP_HEIGHT` constant (line 42), add:

```js
export const MAX_DUCK_MS = 800;
```

**Step 2: Add duckStartT to createInitialWorld**

In `createInitialWorld()` (line 50–62), add `duckStartT: 0` to the returned object, after `jumpT: 0,`.

**Step 3: Update applyDuck to accept and store timestamp**

Replace the `applyDuck` function (lines 214–220):

```js
export function applyDuck(world, now) {
  if (world.playerState === 'jumping') return world;
  return {
    ...world,
    playerState: 'ducking',
    duckStartT: now,
  };
}
```

**Step 4: Add updateDuck function**

Add after `releaseDuck` (after line 233):

```js
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
```

**Step 5: Update releaseDuck to reset duckStartT**

Replace the `releaseDuck` function:

```js
export function releaseDuck(world) {
  if (world.playerState !== 'ducking') return world;
  return {
    ...world,
    playerState: 'running',
    duckStartT: 0,
  };
}
```

**Step 6: Update the header comment**

In the world state shape comment (lines 8–18), add `duckStartT: 0` after `jumpT: 0,`:

```
 *   duckStartT: 0,       // timestamp when duck started (0 = not ducking)
```

**Step 7: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`

Expected: ALL PASS

**Step 8: Commit**

```bash
git add frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.js
git commit -m "feat(side-scroller): add duck timer with auto stand-up"
```

---

### Task 5: Wire duck timer and note rotation into game loop

**Files:**
- Modify: `frontend/src/modules/Piano/SideScrollerGame/useSideScrollerGame.js`

**Step 1: Add updateDuck and MAX_DUCK_MS to imports**

Update the import from `sideScrollerEngine.js` (lines 5–20) to include `updateDuck` and `MAX_DUCK_MS`:

```js
import {
  TOTAL_HEALTH,
  MAX_DUCK_MS,
  createInitialWorld,
  spawnObstacle,
  tickWorld,
  applyJump,
  applyDuck,
  releaseDuck,
  updateJump,
  updateDuck,
  checkCollisions,
  applyDamage,
  applyHeal,
  evaluateLevel,
  OBSTACLE_LOW,
  OBSTACLE_HIGH,
} from './sideScrollerEngine.js';
```

**Step 2: Add maxDuckMs to config memo**

In the `config` useMemo (lines 97–103), add:

```js
    maxDuckMs: gameConfig?.max_duck_ms ?? MAX_DUCK_MS,
```

**Step 3: Wire updateDuck into the game loop**

In the `setWorld` updater inside `gameLoop` (around line 165), add `updateDuck` call right after `updateJump`:

```js
      next = updateJump(next, dt, config.jumpDurationMs);
      next = updateDuck(next, timestamp, config.maxDuckMs);
```

**Step 4: Pass timestamp to applyDuck in handleAction**

Update `handleAction` (lines 244–251) to capture timestamp:

```js
  const handleAction = useCallback((actionName) => {
    logger.debug('side-scroller.action', { action: actionName });
    if (actionName === 'jump') {
      setWorld(prev => applyJump(prev));
    } else if (actionName === 'duck') {
      const now = performance.now();
      setWorld(prev => applyDuck(prev, now));
    }
  }, [logger]);
```

**Step 5: Remove target_rotation guard for dodge-based regeneration**

In the target regeneration effect (lines 267–276), remove the `target_rotation !== 'dodge'` guard. Change:

```js
    if (!lvlConfig || lvlConfig.target_rotation !== 'dodge') return;
```

To:

```js
    if (!lvlConfig) return;
```

This makes notes always rotate on dodge in side-scroller mode.

**Step 6: Run engine tests to verify nothing broke**

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`

Expected: ALL PASS

**Step 7: Commit**

```bash
git add frontend/src/modules/Piano/SideScrollerGame/useSideScrollerGame.js
git commit -m "feat(side-scroller): wire duck timer and always-rotate targets into game loop"
```

---

### Task 6: Final verification and design doc update

**Step 1: Run all engine tests one final time**

Run: `npx vitest run frontend/src/modules/Piano/SideScrollerGame/sideScrollerEngine.test.js`

Expected: ALL PASS

**Step 2: Verify no other tests broke**

Run: `npx vitest run`

Expected: No regressions in other test files.

**Step 3: Update design doc status**

In `docs/plans/2026-02-28-side-scroller-gameplay-fixes-design.md`, change status from `Approved` to `Implemented`.

**Step 4: Commit**

```bash
git add docs/plans/2026-02-28-side-scroller-gameplay-fixes-design.md
git commit -m "docs: mark side-scroller gameplay fixes as implemented"
```
