# Game Show Shell + Jeopardy — Design Spec

**Date:** 2026-07-14
**Status:** Approved design (brainstormed with user; approach and schemas confirmed)

## 1. Problem & Goals

Build a **generic Game Show shell** as a screen-framework module, with **Jeopardy as its
first game**. The shell owns everything game-agnostic — team setup, buzzer interface,
scoreboard, timers, audio cues, shared UI components — so future games (Family Feud–style,
trivia rounds, wheel/wager games, Cranium-style party games) plug in without rebuilding
that infrastructure. Only Jeopardy is implemented now; the shell/game boundary is designed
for those futures but not speculatively built.

Requirements confirmed with the user:

- **Screen-framework module** like `modules/WeeklyReview/` — registered as a widget in
  `frontend/src/screen-framework/widgets/builtins.js`, launchable on **any screen** (D),
  with input degrading gracefully per screen.
- **Config-driven** from `data/household/config/gameshow.yml` (household config).
- **Multiple game sets** as YAML files in `data/content/games/jeopardy/`.
- **Sound effects** from `media/apps/gameshow/` (shell pack) and `media/apps/jeopardy/`
  (game-specific + clue media).
- **Teams** of household users resolved via backend `UserService`
  (`backend/src/0_system/config/UserService.mjs`) — presets in config **and** editable at
  game start (C).
- **Remote-driven UX**: gamepad via `screen-framework/input/adapters/GamepadAdapter.js`
  (ActionBus + synthetic keydown), and **Zigbee buzzers over MQTT** following the fitness
  `selectors` pattern (`MQTTSelectorAdapter`), as used by the CycleGame RiderPicker flow.
- **Per-round play mode** declared in the game set YAML: `hosted | self | turns` (all
  three supported).
- **Buzzer binding**: config provides default device→slot mappings; setup screen supports
  press-to-bind re-binding (C). Hardware not yet purchased (C) — buzz events must also be
  injectable from gamepad/keyboard/API so everything is playable and testable without
  Zigbee hardware.
- **Hybrid state model** (C): frontend state machine is authoritative during play;
  every meaningful transition checkpoints to a backend session endpoint; reload offers
  resume. Buzzers flow MQTT → backend → WS → frontend as pure events.
- **Full media clues from day one** (C): clue text plus optional image / audio / video.

Reference for flow/UX patterns (not code): <https://github.com/priyanka-tps/Party-Jeopardy>
— board → pick tile → reveal → judge → tile greys out; Final Jeopardy wagers; per-clue
countdown; reveal/correct stings; global mute; an AI prompt for generating game content.

## 2. Chosen Approach

**Thin shell, Jeopardy-proven** (Approach 1 of 3 considered). The shell is a set of
concrete services (contexts + hooks) and shared components, not a generic game engine.
Games register in a small registry and consume shell services. A declarative game-engine
approach (Approach 2) was rejected as premature abstraction from one example; independent
game modules with a shared lib (Approach 3) was rejected because it fragments the
game-night flow (team setup → game → scoreboard continuity).

**The one hard rule:** shell code never mentions boards, clues, or categories. If Jeopardy
needs it and another game plausibly would too (buzz arbitration, timers, wagers, turn
rotation, scoring), it goes in the shell; otherwise it stays in `games/Jeopardy/`.

## 3. Architecture

### 3.1 Frontend

```
frontend/src/modules/GameShow/
├── GameShow.jsx                  # shell root: outer flow state machine
├── index.js                      # (imported by builtins.js: registry.register('gameshow', GameShow))
├── shell/
│   ├── flow/                     # outer flow: game picker → team setup → buzzer bind → play → results
│   ├── teams/                    # TeamSetup screen (presets + RiderPicker-style member editing)
│   ├── buzzers/                  # useBuzzers(): WS-fed buzz events, bind mode, arbitration, fallback inputs
│   ├── scoreboard/               # score state + Scoreboard UI (award/deduct/wager)
│   ├── audio/                    # AudioCueEngine: sound packs, channels, ducking, global mute
│   ├── timers/                   # useCountdown hook + TimerRing component
│   ├── input/                    # host-input semantics over ActionBus/keydown (navigate/select/escape + judge keys)
│   ├── session/                  # checkpoint/resume client for hybrid persistence
│   └── components/               # TitleCard, TeamBadge, RevealPanel, MediaCluePlayer, ConfirmOverlay…
├── games/
│   ├── registry.js               # { jeopardy: { id, title, component, contentType } }
│   └── Jeopardy/                 # board grid, clue screen, round state machine, Daily Double, Final Jeopardy
└── GameShow.scss
```

