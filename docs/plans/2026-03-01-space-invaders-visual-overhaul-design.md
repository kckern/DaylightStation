# Space Invaders Visual & Gameplay Overhaul

**Date:** 2026-03-01
**Status:** Approved

## Summary

Four interconnected changes that transform the Space Invaders piano game from generic falling blocks into a cohesive arcade experience:

1. Replace falling blocks with classic pixel-art space invader SVG sprites
2. Replace full-height lane columns with glow trails behind each invader
3. Replace instant hit detection with laser projectiles fired from piano keys
4. Add destroyed-key mechanic: missed notes destroy the key, which rebuilds after a cooldown

---

## 1. Space Invader Sprites

### Current
Falling notes are `div.game-note` — colored rectangles (48px tall) with a note label.

### New
Inline SVGs using an 11x8 pixel grid, rendered as 3 classic invader variants:

- **Variant A (Crab)**: Alternating arm frames
- **Variant B (Squid)**: Tentacle shape
- **Variant C (Wide-body)**: Shield/UFO shape

Selection: `note.id % 3` determines variant.

### Visual Details
- SVG tinted via CSS `fill` using existing `--hue` variable (pitch-based coloring preserved)
- Note label (C, D#, etc.) renders as small text below the sprite
- Size: scales to column width, preserving aspect ratio (~48px footprint)
- Animation: 2-frame "march" toggle (arms/legs swap) at ~2fps while `state === 'falling'`; freezes on hit/miss

### Implementation
- Create `InvaderSprite.jsx` component with `variant` and `frame` props
- SVG data defined as path arrays (no external files)
- Frame toggle via CSS animation or interval in the parent

---

## 2. Glow Trails (Replacing Full-Height Lanes)

### Current
`.game-lane` columns are full-height, always visible (6% opacity, 15% when active).

### New
Remove `.game-lane` elements entirely. Each falling invader carries its own trailing glow beam.

### Visual Details
- Implemented as `::before` pseudo-element on `.game-note`
- Width: matches column width
- Height: extends upward from sprite to top of waterfall (equals the sprite's `top%` position)
- Background: `linear-gradient(to top, hsla(var(--hue), 70%, 50%, 0.4), transparent)`
- Filter: `blur(2px)` for soft glow edge
- z-index: behind the sprite

### Behavior
- Trail naturally shortens near the top, lengthens as invader descends
- On hit: trail dissolves upward over ~300ms
- On miss: trail flashes red and fades out over ~500ms

---

## 3. Laser Projectile Mechanic

### Current
Hit detection is instant — press key, note immediately transitions to `hit` state.

### New
Key press spawns a laser projectile that travels upward; hit occurs on collision.

### Gameplay Flow

**Correct key press (invader exists in column):**
1. Laser spawns at top of piano key
2. Travels upward at speed covering waterfall height in ~250ms
3. Note stays in `falling` state during laser travel
4. On collision (laser y ≤ note y in same column): explosion triggers, note → `hit`, score applies
5. If invader passed the zone before laser arrives: laser dissipates, no hit (note eventually misses naturally)

**Wrong key press (no invader in column):**
1. Laser fires upward (visual feedback)
2. Dissipates at waterfall top after ~250ms
3. Wrong-note penalty applies as before (health damage, red flash, buzzer)

### State Tracking
New `lasers` array in game state:
```javascript
{ id, pitch, spawnTime, x, active }
```
Tick loop advances each laser's y-position. Collision detection checks laser-y vs falling-note-y in matching columns.

### Visual
- Narrow beam: ~4px wide, ~20px tall core
- Color: bright cyan/white
- `box-shadow` glow effect
- CSS animation from keyboard to target (or top if miss)

---

## 4. Destroyed Keys with Cooldown Rebuild

### Current
Wrong notes cause a 400ms red glow on the key. No lasting consequence for misses.

### New
Missed notes destroy the piano key, which becomes non-functional until rebuilt after a cooldown.

### Destruction
1. Invader "lands" on key — brief shake + impact flash animation
2. Key gets `.piano-key--destroyed` class:
   - Grayscale filter + reduced opacity (~0.4)
   - Diagonal line overlay pattern (CSS-only "cracked" look)
   - Key press still registers but laser does NOT spawn
3. Pitch tracked in `destroyedKeys` Map: `pitch → { destroyedAt, cooldownMs }`

### Cooldown & Progress Meter
- Duration: ~8 seconds (configurable in gameConfig, could scale with level difficulty)
- Progress bar renders above or overlaid on the destroyed key
- Fill grows from 0% → 100% over cooldown period
- Color transitions: red → yellow → green as rebuild progresses

### Rebuild
- On completion: brief cyan "power up" glow pulse
- `.piano-key--destroyed` class removed
- Key functions normally, laser can fire again

### Auto-Miss Behavior
- Notes falling on destroyed columns are uncontested
- They fall through and count as regular misses (increment miss counter)
- The spawn system does NOT avoid destroyed columns — creates cascading pressure

---

## Files to Modify

| File | Changes |
|------|---------|
| `PianoSpaceInvaders/SpaceInvadersGame.jsx` | Pass `destroyedKeys` and `lasers` state to children |
| `PianoSpaceInvaders/useSpaceInvadersGame.js` | Add `lasers` array, `destroyedKeys` Map, deferred hit detection, cooldown tick logic |
| `PianoSpaceInvaders/spaceInvadersEngine.js` | Add `spawnLaser()`, `advanceLasers()`, `checkLaserCollisions()`, `processDestroyedKeys()` |
| `components/NoteWaterfall.jsx` | Render invader SVGs instead of div blocks; render laser projectiles; remove `.game-lane` elements; add glow trail pseudo-elements |
| `components/NoteWaterfall.scss` | Remove `.game-lane` styles; add `.game-note::before` trail; add `.laser-projectile` styles; add invader sprite sizing/animation |
| `components/PianoKeyboard.jsx` | Accept `destroyedKeys` prop; render progress bar on destroyed keys |
| `components/PianoKeyboard.scss` | Add `.piano-key--destroyed` styles; add rebuild progress bar styles |
| `PianoSpaceInvaders/SpaceInvadersGame.scss` | Minor layout adjustments if needed |
| NEW: `components/InvaderSprite.jsx` | SVG invader component with 3 variants and 2-frame animation |

---

## Config Additions (gameConfig)

```yaml
laser_travel_ms: 250          # Time for laser to cross waterfall
key_rebuild_cooldown_ms: 8000  # How long destroyed key stays down
```

---

## Interaction Matrix

| Event | Visual | Game State |
|-------|--------|------------|
| Invader spawns | SVG appears at top with short glow trail | Added to `fallingNotes` |
| Invader falls | Trail lengthens, 2-frame march animation | `top%` increases each tick |
| Correct key press | Laser fires upward from key | Laser added to `lasers` array |
| Laser hits invader | Explosion particles, trail dissolves, invader disappears | Note → `hit`, score applied |
| Wrong key press | Laser fires but hits nothing, red flash | Health damage, wrong note glow |
| Invader reaches bottom | Impact on key, key cracks/darkens | Note → `missed`, key → destroyed |
| Destroyed key pressed | Key visually unresponsive (no laser) | No laser spawned |
| Note falls on destroyed key | Falls through uncontested | Auto-miss counted |
| Cooldown expires | Cyan power-up flash, key restored | Key removed from `destroyedKeys` |
