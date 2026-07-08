# Cycle Game — Race Visualization & Ghost System Audit

**Date:** 2026-06-04
**Scope:** The Cycle **Game** (multi-rider race) HUD panels, lap/oval model, ghost
system, and lobby selectors. *Not* the Cycle **Challenge** (governance) — separate feature.
**Method:** Tester observations from this morning's race sessions (2026-06-04),
corroborated against the code and the session log
`media/logs/fitness/2026-06-04T12-47-54.jsonl` (Firefox 151 / Linux kiosk — the
office screen — was the test surface: 33,266 of the morning's events carry that UA).
**Status:** Findings only. A remediation plan follows separately; nothing fixed here.

> Reference: `docs/reference/fitness/cycle-game.md` (architecture, file map, §9 panels).
> Prior, still-relevant audits cross-referenced inline: `2026-06-03-cycle-game-records-list-ux-evaluation.md`,
> `2026-06-02-cycle-game-frontend-design-audit.md`, `2026-06-03-cycle-game-design-usability-evaluation.md`.

---

## Summary of findings

| ID | Area | Finding | Severity | Log-corroborated? |
|----|------|---------|----------|-------------------|
| F1 | Animation | Oval markers snap per tick (SVG `transform` attribute can't be CSS-transitioned on the FF kiosk) | High | Indirect (visual; not in event logs) |
| F2 | Animation | Pistons/camera *do* glide but only ~0.45/0.3s then idle — not continuous like the chart's rAF | Medium | No (visual) |
| F3 | Animation | Rankings rows + lap-table rows reposition/append with no transition | Medium | No (visual) |
| F4 | Oval | Oval ignores `lap_length_m`; time race maps one loop to `oval_circuit_m` (1000 m), not one lap | High | Partial (distance ticks show 100 m cadence) |
| F5 | Lap list | New laps append below the fold with no auto-scroll/aggregation of older laps | Medium | No (visual) |
| F6 | Lap list | Partial laps (user×lap blank cell that fills on crossing) — **already implemented**, verify only | Low | n/a |
| F7 | Layout | Redesign: fuse oval + pistons + camera into one "race view" panel; split lap **list** into its own panel | Design | n/a |
| F8 | Standings | No gap labels (m / s behind) anywhere — though the data is already computed in the snapshot | High | n/a |
| F9 | Rankings | Ranking panel is a thin list; weak use of space — candidate host for the gap/interstitial data | Medium | n/a |
| F10 | Camera | View bounds pegged to min/max rider with **no margin**; grid "pan" is imperceptible and not motion-coupled | High | n/a |
| F11 | Ghosts | Ghost avatar styling (grayscale + blue tint) applied inconsistently across panels | High | n/a |
| F12 | Ghosts | "Tap again to choose" label in the ghost picker breaks the card layout (word-wrap) | Medium | n/a |
| F13 | Ghosts | Selecting a multi-rider ghost race imports **all** participants — no subset picker | Medium | Yes (3-rider ghost field imported) |
| F14 | Ghosts | **Ghost-of-a-ghost**: nested id `ghost:R2:ghost:R1:user` → `split(':')[2]` = `"ghost"` → broken avatar | High | **Yes** (nested id created in logs) |
| F15 | History | Records "who" column crammed (👑 + name + "+N"); no winner avatar, no ghost styling | Medium | Cross-ref `2026-06-03-records-list` |

---

## 1. Animation / motion smoothness

The `DistanceChart` is smooth because it animates in **JavaScript**: a `requestAnimationFrame`
clock (`tickFrac`, `TICK_INTERP_MS = 1000`) interpolates each lane's leading point across the
full 1 Hz tick interval (`DistanceChart.jsx:136–154`), plus a snap-then-ease CSS zoom
(`ZOOM_ANIM_MS = 300`). Every **other** panel relies on CSS `transition`. There is **no**
global `prefers-reduced-motion` or `* { transition:none }` rule disabling those transitions
(checked) — so the differences below are per-panel, not one global switch.

### F1 — Oval markers snap (SVG transform attribute) — **High**

`OvalTrack.jsx:56` positions each marker with the SVG **presentation attribute**
`transform={`translate(${p.x} ${p.y})`}`. `OvalTrack.scss:43–44` then declares
`.cg-oval-track__marker { transition: transform 0.3s linear; }` and the code comment claims
"markers glide via a CSS transform transition." They do not. A CSS `transition` animates the
CSS **`transform` property**, not the SVG `transform` *attribute*; without `transform-box` /
`transform-origin` and with the value arriving via the attribute, the transition does not fire
on the kiosk's Firefox 151 engine — the dots jump to each new tick position. This is the "low
budget animation … they just kind of appear" the tester described. (Contrast F2: the HTML
pistons/camera markers, positioned via `left`/`width`, *do* transition.)

**Direction:** stop transitioning the SVG attribute. Either (a) render markers as an HTML
overlay positioned with `left/top` % (transitionable), or (b) drive them with the CSS
`transform` *property* + `transform-box: fill-box`/explicit origin, or (c) rAF-interpolate the
`(x,y)` like the chart. Option (c) gives the *consistent, continuous* motion the tester wants
("points need to move around the oval … in a consistent way").

### F2 — Pistons & camera glide but not continuously — **Medium**

`RacePistons` (HTML divs) transitions `width`/`left` at `0.45s cubic-bezier`
(`RacePistons.scss:30,39`); `CameraZoom` markers transition `left 0.3s linear`
(`CameraZoom.scss:73`). These **work** on Firefox. But a CSS transition fires once per tick and
**completes in 0.45 s, then sits idle for the remaining ~0.55 s** of the 1 Hz interval — a
"move, pause, move" cadence — whereas the chart glides continuously across the *entire* second.
Against the chart's buttery motion, the pistons read as steppy.

**Direction:** unify the motion model. Cheapest: lengthen these transitions to ~`1s linear` so
each glide fills the tick interval (linear matches the tester's "even if it's just linear
interpolation, that's fine"). Better/consistent: share the chart's rAF interpolation clock so
every panel advances on the same continuous timeline.

### F3 — Rankings & lap-table rows have no smoothing — **Medium**

`Rankings` re-sorts the roster every render and re-lays the rows with no positional transition
(`CycleRaceScreen.scss:138–161`) — places swap instantly. `LapTable` appends a new `<tr>` per
completed lap with no enter animation. `SpeedoRow` is a static flex row (gauges animate
internally; the row itself doesn't move).

**Direction:** add a FLIP / transform transition to ranking rows on reorder; a brief
fade/slide-in on new lap rows (ties into F5 auto-scroll).

---

## 2. Oval & laps

### F4 — Oval does not honor `lap_length_m` — **High**

`lap_length_m` was just set to **100 m**, but the oval ignores it. `ovalTrackModel.js`:
`circuitTargetFor(winCondition, goalM, ovalCircuitM)` returns `goalM` for a **distance** race and
`oval_circuit_m` (config = **1000 m**, default 1000) for a **time** race (lines 12–15);
`circuitProgress = distance / target` (lines 17–21). So one loop of the oval = the *whole race*
(distance) or *one 1000 m circuit* (time) — **never one lap**. The lap machinery
(`lapModel.lapCount/lapProgress`, `lap_length_m`) is fully decoupled from the oval geometry.
In a time race the marker is effectively `distance / 1000 m` around the loop — the tester's "it
just maps it to a basic timer, which isn't right."

This is a **deliberate reversal** of a recent decision: commit `5493e0c24`
("OvalTrack as a whole-race track (one loop = race), decoupled from laps"). The tester now wants
the opposite: **one revolution = one lap**, the lap completing at the top (start/finish tick).

**Direction:** drive the oval angle from `lapProgress(distance, lap_length_m)` (each 100 m = one
full revolution), show the lap counter from `lapCount(distance, lap_length_m)`, and fire a lap
event as the marker crosses the top tick. Reconcile with the "whole-race track" framing in
`cycle-game.md §9.5` (this doc reverses it). For a *distance* race with laps on, the same
per-lap revolution applies; the goal line is `lapCount` total laps.

### F5 — Lap list crowds and scrolls out of view — **Medium**

`LapPanel.scss:14–16` sets `&__table { overflow-y: auto }`, but nothing scrolls it. As laps
accrue, new rows append **below the fold** and stay there ("works for the first two or three
laps, then … out of view"). There is no auto-scroll-to-newest and no aggregation/compaction of
older laps.

**Direction:** auto-scroll the table to the newest lap, and/or compact older laps into an
aggregated header row so **all** laps stay visible (older ones summarized). Pairs with the F7
split (lap **list** as its own panel with room to grow).

### F6 — Partial laps already handled — **Low (verify only)**

The tester asked for blank cells when one rider has completed a lap and another hasn't, filling
in on crossing. This **already exists**: `LapTable.jsx:19,38–47` builds a user×lap grid sized to
`max(splits length)` and renders an em-dash for cells where `i >= splits.length`. No work beyond
visual confirmation once F4/F5/F7 land.

---

## 3. Panel layout redesign

### F7 — Fuse oval + pistons + camera; split out the lap list — **Design direction**

Tester proposal: the oval, the piston standings, and the zoom/pan camera are all the *spatial*
representation of the race — combine them into a **single "race view" panel**: always show the
oval; on the bottom half alternate between pistons and the camera (with logic for when to show
which). The **lap list** then becomes its own standalone panel (so it has vertical room for F5).

Current architecture (per `racePanels.js` / `raceDirector.js`, `cycle-game.md §9.2–9.4`):
`lapPanel` = oval **+ lap table** fused; `racePistons` separate; `cameraZoom` a director
**transient**. The proposal regroups along a different axis (spatial views together; lap *list*
apart). This is the largest item and reshapes the panel registry + director zone assignment.

**Direction:** treat as a layout redesign — new "race view" composite panel (oval fixed top, an
alternator for pistons/camera bottom), `lapList` promoted to its own director panel. Define the
alternation policy (e.g. camera during LAPPING_IMMINENT/PHOTO_FINISH, pistons otherwise — reusing
the existing transient triggers).

---

## 4. Standings legibility

### F8 — No "behind by" gap labels anywhere — **High**

The whole point of the spatial panels is reading who's ahead/behind and by how much. Today the
gap is only *implicit* in bar length / marker spacing — there is **no numeric gap** (meters in a
distance race, seconds in a time race) on the pistons, the camera connector, or the rankings.

Crucially, **the data already exists**: `deriveRaceSnapshot` computes `leaderGapM`,
`tightestPairGapM`, and `closingRateMPS` (`cycle-game.md §9.1`). It is simply never surfaced as a
label. The `CameraZoom` connector is drawn (`CameraZoom.jsx:50–56`) but carries no readout.

**Direction:** render a gap label on the connector / between piston bars (and see F9 for
rankings) — meters for distance races, derived seconds for time races (`gapM / closingRateMPS`
or a per-rider time-to-here). Update each tick.

### F9 — Ranking panel: weak use of space — **Medium**

`Rankings.jsx` renders rank/medal + avatar + name + a single distance/finish-time metric per row
— a thin list that under-uses its zone. Tester suggests enriching it (or merging it) with the
F8 gap data: an **interstitial connector/segment between ranked rows** showing how far ahead/
behind each rider is from the one above, updating live.

**Direction:** add inter-row gap connectors (the "+20 m / +3 s behind" rail) to the rankings;
evaluate merging rankings with the pistons (both are `fieldSize ≥ 2`, both keyed on
`leaderGapM`) so the standings live in one richer panel.

---

## 5. Camera / zoom panel

### F10 — No framing margin; grid doesn't convey motion — **High**

**Bounds:** `framePositions` (`CameraZoom.jsx:15–23`) maps the trailing rider to **0%** and the
leader to **100%** — markers pin to the literal edges with **zero margin/framing** (tester:
"leaves no margin … no framing").

**Grid:** `CameraZoom.scss:39,109–112` animates `cg-camera-drift` shifting `background-position`
by **exactly one 38 px cell over 6 s**. Because the backdrop is a `repeating-linear-gradient` with
a 38 px period, shifting by one full period looks **identical** start-to-end — the motion is
imperceptible, and it's a fixed 6 s loop **decoupled from race speed**, so it conveys no panning/
tracking (tester: "absolute and utter failure"). Only the cyan vertical lines drift; the magenta
horizontals don't move at all.

**Direction:** (a) add ≥15% padding to the normalized range (map min→~15%, max→~85%) so there's
framing context; (b) make the grid drift proportional to the field's forward speed / leader
position (a true camera pan) rather than a fixed loop, and make the drift visibly faster — the
synthwave/Tron grid should read as the world moving past the riders.

---

## 6. Ghost system

### F11 — Ghost avatar styling is inconsistent — **High**

The ghost treatment is defined once — `.cg-ghost` in `_cgTokens.scss` (grayscale + contrast +
brightness on the `<img>`, plus a blue tint via `mix-blend-mode: color`). It is applied in some
renderers and missed in others:

| Renderer | File:line | Ghost style? |
|----------|-----------|--------------|
| Speedometer | `CycleSpeedometer.jsx:112` | ✅ `cg-ghost` |
| Rankings | `Rankings.jsx:55` | ✅ `cg-ghost` |
| Race results | `RaceResults.jsx:64` | ✅ `cg-ghost` |
| **RacePistons** | `RacePistons.jsx:48–57` | ❌ uses `CircularUserAvatar` with `opacity` only — no grayscale/tint |
| **OvalTrack** | `OvalTrack.jsx:58–67` | ❌ no avatar at all — colored dot + initial, dashed stroke |
| **CameraZoom** | `CameraZoom.jsx:72` | ❌ no avatar — initial in a circle, opacity 0.55 |
| **DistanceChart tags** | `DistanceChart.jsx` (`is-ghost`) | ⚠ opacity/dash, not the `cg-ghost` face |
| **Ghost picker cards** | `CycleGameHome.jsx:~523` | ❌ plain `<img>`, no filter |

**Direction:** make the ghost face the single styled primitive everywhere a rider is shown — wrap
the piston tip avatar in `cg-ghost`, give the oval/camera markers the real face (styled) instead
of a bare initial where space allows, and apply `cg-ghost` to the picker cards. Pulls the avatar
identity + ghost cue consistent across all panels.

### F12 — "Tap again to choose" label breaks the picker layout — **Medium**

`CycleGameHome.jsx:537` renders `{isFocused && <span className="cgh-ghost-card__confirm">Tap
again to choose</span>}`; styled `flex-shrink: 0` (`CycleGameHome.scss:830–838`) inside a flex
card with no max-width, so on a focused card it forces word-wrapping and disrupts the row. The
two-tap model (tap = highlight, tap again = select) is already visually obvious.

**Direction:** delete the label entirely (string + span + its SCSS).

### F13 — No subset picker for multi-rider ghost races — **Medium**

`onSelectGhost` (`CycleGameContainer.jsx:~950–992`) maps **every** participant of the chosen
race into ghost riders (`ghost:${raceId}:${p.id}`), filtering only those with empty series.
There is no UI to expand a race and choose *which* riders to bring in. The morning's logs show a
3-rider ghost field imported wholesale.

**Direction:** when a selected ghost race has ≥2 participants, open a small selector to pick the
subset to race against (default all).

### F14 — Ghost-of-a-ghost breaks identity resolution — **High** (log-corroborated)

`participantIdentity.js:16`: `sourceId = isGhost ? (id.split(':')[2] || id) : id`. For a
first-order ghost `ghost:R1:user_1` → `[2] = "user_1"` ✓. For a **second-order** ghost
`ghost:R2:ghost:R1:user_1` → `split(':') = ['ghost','R2','ghost','R1','user_1']` → `[2] = "ghost"`
→ `avatarSrc = /api/v1/static/img/users/ghost` → 404 → broken/generic face. This is exactly the
"avatar completely messed up" the tester saw.

**Corroboration:** the morning's log contains the nested id being created in practice —
`ghost:20260604055802:ghost:20260604055230:user_1` — confirming second-order ghosts are minted
rather than dereferenced.

**Direction:** two layers. (1) Defensive parse: resolve `sourceId` to the **last** segment
(`id.split(':').pop()`) so the avatar never 404s. (2) Real fix the tester asked for: at *import*
time (`onSelectGhost`), if a chosen participant is itself a ghost, **dereference through to the
original ride/rider** (follow the `ghost:R:source` chain back to the first-generation recording)
so we only ever store and replay a **first-generation** ghost — never a ghost of a ghost.

### F15 — History "who" column crammed; no winner avatar — **Medium**

The records table (`CycleGameHome.jsx:~669–738`, row model `recordRow.js`) has good columns
(who / dist / time / when) but the "who" cell crams 👑 + winner name + a `+N` badge, no avatars.
The tester wants: a single **winner avatar**, plus a compact "others were here" indicator
(stacked/cropped avatars or a count) to its right, with **ghost styling** applied when the winner
is a ghost. Much of the surrounding table critique is already documented in
`2026-06-03-cycle-game-records-list-ux-evaluation.md` (F1–F9 there); this adds the winner-avatar
+ concealed-field treatment and the ghost-style requirement.

**Direction:** replace the crown/text cell with `winner avatar (cg-ghost if ghost) + stacked
crescent of N−1 others`; reuse `participantIdentity` for faces (and F14's deref so a ghost winner
shows the real face).

---

## 7. What the logs do and don't corroborate

The session log (`2026-06-04T12-47-54.jsonl`, ~105 MB, 6 races, debug firehose on) confirms:

- **Lap cadence** is consistent with 100 m laps — `cycle_game.tick` `distanceM` advances ~3 m/s,
  ~33 ticks per 100 m. (Lap *completion* is an overlay detail, not its own log event.)
- **Second-order ghost ids are real** — `ghost:<race>:ghost:<race>:user_1` appears (F14).
- **Multi-rider ghost import** — a 3-entity field (human + 2 ghost variants) ran (F13).
- **No cycle-game errors/warnings** were emitted (the F14 break is a silent 404 avatar fallback,
  not a thrown error; the animation issues are visual and never reach the event stream).

Not observable in logs (visual only): F1–F3, F5, F7, F8–F11, F12, F15.

---

## 8. Touch-point file map (for the follow-up plan)

| Finding | Primary files |
|---------|---------------|
| F1 | `panels/OvalTrack.jsx` (:56), `panels/OvalTrack.scss` (:43–44) |
| F2 | `panels/RacePistons.scss` (:30,39), `panels/CameraZoom.scss` (:73) |
| F3 | `panels/Rankings.jsx`, `CycleRaceScreen.scss` (:138–161), `panels/LapTable.jsx` |
| F4 | `lib/cycleGame/ovalTrackModel.js`, `panels/OvalTrack.jsx`, `CycleRaceScreen.jsx` (:84–91), `lib/cycleGame/lapModel.js` |
| F5 | `panels/LapPanel.jsx`/`.scss`, `panels/LapTable.jsx` |
| F7 | `lib/cycleGame/racePanels.js`, `lib/cycleGame/raceDirector.js`, `RaceLayoutManager.jsx`/`.scss`, `panels/LapPanel.jsx` |
| F8 | `lib/cycleGame/deriveRaceSnapshot.js` (gap signals), `panels/CameraZoom.jsx`, `panels/RacePistons.jsx` |
| F9 | `panels/Rankings.jsx`, `CycleRaceScreen.scss` |
| F10 | `panels/CameraZoom.jsx` (:15–23), `panels/CameraZoom.scss` (:19–40,109–112) |
| F11 | `_cgTokens.scss` (`.cg-ghost`), `panels/RacePistons.jsx`, `panels/OvalTrack.jsx`, `panels/CameraZoom.jsx`, `panels/DistanceChart.jsx`, `CycleGameHome.jsx` |
| F12 | `CycleGameHome.jsx` (:537), `CycleGameHome.scss` (:830–838) |
| F13 | `CycleGameContainer.jsx` (`onSelectGhost`), `CycleGameHome.jsx` (ghost picker) |
| F14 | `lib/cycleGame/participantIdentity.js` (:16), `CycleGameContainer.jsx` (`onSelectGhost`) |
| F15 | `CycleGameHome.jsx` (records table), `lib/cycleGame/recordRow.js`, `_cgTokens.scss` |

---

*Next: turn these into a sequenced remediation plan (one finding at a time), starting with the
quick, high-value fixes (F12 label removal, F14 deref, F1 oval motion, F10 camera margin) before
the F7 layout redesign.*