Registration: one line in `screen-framework/widgets/builtins.js`
(`registry.register('gameshow', GameShow)`), same as `weekly-review`. Launchable from any
screen config / menu that points at the widget.

### 3.2 Backend

```
backend/src/
├── 2_domains/gameshow/            # session entity + pure rules (buzz arbitration, score math)
├── 3_applications/gameshow/       # GameShowService: config merge + hydration, content listing/validation, session CRUD
├── 4_api/v1/routers/gameshow.mjs  # Express router — MUST be added to routeMap in routers/api.mjs (known gotcha)
└── 1_adapters/hardware/mqtt-selector/  # REUSED: buzzer topics are selector configs with a gameshow target
```

- **Config** read via `configService.getHouseholdAppConfig(householdId, 'gameshow')`
  (NOT `getAppConfig` — known gotcha).
- **Users/teams** hydrated via `UserService` (`hydrateUsers`-style: username → id, display
  name, avatar path, group_label).
- **Buzzer relay**: `app.mjs` already constructs `MQTTSelectorAdapter` from fitness
  `selectors` and broadcasts `rider_select` (`app.mjs:1589`). Extend the same wiring to
  also load `gameshow.yml` `buzzers` entries; on action, `broadcastEvent({ topic:
  'gameshow', kind: 'buzz', buzzerId, action, slot, ts })`. Frontend consumes via the
  existing `useWebSocket` subscription mechanism.
- **Sessions** persisted as YAML under `data/household/state/gameshow/sessions/<id>.yml`
  through the persistence layer (same idiom as other YAML datastores).

### 3.3 Data flow (play loop, hosted-buzzer round)

1. Shell flow: pick game (Jeopardy) → pick game set (from `/api/v1/gameshow/games/jeopardy/sets`)
   → team setup (preset load + edits; users hydrated from UserService) → buzzer bind
   (optional press-to-bind; skippable when no hardware) → start session (POST → session id).
2. Jeopardy component renders board from the fetched set; host navigates with
   gamepad/arrow keys (GamepadAdapter already emits synthetic keydown + ActionBus actions).
3. Host selects a tile → clue reveals (with media if present) → shell arms buzzers +
   starts countdown + plays cue.
4. First buzz event (WS `gameshow`/`buzz`, or fallback key/gamepad mapping, or debug API
   inject) locks the answering team; shell arbitration ignores later buzzes; locked team's
   badge lights + sting plays.
5. Host judges right/wrong (mapped host keys) → scoreboard applies ±value → either
   re-arm remaining teams (wrong) or return to board (right/timeout).
6. Every transition → `POST /api/v1/gameshow/sessions/:id/checkpoint` (debounced,
   fire-and-forget with retry; gameplay never blocks on it).
7. Round modes vary step 3–5: `self` = clue + timer + reveal answer + per-team
   correct/incorrect confirm; `turns` = no buzzers, active team rotates, host confirms.
8. Final phase: host enters each team's wager in turn (screen shows only "wager locked",
   not the amount), final clue, reveal, adjust scores, results screen with winner
   celebration cue.

### 3.4 Session & resume (hybrid model)

- Frontend state machine (reducer) is authoritative during play.
- Checkpoint payload: game id, set id, teams (members, colors, buzzer bindings), scores,
  used clues per round, current round/phase, wagers. Enough to fully reconstruct.
- On shell mount, `GET /api/v1/gameshow/sessions?active=true`; if a live session exists,
  offer **Resume / Discard** (mirrors WeeklyReview draft-resume UX).
- Finished sessions are marked complete and archived (kept as history, not deleted).

## 4. Config Schema — `data/household/config/gameshow.yml`

