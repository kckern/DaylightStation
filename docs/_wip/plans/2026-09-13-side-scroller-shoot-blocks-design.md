# Side Scroller — Shootable Blocks, Shooting Poses, Death Explosion, SFX

**Status:** Approved 2026-09-13
**Scope:** `frontend/src/modules/Piano/SideScrollerGame/`, the household piano
config's `games.side-scroller` block, and four placeholder sound files.

## Goal

Use more of the Mega Man sheet and add a third verb. Today a run is only
jump-over-low / duck-under-high. Add a **block** that sits in the middle band —
too tall to jump over, too low to duck under — that must be **shot** with a
third staff. Losing ends in the classic Mega Man ring-of-orbs explosion.

## Decisions (owner, 2026-09-13)

| Question | Decision |
|---|---|
| When blocks appear | Mid-ladder. Levels 1–2 stay jump/duck only; one-shot bricks join at level 3; two-shot steel blocks join in the late levels. Per level, via config. |
| Fire input | One fresh press = one shot. Holding the chord does not auto-fire. |
| Two-shot block | Same note twice. The block cracks on the first hit; targets regenerate only when it breaks. |
| Death | Freeze, Mega Man bursts into the orb ring with the death sound, Game Over card ~2 s later. |

## Gameplay

### Block geometry

Normalized screen Y (0 = top). The player stands in [0.50, 0.68], ducks in
[0.59, 0.68], and at jump peak occupies [0.25, 0.43].

A block floats in **[0.38, 0.64]**:

- a jumping player's feet never rise above 0.43, which is below the block top,
  so every jump frame that overlaps horizontally collides — unjumpable;
- a ducking player's head (0.59) is above the block bottom (0.64) — unduckable;
- it stays clear of both staff zones (top 2–30 %, bottom 70–98 %).

### Obstacle mix

Each level may declare `obstacle_mix` — relative weights per type:

```yaml
obstacle_mix: { low: 1, high: 1, block: 1, block_hard: 1 }
```

Absent means `{ low: 1, high: 1 }`, which is today's behaviour. `block` takes one
shot, `block_hard` takes two.

### Shooting

- The shoot staff exists only on levels whose mix contains a block type.
- A shot spawns a pellet at the buster (player's leading edge, a little below
  chest height) that travels right faster than any scroll speed.
- Shooting while sliding (ducking) is ignored; shooting mid-jump is allowed but
  the pellet flies too high to reach a block.
- A pellet only interacts with blocks; it passes low and high obstacles.
- A hit decrements the block's hit points and consumes the pellet. At zero the
  block breaks: it stops colliding, plays a debris burst, awards a score bonus,
  and counts as a dodge (heal + target regeneration) exactly as clearing any
  other obstacle does.
- A block that reaches the player unbroken damages them like any obstacle.

### Targets

Three disjoint pitch sets. When the range spans both clefs, jump and shoot draw
from treble and duck from bass; otherwise all three come from one shuffled pool
kept at least four semitones apart where the pool allows. The sets never share a
pitch, so holding one action's chord can never fire another. Chord sizes fall
back to single notes when the pool is too small for three chords.

### Death

When health reaches zero the run enters a short `DYING` phase: the world
freezes, staff input stops, the player sprite is replaced by sixteen orbs (eight
directions × two speeds) radiating across the screen, and the death sound plays.
After ~2 s the phase becomes `GAME_OVER`. Finishing the last level still goes
straight to `GAME_OVER`.

## Presentation

### Sprite frames (5 × 6 grid of 256 px cells on the existing sheet)

| Pose | Cell(s) |
|---|---|
| stand | [0,0] |
| run | [0,1]–[3,1] |
| jump | [4,0] |
| duck (slide) | [0,3] |
| hurt (cycle) | [1,3], [2,3] |
| shoot, standing | [4,1] |
| shoot, running | [1,2]–[4,2] |
| shoot, jumping | [0,2] |
| pellet | [2,4] |

A shooting pose holds for ~250 ms after each shot. Any frame entry may be a
single cell or a cycle.

### Obstacles

Blocks render procedurally (brick with mortar lines; steel with rivets for the
two-shot variant), overridable per theme with `src` like the other skins. A
two-shot block shows cracks after its first hit. A broken block becomes four
debris shards that fly apart and fade. Obstacles carry stable ids so removal of
older obstacles never restarts another's animation.

### Staves

The shoot staff sits in the top band, to the right of the jump staff and
slightly lower, with a crosshair icon. On single-complexity levels the staff
matching the next obstacle stays bright and the others dim.

## Sound

Theme sound keys gain `shoot` and `death`. Paths are resolved through the media
path helper, so config may name `/media/audio/sfx/...` files. Silent 0.25 s
placeholders live at `media/audio/sfx/side-scroller/{jump,hit,shoot,death}.mp3`
and are wired in the household config's `theme.sounds`; replacing a file in
place changes the sound with no config or code change.

## Testing

- Engine: block geometry is unjumpable at every jump sample and unduckable;
  pellets spawn, travel, hit only blocks, consume on hit; hit points; breaking
  counts as a dodge; broken blocks never collide; shooting while ducking is a
  no-op; mix-weighted type selection.
- Targets: three disjoint sets across clef-split and single-clef ranges.
- Theme: new frames and cycles; sound keys.
- Visual: headless render of the running game with blocks, a shot, a break and
  the death burst.
