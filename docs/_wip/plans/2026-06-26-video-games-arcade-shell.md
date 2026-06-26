# Video Games Arcade Shell — Design & Plan

**Date:** 2026-06-26
**Status:** Approved (brainstormed via visual companion), building.

Expands the single-shot "Game Boy" emulator module into a config-driven **Video Games**
arcade shell: console tabs → game-cover grid → fingerprint-gated launch → governed
console with per-user save/resume. Coins appear as placeholders (economy lands later).

## Decisions (SSoT)

1. **Rename / reframe.** Fitness Apps menu card "Game Boy" → **"Video Games"** (console-agnostic).
2. **Shell.** Welcome screen = centered game-cover **grid** + **console tabs** along the bottom.
   - Grid is always vertically *and* horizontally centered (1 game or 12).
   - Covers only, **no captions** (cover art is self-evident).
   - Game Boy tab is real; **blank** placeholder tabs for not-yet-built consoles.
3. **Everything config-driven (YAML).** Console tabs (ordered, real + blank placeholders) and
   games come from config — nothing hard-coded. Games already come from
   `media/emulation/{system}/{system}.yml`; covers from the art API (SSoT), with a graceful
   fallback tile when a cover is missing.
4. **Cover art** lives in `emulation/{system}/` as SSoT, served by the existing art API
   (`/api/v1/emulator/art/:system/:gameId/cover`). **Gap:** none exist yet — add per game;
   grid must fall back gracefully (placeholder tile) on 404.
5. **Per-game save mode** (manifest, per game): `none` | `state` | `battery`.
   - `none` (e.g. Mario Kart): tap → boots immediately, anonymous, no saving.
   - `state` (e.g. Super Mario Land): emulator save-state snapshot used as the resume point.
   - `battery` (e.g. Pokémon): `.srm` battery save used as the resume point.
6. **Launch flow** for save-enabled games — fingerprint **up front**:
   - Tap cover → identify prompt (with **"play without saving"** escape).
   - Matched → **auto-resume** that user's save if present (resume by default), else fresh;
     saving enabled under that user.
   - Cancelled / unrecognized → **cold start**, plays but does not save.
7. **Save slots:** model **many-per-user structurally** (backend `slot` param already exists);
   UX surfaces a **single** resume point (slot `auto`).
8. **Save/resume mechanics:** on exit of an identified, save-enabled session, snapshot
   (`.srm` for battery, save-state for `state`) → PUT to that user's slot. On next identified
   launch, GET + load it. Anonymous/cold-start sessions never persist.
9. **Reset / "start over":** new **`reset` hotspot** on the real **OFF/ON power-switch etching**
   (top-left of the DMG bezel, ≈ `{x:4, y:1, width:12, height:4.5}`). Tap → confirm modal
   *"Start [game] over? This erases [user]'s save."* → clears the user's slot + restarts fresh.
10. **In-game overlays** (display-only, on existing `gameboy.yml` overlay slots):
    - **Now-playing person** → `player` slot (top-right). Avatar + name; blank when anonymous.
    - **Play timer** (count-up from boot) → top-left pocket (old `rpm` slot).
    - **Coins** → `coins` slot (right). Placeholder `🪙 —` until the economy exists.
    - HR & cadence dropped from the default bezel yml (re-addable as pure config).
11. All hotspot/overlay positions are YAML, pixel-tuned later.

## Architecture

**Host-agnostic (modules/Emulator/)** — no fitness imports:
- `ui/ArcadeShell.jsx` — console tabs + centered game grid; props `{ consoles, games, activeSystem, onSelectGame, onSelectConsole }`.
- `ui/ConsoleTabs.jsx`, `ui/GameGrid.jsx`, `ui/GameCover.jsx` (cover + 404 fallback).
- `EmulatorConsole.jsx` — already host-agnostic; add `reset` hotspot action + person/timer/coins
  overlay formats + identity-driven `overlayData`.
- `core/EmulatorEngine.js` — add `saveState()/loadState(blob)`, `getSaveFile()/loadSaveFile(blob)`
  via EmulatorJS `gameManager` API.
- `core/saveClient.js` — GET/PUT save & state blobs against the emulator router (pure, injectable fetch).
- `core/launchModel.js` — pure state machine: game + saveMode + identity → {boot fresh | resume | cold}.

**Fitness binding (modules/Fitness/widgets/EmulatorGame/)** — wires identity/host:
- `EmulatorGameWidget.jsx` — shell host with views `arcade → launching → playing`.
- `IdentifyPrompt` — reuse `IdentityProvider` biometric scan as an *identify* (not authz lock),
  with a skip → cold-start path.

**Backend (already mostly there):**
- `/library` already returns games + `coverUrl/bezelUrl`. Add per-game `saveMode` and a
  top-level `consoles` (ordered tab list w/ placeholder slots) to the response.
- Save/state read/write endpoints exist; wire frontend to them.
- `loadEmulatorConfig` / `EmulatorCatalog` pass through `saveMode` and `consoles`.

## Plan (phased, TDD where logic-bearing)

**P1 — Backend config surface**
- Add `save: { mode }` per game + top-level `consoles` to manifest schema; thread through
  `loadEmulatorConfig` → `EmulatorCatalog.buildCatalog` → `/library` response. Tests.

**P2 — Save/resume core (frontend, pure)**
- `core/saveClient.js` (GET/PUT srm + state, user-keyed) + `core/launchModel.js` state machine. Tests.
- `EmulatorEngine` save/load methods (thin EmulatorJS gameManager wrappers).

**P3 — Arcade shell UI**
- `ArcadeShell` + `ConsoleTabs` + `GameGrid` + `GameCover` (centered grid, blank placeholder
  tabs, cover 404 fallback). Tests.

**P4 — Launch flow + identity**
- `EmulatorGameWidget` view machine; identify-up-front prompt with skip; resume-by-default;
  pass identity into console; persist-on-exit.

**P5 — In-game surface**
- `reset` hotspot + confirm modal (clears slot, restarts); person/timer/coins overlays;
  default bezel yml updated (add `reset` hotspot, `timer` overlay, drop hr/cadence).

**P6 — Covers + manifest data**
- Add `save.mode` + `consoles` to `gameboy.yml`; add at least one cover; document fallback.

**P7 — Deploy + verify on garage** (build → deploy gate check → reload kiosk → eyes-on).
