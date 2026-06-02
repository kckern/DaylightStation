# Cycle Game — Design Spec

**Date:** 2026-06-02
**Status:** Approved in brainstorming; pending spec review → implementation plan
**Supersedes:** `CycleChallengeDemo` (the self-running demo is replaced by a real game)

---

## 1. Goal

A cycling-race game on the fitness TV. Riders pedal real bikes; the game proxies **virtual distance** from cadence, weighted by heart-rate effort. Riders can race **live opponents**, a **ghost** of a past run (their own or another's), or **solo** — either **simultaneously** or **sequentially** (one at a time). The look reuses the stylized speedometer from the cycle challenge overlay.

---

## 2. Scoring model (core)

Distance is the single currency of the game.

**Per tick (≈5s):**
```
distanceDelta = rotationsDelta × wheelCircumference × zoneMultiplier
```

- **`rotationsDelta`** — from the per-user rotations foundation (landed 2026-06-02): hardware crank-counter delta preferred (16-bit wrap handled), RPM-integration fallback. Attributed to the bike's claimed rider.
- **`wheelCircumference`** — per-equipment (meters). Handles the tricycle (small wheel → high RPM but short distance per rotation).
- **`zoneMultiplier`** — by HR zone: **cool 0.5× · active 1× · warm 1.5× · hot 2× · fire 3×**. A rider with **no HR strap = flat 1×** (can race, just no effort bonus).
  - Known quirk (accepted): a strapped-but-cool rider earns 0.5× while a strapless rider earns 1×. Only matters in the brief warm-up window.

**Cumulative distance** per rider is the running sum of `distanceDelta`, and is the value shown on the odometer and plotted on the chart.

**Distance formatting** — shared helper `formatDistance(meters)`:
- `0–999 m` → whole meters (`850 m`)
- `≥1 km` → 2 decimals (`1.23 km`)
- `≥10 km` → 1 decimal (`12.4 km`)
Used everywhere distance appears (odometer, chart axis, standings, high scores, goal entry). Unit-tested at boundaries (999→`999 m`, 1000→`1.00 km`, 10000→`10.0 km`).

---

## 3. Race screen layout (top → bottom)

1. **Race clock** (top, centered) — counts **up** for a distance race (elapsed time = your score), counts **down** for a time-cap race.
2. **Distance chart** — reuses the existing race-chart engine (`FitnessChart` / `useRaceChartData` / `resolveHistoricalParticipant`), plotting distance-over-time lines climbing toward a goal line. **Ghosts = faded dashed lines.**
3. **Modular speedometer row** — re-centers/distributes for **1, 2, or 3 riders** (no fixed slots; driven by rider count).
4. **Sidebar** (right) — live standings + ghost/VS info.
5. **Ambient Plex video** — full-bleed behind everything, dimmed. Optional; set via lobby (see §7 config).

---

## 4. The speedometer (shared widget)

A **dual-gauge** composed from existing parts so the challenge overlay, roster card, and game all share building blocks:

- **Outer RPM gauge** — abstracted out of `CycleChallengeOverlay`: outer ring, **labeled RPM ticks**, **colored cadence bands** (see below), needle, RPM number. Cadence bands are layered *with* the ticks, not instead of them.
- **Inner = `CircularUserAvatar`** (existing `frontend/src/modules/Fitness/components/CircularUserAvatar.jsx`) — zone-colored ring, top-semicircle zone-progress, HR bpm overlay, fire effects.
- **×-multiplier badge** — zone-colored pill on the avatar's lower-right; shown only when multiplier > 1.
- **Odometer** below — that rider's cumulative distance (same value feeding their chart line), via `formatDistance`.

**Stripped** from the challenge version (game has no governance): health meter, hi/lo RPM targets, phase progress blocks, boost badge, base-req dot, lock states.

**Cadence (RPM) bands** — purely cosmetic "gearing up" feel, **no scoring effect**. Configured like HR zones: a **system default** plus **per-user override** (see §7). Each band = `{ min, color, name }` (e.g. warm-up / cruising / pushing / sprint).

**Refactor:** extract the gauge from `CycleChallengeOverlay` into a reusable `<CycleSpeedometer>` (parameterized: rpm, cadenceBands, ticks, avatar props, odometer, multiplier) that both the challenge overlay and the game render. This also feeds the roster-card enrichment (separate effort).

---

## 5. Lobby / setup (single-screen)

One screen (touchscreen-first; D-pad fallback). Auto-detects connected riders (live RPM / recently-live HR).

- **Global settings** (chips/selectors): mode (simultaneous / sequential) · win-condition + goal (distance e.g. `3.0 km` / time e.g. `5:00`) · chart type · background video.
- **Rider lineup** — one card per detected bike: bike name, assigned user (avatar), and opponent selector **solo / ghost / live**. Ghost cards pick a past run (own past best, or a prior session/another rider).
- **START** — race begins when pedals start turning. Simultaneous = shared **3-2-1 GO**; sequential = each rider's own clock starts on first pedal.
- Idle bikes show a "pedal to join" slot.
- The lobby's user→bike assignment provides the on-screen rider assignment (overlaps the earlier rider-assignment modal idea; the game lobby is its richer form).

---

## 6. Modes & opponents

- **Simultaneous** — all ride at once; live head-to-head, optional ghosts on the same chart.
- **Sequential** — one at a time; each rider races the **ghosts of everyone who already went this session + their own past best**, all on the shared chart.
- **Win condition** (configurable per race):
  - **Distance goal** → first to the goal line; **fastest time wins**; clock counts up.
  - **Time cap** → fixed clock; **most distance wins**; clock counts down.
- **Opponent types** per rider: **solo** (no opponent), **ghost** (replay a saved run), **live** (another active bike).

---

## 7. Configuration

Two surfaces, matching the established pattern (system default + per-user override, snake_case keys, unit suffixes like the existing `coin_time_unit_ms`). **No new per-user keys go in the household file** — user overrides live in user files (see 7.2).

### 7.1 System defaults — household fitness config

`household[-{id}]/config/fitness.yml` (legacy fallback `household/apps/fitness/config.yml`), resolved by `ConfigService`/`FitnessConfigService`, served via `/api/v1/fitness`. Same file that already defines `equipment`, `zones`, `users`, `screens`.

```yaml
# add ONE field to each equipment entry
equipment:
  - id: cycle_ace
    name: Cycle Ace
    type: bike
    cadence: "7138"               # existing cadence device id
    wheel_circumference_m: 2.1    # NEW — meters per rotation
  - id: tricycle
    name: Tricycle
    type: bike
    cadence: "7139"
    wheel_circumference_m: 1.2    # NEW — small wheel

# add ONE field to each zone entry (zones are a list of {id,name,min,color,...})
zones:
  - { id: cool,   name: Cool,   min: 0,   color: '#3498db', distance_multiplier: 0.5 }  # NEW field
  - { id: active, name: Active, min: 100, color: '#2ecc71', distance_multiplier: 1.0 }
  - { id: warm,   name: Warm,   min: 130, color: '#f1c40f', distance_multiplier: 1.5 }
  - { id: hot,    name: Hot,    min: 150, color: '#e67e22', distance_multiplier: 2.0 }
  - { id: fire,   name: Fire,   min: 170, color: '#e74c3c', distance_multiplier: 3.0 }

# NEW dedicated section — all game-wide settings grouped here
cycle_game:
  default_win_condition: distance        # distance | time
  distance_goal_default_m: 3000          # default goal for a distance race (meters)
  time_cap_default_s: 300                # default cap for a time race (seconds)
  hrless_multiplier: 1.0                 # multiplier for a rider with no HR strap
  start_countdown_s: 3                   # simultaneous shared 3-2-1 GO (0 = none)
  cadence_zones:                         # SYSTEM-DEFAULT cosmetic RPM bands
    - { id: warmup,   name: Warm-up,  min: 0,  color: '#5b6470' }
    - { id: cruising, name: Cruising, min: 40, color: '#2ecc71' }
    - { id: pushing,  name: Pushing,  min: 70, color: '#f1c40f' }
    - { id: sprint,   name: Sprint,   min: 90, color: '#e74c3c' }
  backgrounds:                           # ambient Plex video presets for the lobby
    - { name: Alps Ride, plex_id: "plex:123456" }
    - { name: Coastal,   plex_id: "plex:234567" }
  default_background: null               # plex id / preset name, or null = off
```

### 7.2 Per-user overrides — user files

User overrides live in `data/users/{id}/profile.yml` under `apps.fitness.*` — the same place `heart_rate_zones` already lives. The override is a **`bandId → min` dict** (exactly like `heart_rate_zones` is a `zoneId → min` dict); names/colors are always inherited from the system default, and unspecified bands keep their default min (e.g. `warmup`'s 0 floor is implicit, just as `cool` is for HR).

Confirmed against the real `data/users/felix/profile.yml`:

```yaml
# data/users/felix/profile.yml  (existing shape)
version: "1.0"
username: felix
household_id: default
display_name: "Felix"
group: primary
apps:
  fitness:
    heart_rate_zones:        # EXISTING per-user HR-zone override (zoneId → min)
      active: 120
      warm: 140
      hot: 160
      fire: 180
    cadence_zones:           # NEW per-user cosmetic RPM-band override (bandId → min)
      cruising: 50
      pushing: 80
      sprint: 105
```

**Merge:** a `buildCadenceConfig(systemCadenceZones, userOverride)` parallel to the existing `buildZoneConfig(globalZones, overrides)` — same contract: system default is the list of `{id,name,min,color}`; the per-user `{id→min}` dict overrides only the thresholds; colors/names come from the system default; missing bands keep their default min. `UserService.hydrateFitnessConfig` gains one line attaching `apps.fitness.cadence_zones` to the hydrated user (right next to the existing `heart_rate_zones → hydrated.zones` handling), so the override flows through `/api/v1/fitness` exactly like HR zones do.

**In code (no config):** HR-less rider multiplier reads `cycle_game.hrless_multiplier` (default 1.0).

---

## 8. Persistence & high scores

### 8.1 Race records — new format under the fitness history tree

Stored alongside workout sessions but in a dedicated subfolder so the formats don't collide:

```
household[-{id}]/history/fitness/cycle-races/{YYYY-MM-DD}/{raceId}.yml
```

- `raceId` = race start timestamp `YYYYMMDDHHmmss` (matches the session-id convention).
- Written by the backend via a new persistence path that reuses the YAML datastore patterns (parallel to `YamlSessionDatastore`), behind a `/api/v1/fitness/cycle-races` endpoint family (save / list / get).

**Record shape (v1):**
```yaml
version: 1
race:
  id: "20260602143012"
  date: "2026-06-02"
  mode: simultaneous            # simultaneous | sequential
  win_condition: distance       # distance | time
  goal_m: 3000                  # present for distance races
  time_cap_s: null              # present for time races
  background_plex_id: "plex:123456"   # or null
  interval_seconds: 5
participants:                   # keyed by userId
  milo:
    display_name: Milo
    equipment: cycle_ace
    avg_hr: 152
    final_distance_m: 3000
    final_time_s: 252           # time to reach goal (distance race)
    placement: 1
    distance_series: "[0, 14, 31, ...]"   # RLE-encoded distance-over-time (the chart line / ghost)
  felix:
    display_name: Felix
    equipment: tricycle
    final_distance_m: 2710
    final_time_s: 252
    placement: 2
    distance_series: "[...]"
```

The `distance_series` is the single source for both the chart line and ghost replay (replayed against the live race clock).

### 8.2 High scores — derived index

- A leaderboard is **derived** from the race records — best time per (win_condition, goal) and longest distance per (win_condition, time_cap), per user.
- Maintained as a compact index `household[-{id}]/history/fitness/cycle-races/records.yml`, updated on each race save and fully rebuildable by scanning records (no silent drift — a rebuild command re-derives it).
- **High-scores screen** = a **separate, follow-on** view that reads `records.yml` (browse/filter by user, distance, time-cap). Not part of this spec's implementation; this spec only guarantees the data + index exist.

### 8.3 Ghost selection

A ghost = a chosen race record's per-rider `distance_series`. The lobby's ghost picker queries the race list (filtered by the same win-condition+goal so the comparison is apples-to-apples) and offers "your past best", recent runs, and other riders' runs.

---

## 9. Reuse & dependencies

- **Per-user rotations foundation** (landed 2026-06-02): provides per-rider `rotations`/`rpm` and the equipment→rider attribution the distance model rides on.
- **`<CycleSpeedometer>`** — extracted from `CycleChallengeOverlay`; shared by challenge overlay + game (+ roster card enrichment).
- **`CircularUserAvatar`** — reused as the speedometer's inner HR-zone avatar.
- **Race-chart engine** (`FitnessChart`, `useRaceChartData`, `resolveHistoricalParticipant`) — reused for the distance chart + ghosts.
- **Plex playback** — ambient background via `/api/v1/play/plex/{id}` (or a collection for variety).
- Launch replaces the `CycleChallengeDemo` entry / `/fitness/cycle-demo` path; renamed to **Cycle Game**.

---

## 10. Defaulted details (change here if wrong)

- Win-condition default = **distance**; `≥10 km` distance shows **1 decimal**.
- Background video **optional** (off unless a Plex ID / preset is set).
- Simultaneous start = **shared 3-2-1 GO**; sequential = per-rider first-pedal start.

---

## 11. Scope

One comprehensive spec covering: config additions, `<CycleSpeedometer>` extraction, distance model + `formatDistance`, race screen (clock + chart + modular speedometer row + sidebar + ambient video), lobby, modes/opponents, ghost replay, and result persistence.

**Out of scope (follow-on):** racing ghosts of *other* users/friends beyond what result persistence already enables; best-of-N / series grouping.

---

## 12. Race lifecycle & taxonomy (added 2026-06-02; refines §5, §7, §8)

### 12.1 Lifecycle state machine — independent of the HR session

Races are **independent of the session lifecycle**. A race can run inside an active HR session *or* standalone (cycling with no HR straps — HR is the prerequisite for a *session*, not for a *race*). A race never alters session governance or the session timeline; it persists only its own `cycle-races` record.

States: `idle` → `staged` → `countdown` → `racing` → `finished` → `results` → `idle`; plus `cancelled` (from `staged`/`racing`).

- **`idle` (game home):** no race active. **One home screen** with a course/custom race picker + rider lineup **and** a Records panel (high scores / past results). This *is* the lobby (refines §5: lobby = home).
- **`staged`:** race configured and armed; explicit **START** affordance.
- **`countdown`:** full-screen stoplight 🔴→🟡→🟢 overlay + sound, driven by `cycle_game.start_countdown_s` (0 = skip). Simultaneous = shared GO; sequential = a per-rider countdown as each takes their turn.
- **`racing`:** the race screen (clock + animated distance chart + speedometer row + ambient Plex video + optional music).
- **`finished`:** goal reached / time cap hit / **all riders finished-or-DNF**.
- **`results`:** standings with animated count-up of time/distance + sound; **saves the record**; flags a new high score; offers "race again" / "home".
- **`cancelled`:** Cancel button (in `staged`/`racing`) → confirm modal ("Cancel & discard?") → back to `idle`, nothing saved.

**Drop-out / DNF:** a rider whose RPM stays 0 beyond `cycle_game.race_idle_dnf_s` (default 20s) is marked **DNF** (their chart line flatlines earlier as a visual cue). A distance race's finish condition is therefore **"every rider finished OR DNF"** — so a quitter can't hang the race forever. DNF riders rank after finishers in standings/results.

### 12.2 Taxonomy: Courses (no series)

A **Course** is a named, themed race preset = the **leaderboard/ghost key**. It bundles: win-condition + goal/cap + background video + music + cadence theme. Three jobs: apples-to-apples leaderboards ("Alps · 3 km" comparable across days), the natural filter for ghosts, and the "themed group" idea — without any series machinery. **Ad-hoc custom races** are allowed (no shared leaderboard). **No heats / best-of-N / series.**

### 12.3 Config delta (refines §7.1)

Add to the `cycle_game` section:
```yaml
cycle_game:
  # ...existing...
  race_idle_dnf_s: 20            # NEW — RPM-0 idle seconds before a rider is DNF'd
  courses:                       # NEW — named themed race presets (leaderboard keys)
    - id: alps_3k
      name: Alps · 3 km
      win_condition: distance
      goal_m: 3000
      background_plex_id: "plex:123456"
      music: null                # optional plex id / playlist
      cadence_theme: null        # optional cadence_zones override id
    - id: coastal_5min
      name: Coastal · 5 min
      win_condition: time
      time_cap_s: 300
      background_plex_id: "plex:234567"
```

### 12.4 Persistence / leaderboard delta (refines §8)

- The race record's `race` block gains **`course_id`** (null for custom races).
- **High scores are keyed by `course_id`** (fallback for custom races: `win_condition` + goal/cap). `records.yml` groups by `course_id`.
- **Ghost candidates** are filtered by `course_id` (custom: by `win_condition` + goal/cap) so comparisons stay apples-to-apples.

### 12.5 Plan impact

- **Plan 4** (active race) now also covers: the lifecycle controller (pure state machine, testable), the countdown stoplight overlay, the results screen with count-up, DNF handling, and the `/api/v1/fitness/cycle-races` HTTP wiring (deferred from Plan 3).
- **Plan 5** (game home) = the single-home lobby: course picker + custom builder + rider lineup + Records panel; plus `cycle_game.courses` consumption.
