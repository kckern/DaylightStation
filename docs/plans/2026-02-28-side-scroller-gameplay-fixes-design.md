# Side-Scroller Gameplay Fixes Design

**Date:** 2026-02-28
**Status:** Implemented

## Problem

Four gameplay issues in the SideScrollerGame:

1. **High blocks are jumpable** — Player can jump over high (blue) blocks that should require ducking. The block height (0.05) is far smaller than the jump arc (JUMP_HEIGHT=0.25).
2. **Unlimited duck duration** — Players hold the duck note well before a high block arrives and stay ducked until it passes. No timing skill required.
3. **Same notes persist across obstacles** — Jump/duck target pitches only rotate on level advance or explicit `target_rotation: 'dodge'` config. The same note triggers the same action across many consecutive obstacles.

## Design

### 1. Unjumpable High Blocks

Change high obstacle geometry in `spawnObstacle()`:

- **Height**: `0.05` → `0.30`
- **Bottom baseline**: stays at `GROUND_Y - PLAYER_HEIGHT + 0.02` = `0.52`
- **Top (y)**: `0.52 - 0.30` = `0.22`

Collision verification:
- Standing player (top=0.50): `0.50 < 0.52 && 0.68 > 0.22` → collides ✓
- Jumping player at peak (top=0.25, bottom=0.43): `0.25 < 0.52 && 0.43 > 0.22` → collides ✓ (can't jump over)
- Ducking player (top=0.59): `0.59 < 0.52` → false → no collision ✓ (duck clears it)

### 2. Duck Time Limit (Auto Stand-Up)

Add timed duck mechanic to the engine:

- New world state field: `duckStartT` (timestamp when ducking began, 0 when not ducking)
- New constant: `MAX_DUCK_MS = 800` (configurable via `gameConfig.max_duck_ms`)
- In `applyDuck()`: set `duckStartT` to current timestamp
- New engine function `updateDuck(world, now, maxDuckMs)`: if ducking and `now - duckStartT >= maxDuckMs`, auto-release to running
- Call `updateDuck` in the game loop alongside `updateJump`
- `releaseDuck()` resets `duckStartT` to 0

### 3. Note Rotation Per Dodge

Make target regeneration happen on every dodge, regardless of level config:

- In `useSideScrollerGame.js`, the dodge-based regeneration effect currently checks `lvlConfig.target_rotation !== 'dodge'` and returns early. Remove that guard so regeneration always happens on dodge for side-scroller.
- This ensures each new obstacle gets fresh jump/duck pitches.

## Files Changed

| File | Change |
|------|--------|
| `sideScrollerEngine.js` | High block geometry, duck timer state/functions, new constants |
| `sideScrollerEngine.test.js` | Update tests for new geometry, add duck timer tests |
| `useSideScrollerGame.js` | Wire duck timer in game loop, always regenerate targets on dodge |

## Not Changed

- Low blocks: dimensions remain as-is (height=0.10, jumpable)
- Jump arc: JUMP_HEIGHT stays at 0.25
- RunnerCanvas rendering: no visual changes needed (CSS already handles any size)