```yaml
buzzers:
  - id: living_room_buzzers
    mqtt_topic: "zigbee2mqtt/GameShow Buzzer Panel"   # fitness selectors pattern
    buttons:                 # zigbee action code -> logical team slot
      "1_single": slot_1
      "2_single": slot_2
      "3_single": slot_3
      "4_single": slot_4
team_presets:
  - id: kids_vs_parents
    name: Kids vs Parents
    teams:
      - { name: Kids,    color: "#e6b325", members: [felix, milo, alan, soren] }
      - { name: Parents, color: "#3273dc", members: [kckern, cammy] }
defaults:
  timer_seconds: 12          # per-clue countdown default (game set / round can override)
  mute: false
sounds:
  pack: classic              # media/apps/gameshow/<pack>/
```

- `members` are UserService usernames; backend hydrates to display name + avatar.
- Press-to-bind at setup overrides `buttons` slot mapping for that session only.
- Missing/empty `buzzers` is valid — buzzer modes stay playable via fallback inputs.

## 5. Content Schema — `data/content/games/jeopardy/<set-id>.yml`

```yaml
id: bible-night-1
title: "Scripture Showdown"
description: "Family scripture trivia"
rounds:
  - name: Jeopardy
    mode: hosted             # hosted | self | turns  (per-round, user requirement)
    multiplier: 1            # Double Jeopardy round: 2
    timer_seconds: 12        # optional override of gameshow.yml default
    categories:
      - name: "Old Testament"
        clues:
          - value: 100
            clue: "He built an ark"
            answer: "Who is Noah?"
          - value: 200
            clue: "Name this location"
            media: { type: image, src: "games/jeopardy/bible-night-1/sinai.jpg" }
            answer: "What is Mount Sinai?"
          - value: 300
            clue: "Name that tune"
            media: { type: audio, src: "games/jeopardy/bible-night-1/hymn.mp3" }
            answer: "What is 'Amazing Grace'?"
            daily_double: true
final:
  category: "Prophets"
  clue: "This prophet was swallowed by a great fish"
  media: null
  answer: "Who is Jonah?"
```

Rules:

- Any number of rounds/categories/clues (5×5 is convention, not enforced by the schema).
- `media` optional on any clue and on `final`: `{ type: image|audio|video, src }`, `src`
  relative to `media/apps/` and served through the existing static media endpoints.
- `daily_double: true` on a clue triggers the wager flow (shell wager component).
- `final` optional; a set without it skips the Final phase.
- Backend validates on load; a malformed set appears in the set picker as errored (with
  reason) instead of crashing the game.
- Ship a documented **AI-generation prompt** (docs/) that produces valid set YAML, à la
  Party-Jeopardy's chatbot prompt.

## 6. Shell Services (contracts)

- **TeamSetup** — input: presets + hydrated users; output: `teams: [{ id, name, color,
  members: [userId], slot }]`. Add/remove/rename/reassign; guests allowed as free-text
  names (no profile required).
- **BuzzerService / useBuzzers** — subscribes WS `gameshow` topic; states per team:
  `unbound | idle | armed | buzzed | locked-out`; API: `arm(teamIds)`, `disarm()`,
  `onBuzz(cb)`; bind mode captures next physical press per team. Fallback inputs: mapped
  keys/gamepad buttons and a debug `POST /api/v1/gameshow/buzz` inject endpoint. First-buzz
  arbitration resolved in the frontend service (single screen is authoritative — consistent
  with the hybrid state decision).
- **Scoreboard** — `award(teamId, points)`, `deduct(teamId, points)`, `setWager(teamId,
  amount)`, manual adjust (host correction); renders persistent team rail with avatars,
  colors, scores.
- **AudioCueEngine** — loads a sound pack manifest from `media/apps/gameshow/<pack>/`;
  `play(cueName)`, channels: `music` vs `sfx`; media clues claim an **exclusive** channel
  that ducks/pauses cue music (name-that-tune must not fight the think music); global mute.
