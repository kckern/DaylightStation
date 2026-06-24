# Fitness Home — Momentum Panel (design)

Replace the fitness home screen's "bottom-panels" region — a deeply-nested,
uninsightful `fitness:longitudinal` chart + `fitness:coach` panel that the user
calls a "UX black hole" — with a single, flat, motivational **Momentum** widget:
a household momentum headline plus a per-person streak/progress row.

## Goal

On the shared fitness TV (seen mostly right before/after a workout, with no single
user identified), the bottom ~45% of the home screen's right column should pull
people back in: big, legible, emotionally-resonant momentum — streaks and weekly
progress — for the household and each family member. It should read at a glance
from across the room and feel celebratory, not like a dense chart.

## Current state (what's being removed)

`screens.home.layout` (in the household fitness config) nests, ~5 levels deep:

```
right-area (column)
  └─ bottom-panels (row, 45%)
       ├─ fitness:longitudinal (75%)   ← removed from home
       └─ fitness:coach (25%)          ← removed from home
```

Both widgets stay **registered** (they may be used on other screens); they are
only removed from the home layout. The entire `bottom-panels` subtree collapses
to one widget node, eliminating the nesting.

## Design

### Approach

A new screen-framework widget, `fitness:momentum`, registered in the builtin
widget registry, replacing the `bottom-panels` node. It consumes the `sessions`
data source the home screen already loads (`/api/v1/fitness/sessions?since=95d`),
so there is no new fetch. This keeps the config-driven architecture (the framework
was never the problem — the content was) while flattening the layout.

### Data & computation — `momentum.js` (pure, unit-tested)

Input: the resolved session list (each session has a user id, a date/timestamp,
and a duration) + the roster (`users.primary`, hydrated to id / display name /
avatar) + a per-user weekly goal.

"This week" = a **rolling 7-day window** ending now (NOT a calendar week).

Compute:

- **Per person**
  - `activeMinutes` — sum of session durations whose timestamp is within the last
    7 days, attributed to that user.
  - `streakDays` — length of the run of consecutive calendar days, ending **today
    or yesterday** (so a not-yet-worked-out today doesn't break a live streak),
    on which that user has ≥1 session. Uses the household timezone for day
    bucketing.
  - `goalMinutes` — the user's weekly goal (default below).
  - `pct` — `min(1, activeMinutes / goalMinutes)`; `met` — `activeMinutes >= goalMinutes`.

- **Household ("team")**
  - `householdLabel` — from config (`household_label`, e.g. "Kern Family"), with a
    generic fallback ("Your household") when unset.
  - `activeMinutes` — sum across all members in the last 7 days.
  - `goalMinutes` — sum of members' goals.
  - `streakDays` — consecutive days (ending today/yesterday) on which **any**
    member has ≥1 session.

The module is a pure function of (sessions, roster, goals, now, timezone) →
`{ household, members[] }`. No DOM, no fetch.

### Goals & config (`fitness.yml`)

- `household_label: "Kern Family"` — a **top-level key in `fitness.yml`** (household
  config), surfaced to the widget through the same config the screen-framework
  already hydrates. Drives the headline; generic fallback ("Your household") if absent.
- Per-user weekly goal: **default 150 active minutes/week** for everyone (kids
  included). Overridable per user later via the user profile
  (`apps.fitness.weekly_goal_min`); not required for v1 — the default is fine.
- Layout: replace the `bottom-panels` node in `screens.home.layout`'s right-area
  with `{ widget: "fitness:momentum", basis: "45%" }`.

### Layout & visual — `FitnessMomentum.jsx`

One flat glass panel (the existing home `panel-*` theme), sized for a TV, two rows:

```
┌──────────────────────────────────────────────────────────────┐
│  🔥 Kern Family · 6-day roll        612 / 750 min ▓▓▓▓▓▓▓▓░░  │  ← headline
├──────────────────────────────────────────────────────────────┤
│  ◐ Felix   ◐ Dad    ◐ Milo   ◐ Alan   ◐ Soren                │  ← per-person
│  🔥5       🔥3       🔥8      🔥2      🔥1                     │
│  142/150   98/150    150/150✓ 60/150   25/150                 │
│  ▓▓▓▓░     ▓▓▓░      ▓▓▓▓▓    ▓▓░      ▓░                      │
└──────────────────────────────────────────────────────────────┘
```

- **Headline row:** flame + household label + "{N}-day roll", and the household's
  weekly minutes / goal with a slim progress bar.
- **Person row:** a horizontal row of compact cards (one per roster member): avatar
  (initials fallback), name, 🔥 day-streak, `minutes / goal`, and a progress
  indicator (ring or bar). A goal-met card gets a celebratory accent (✓ / subtle
  glow). Built from the Fitness shared primitives/styles where they fit; large,
  high-contrast type; no nested sub-panels.
- Avatar source: `/api/v1/static/img/users/{id}` with an initials fallback.

### Edge cases & states

- **Nobody active in 7 days** → a warm zero-state ("Let's get moving") instead of
  empty bars.
- **A member with no sessions** → streak 0, 0/goal, empty bar (still shown).
- **Over goal** → bar caps at 100%, but the real minutes are still displayed.
- **Missing avatar** → initials chip.
- **Empty/missing roster** → the widget renders the headline only (or a neutral
  empty state), never crashes.

### Logging

Structured logging (per CLAUDE.md): widget mount with member count + household
totals; a sampled recompute event. No raw `console.*`.

### Testing

- `momentum.js` — thorough unit tests: rolling-7-day boundary, streak counting
  (gaps, today-vs-yesterday liveness, timezone day bucketing), per-person vs team
  aggregation, goal-met flagging, empty/zero inputs.
- `FitnessMomentum.jsx` — render test: headline + one card per roster member,
  goal-met accent, zero-state.

## Out of scope (YAGNI for v1)

- Per-user configurable goals UI (default 150 is fine; profile override can come
  later).
- Tapping a card to drill into a person's history.
- Animations/celebration effects beyond a static goal-met accent.
- Touching `fitness:longitudinal` / `fitness:coach` internals (only removed from
  the home layout).
