# Skyline Glider Design

**Status:** Approved for implementation  
**Product:** Fitness / garage display  
**Experience:** `skyline-glider`

## Intent

Skyline Glider is a five-minute, single-rider fitness game in which cadence
controls a hang glider's target screen altitude. It is a separate Fitness
module, not a Cycle Race mode and not a Piano side-scroller variant. The first
release must be forgiving enough to sustain exercise: collisions consume one
of three lives, exhausting the lives restarts at the latest checkpoint, and a
sensor transport failure cannot cost a life.

## Architecture

Fitness owns sensor interpretation, safety, rewards, continuous simulation,
and run persistence. A pure fixed-step engine consumes cadence snapshots and a
validated course; React owns the lobby, lifecycle, and SVG presentation. The
engine has no React, device, storage, or network dependencies. The existing
Piano and Cycle Race engines remain unchanged.

The terminal projection uses `gaming-result/v1`, but frame updates do not cross
the Gaming command journal. Courses are versioned YAML served by a Fitness
course catalog. A bundled Mountain Pass is always available and a household
course with the same ID may override it after passing the same validation.

## Gameplay Contract

- Existing equipment `rpm.min`/`rpm.max` values define the control band;
  missing values fall back to 30/100 RPM and invalid ranges fail closed.
- RPM maps linearly into viewport altitude 0.78 (low) through 0.18 (high),
  with a 0.75-second filter and 2-RPM deadband.
- Flight uses 60 Hz fixed steps, 1.5-second target response, a 0.30
  screen-height/second climb cap, and a 0.22 descent cap.
- Connected zero RPM coasts for one second and then descends. A disconnected
  input gets 0.75 seconds of collision-protected coast, then freezes with a
  reconnect overlay.
- A hit consumes one life, bounces the glider, and grants 1.25 seconds of
  invincibility. The third hit triggers a two-second crash ceremony and restores
  three lives at the latest checkpoint. There is no terminal game-over.
- Mountain Pass lasts about five minutes and has checkpoints near 25%, 50%, and
  75%. V1 segments are open sky, upper/lower terrain, corridor, collectible
  path, checkpoint, and finish.
- Collectibles have stable IDs. Checkpoint recovery restores the checkpoint's
  collected set so retries cannot duplicate reward credit.

## Experience and Presentation

The module manifest ID is `skyline_glider`, registered as
`fitness:skyline-glider` and reached at `/fitness/module/skyline_glider`. Its
lobby selects one cadence-capable machine and one rider. A three-second
countdown follows Start; the course clock waits for the first fresh sensor
reading.

The alpine-storybook theme is code-native SVG/CSS: parallax mountains, caves,
semantic terrain, pitching glider, wind trails, collision particles,
checkpoints, and finish ceremony. The HUD shows RPM, target altitude, lives,
progress, checkpoint, collectibles, and sensor state. Web Audio supplies wind
and cues with a mute control; v1 has no background music.

## Rewards and Persistence

Normal heart-rate rings accrue unchanged. Completion awards one idempotent
bonus through `TreasureBox.awardBonus`: 10 base rings plus one per unique
collectible, capped at 30, using
`rpm-flight:<runId>:completion:<userId>`.

A local checkpoint stores the run/course versions, active Fitness session,
rider/equipment, resolved calibration, latest checkpoint, lives, elapsed time,
and collected IDs. Reopening offers Resume or Start Over; mismatched sessions
or course versions cannot resume. Reload preserves the checkpoint, while Start
Over and explicit Exit persist the old attempt as abandoned.

The backend stores `skyline-glider-run/v1` records with summary metrics and
meaningful events, never frame snapshots. Same-ID/same-content saves are
idempotent; same-ID/different-content saves conflict. A Fitness activity
provider projects runs into session history. The terminal result uses
`gaming-result/v1` with experience ID `skyline-glider`.

## Scope Boundary

Deferred: multiplayer, eliminated-practice riders, revival policies,
heart-rate gameplay assists, split corridors, elevation transitions,
procedural courses, and additional themes.