- **Timers** — `useCountdown(seconds, { onExpire })` + `TimerRing` visual; pause/reset.
- **Input** — consumes ActionBus `navigate/select/escape` (gamepad-ready today) plus
  host-judgment semantics (right/wrong/skip) mapped to keys and gamepad buttons; per-mode
  maps documented in a control legend component (like WeeklyReview's ControlLegend).
- **Session client** — debounced checkpoint POST after each reducer transition; resume
  fetch on mount; never blocks gameplay on network.

## 7. Jeopardy Game (first plugin)

- **Board**: category header row + value grid; used tiles grey out; remote-first focus
  navigation (d-pad), oversized TV typography.
- **Clue screen**: full-screen reveal with `MediaCluePlayer` for image/audio/video;
  countdown ring; buzz lock-in banner showing team badge.
- **Round modes** (per round from YAML):
  - `hosted`: host reveals, teams buzz, host judges right/wrong; wrong re-arms others.
  - `self`: clue + timer → answer auto-reveals → per-team correct/incorrect confirm.
  - `turns`: rotation order (round-robin from team list), active team picks and answers,
    host/anyone confirms; no buzzers.
- **Daily Double**: only the picking/answering team wagers (min 5, max = max(score,
  round max value)); wager UI is the shell wager component.
- **Final Jeopardy**: all teams with score > 0 wager, clue reveals, think music plays,
  per-team reveal + judge, results screen.
- **Scoring**: value × round multiplier; wrong answers deduct in hosted mode (classic
  rules); `self`/`turns` deduct behavior configurable per round (`penalize_wrong:
  true|false`, default true).

## 8. API Surface (`/api/v1/gameshow`)

| Endpoint | Purpose |
|---|---|
| `GET /config` | Merged gameshow.yml + hydrated team presets (UserService) |
| `GET /games` | Registered game types (jeopardy) |
| `GET /games/jeopardy/sets` | List sets: id/title/description/rounds + validation status |
| `GET /games/jeopardy/sets/:id` | Full validated set |
| `POST /sessions` | Create session (game, set, teams, bindings) → id |
| `GET /sessions?active=true` | Resume discovery |
| `POST /sessions/:id/checkpoint` | Persist frontend state snapshot |
| `POST /sessions/:id/finish` | Mark complete/archive |
| `POST /buzz` | Debug/testing buzz inject → same WS broadcast path |

Router added to `routeMap` in `backend/src/4_api/v1/routers/api.mjs` (gotcha: routers are
not auto-discovered).

## 9. Error Handling

- **Malformed game set** → listed as errored in picker with validation message; unplayable
  but never crashes the shell.
- **Checkpoint failure** → retry with backoff, non-blocking; a persistent-failure toast
  warns that resume may be stale; gameplay continues.
- **WS disconnect mid-game** → shell shows a subtle disconnected badge; buzzer modes warn;
  fallback inputs keep the game playable; events resume when the socket heals (existing
  app-level heartbeat handles staleness).
- **Buzz storms / duplicates** → arbitration accepts first event per armed window; same
  device re-press ignored while locked.
- **Media clue missing/failed** → clue falls back to text with a "media unavailable"
  note; audio/video errors don't hang the countdown.
- **Missing sound pack / cue** → silent no-op with a single logged warning (never blocks).
- **No buzzer hardware** (current reality) → buzzer bind step is skippable; buzz modes
  playable via keyboard/gamepad mappings and the inject endpoint.

## 10. Testing

- **Backend**: unit tests for set validation (good/bad YAML fixtures), session CRUD +
  checkpoint round-trip, config hydration (UserService mock), buzzer config → broadcast
  payload mapping. Colocated `*.test.mjs` like existing routers.
- **Frontend**: reducer/state-machine tests for the shell flow and the Jeopardy round
  machine (all three modes, Daily Double, Final); `useBuzzers` arbitration tests (first
  buzz wins, re-arm after wrong, bind mode); scoreboard math incl. wagers/multipliers.
  Component smoke tests colocated like `screen-framework/*.test.jsx`.
- **Manual/e2e**: debug buzz inject endpoint + keyboard fallbacks make a full game
  playable in a dev browser with no hardware; verify on a real screen after deploy.

## 11. Out of Scope (this project)

- Family Feud / trivia / wheel / Cranium games (shell contracts anticipate them; nothing built).
- Backend-authoritative multi-device play or a phone/tablet host console (checkpoint
  schema is the migration path).
- Zigbee buzzer hardware purchase/pairing (config + bind flow ready when it arrives).
- AI game-set *generation endpoint* (ship the documented prompt only).
- Editing game sets in an admin UI (YAML files are the interface for now).
